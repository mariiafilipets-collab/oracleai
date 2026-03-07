import { Router } from "express";
import { ethers } from "ethers";
import PredictionEvent from "../models/PredictionEvent.js";
import { assessUserEventForListing, generateDailyPredictions } from "../services/ai.service.js";
import { getContracts, getSigner } from "../services/blockchain.service.js";
import config from "../config/index.js";
import { buildEventTiming, getSchedulerStatus, getVerifyBufferMs, initScheduler, runSchedulerKick } from "../jobs/prediction-scheduler.js";
import { pretranslateEvents, translateEvents, translateMissingEvents } from "../services/translate.service.js";

const router = Router();
const USER_EVENT_ALLOWED_CATEGORIES = new Set(["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"]);
const USER_EVENT_ALLOWED_SOURCES = new Set(["official", "market", "newswire", "oracle"]);
const CATEGORY_INDEX_TO_NAME = ["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"];
const ADDRESS_RE = /^0x[a-f0-9]{40}$/;
let oldPredictionContract = null;
let schedulerEnsureInProgress = false;
const CATEGORY_NAMES = ["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"];

function inferCategoryFromText(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(vs|match|fixture|derby|league|cup|goal|score|scorer|assist|football|soccer|basketball|tennis|hockey|ufc|f1|motogp|grand prix|gp|verstappen|hamilton|nba|nfl|mlb|nhl|arsenal|manchester|liverpool|chelsea|tottenham|real madrid|barcelona|atletico|bayern|psg|juventus|inter|milan)\b/.test(t)) return "SPORTS";
  if (/\b(election|president|parliament|sanction|summit|ceasefire|government|minister|vote)\b/.test(t)) return "POLITICS";
  if (/\b(cpi|inflation|gdp|fed|ecb|interest rate|jobs report|earnings|dow|nasdaq|s&p|gold|oil)\b/.test(t)) return "ECONOMY";
  if (/\b(bitcoin|btc|ethereum|eth|solana|xrp|crypto|token|etf|on-chain|wallet|binance|coinbase)\b/.test(t)) return "CRYPTO";
  if (/\b(storm|hurricane|earthquake|wildfire|flood|temperature|heatwave|weather|climate)\b/.test(t)) return "CLIMATE";
  return "CRYPTO";
}

function normalizeAutoCategory(category, title, description = "") {
  const model = String(category || "").toUpperCase();
  if (!CATEGORY_NAMES.includes(model)) return inferCategoryFromText(`${title} ${description}`);
  const inferred = inferCategoryFromText(`${title} ${description}`);
  return inferred !== "CRYPTO" ? inferred : model;
}

function isAdminAuthorized(req) {
  const key = String(req.header("x-admin-key") || "").trim();
  return Boolean(key) && Boolean(config.deployerKey) && key === String(config.deployerKey).trim();
}

async function ensureSchedulerStarted() {
  if (!config.enableScheduler) return getSchedulerStatus();
  const current = getSchedulerStatus();
  if (current.initialized) return current;
  if (schedulerEnsureInProgress) return current;

  schedulerEnsureInProgress = true;
  try {
    initScheduler(null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return getSchedulerStatus();
  } finally {
    schedulerEnsureInProgress = false;
  }
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function readPredictionValueNoArgs(prediction, fragment, methodName, fallback) {
  try {
    if (typeof prediction?.[methodName] === "function") {
      return await prediction[methodName]();
    }
  } catch {}
  try {
    const provider = prediction?.runner?.provider;
    const to = prediction?.target || prediction?.address;
    if (!provider || !to) return fallback;
    const iface = new ethers.Interface([fragment]);
    const data = iface.encodeFunctionData(methodName, []);
    const raw = await provider.call({ to, data });
    const decoded = iface.decodeFunctionResult(methodName, raw);
    return decoded?.[0] ?? fallback;
  } catch {
    return fallback;
  }
}

async function getCreatorCooldownState(creatorAddress) {
  const creator = String(creatorAddress || "").toLowerCase();
  if (!ADDRESS_RE.test(creator)) {
    return { hasWallet: false, nextAllowedAt: 0, secondsLeft: 0, cooldownSeconds: 0 };
  }
  const { Prediction } = getContracts();
  if (!Prediction) {
    return { hasWallet: true, nextAllowedAt: 0, secondsLeft: 0, cooldownSeconds: 0 };
  }
  const nextAllowedRaw = await Prediction.nextUserEventAt(creator);
  const cooldownRaw = await Prediction.getCreatorCooldown(creator);
  const voteFeeRaw = await readPredictionValueNoArgs(
    Prediction,
    "function userEventVoteFee() view returns (uint256)",
    "userEventVoteFee",
    0n
  );
  const creatorShareRaw = await readPredictionValueNoArgs(
    Prediction,
    "function creatorShareBps() view returns (uint16)",
    "creatorShareBps",
    5000n
  );
  const minVotesRaw = await readPredictionValueNoArgs(
    Prediction,
    "function minCreatorPayoutVotes() view returns (uint256)",
    "minCreatorPayoutVotes",
    20n
  );
  const nowSec = Math.floor(Date.now() / 1000);
  const nextAllowedAt = Number(nextAllowedRaw || 0n);
  return {
    hasWallet: true,
    nextAllowedAt,
    secondsLeft: Math.max(0, nextAllowedAt - nowSec),
    cooldownSeconds: Number(cooldownRaw || 0n),
    voteFeeWei: String(voteFeeRaw || 0n),
    creatorShareBps: Number(creatorShareRaw || 5000),
    minCreatorPayoutVotes: Number(minVotesRaw || 20n),
  };
}

function getOldPredictionContract() {
  if (oldPredictionContract) return oldPredictionContract;
  const { Prediction } = getContracts();
  const provider = Prediction?.runner?.provider;
  const oldAddr = String(config.oldPredictionAddress || "").toLowerCase();
  if (!provider || !/^0x[a-f0-9]{40}$/.test(oldAddr)) return null;
  const abi = [
    "function getUserVote(uint256 eventId, address user) view returns ((bool voted, bool prediction))",
  ];
  oldPredictionContract = new ethers.Contract(oldAddr, abi, provider);
  return oldPredictionContract;
}

async function attachUserVotes(events, address) {
  const user = String(address || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(user) || !Array.isArray(events) || events.length === 0) {
    return events;
  }
  const { Prediction } = getContracts();
  if (!Prediction) return events;
  const oldPrediction = getOldPredictionContract();
  const CHUNK = 25;
  const out = [...events];
  for (let i = 0; i < out.length; i += CHUNK) {
    const batch = out.slice(i, i + CHUNK);
    const rows = await Promise.all(
      batch.map(async (evt) => {
        try {
          let uv = await Prediction.getUserVote(BigInt(evt.eventId), user);
          if (!uv?.voted && oldPrediction) {
            try {
              const oldUv = await oldPrediction.getUserVote(BigInt(evt.eventId), user);
              if (oldUv?.voted) uv = oldUv;
            } catch {}
          }
          const voted = Boolean(uv?.voted);
          const row = { eventId: Number(evt.eventId), voted, prediction: Boolean(uv?.prediction), yes: null, no: null };
          if (voted) {
            try {
              const on = await Prediction["getEvent(uint256)"](BigInt(evt.eventId));
              row.yes = Number(on?.totalVotesYes || 0n);
              row.no = Number(on?.totalVotesNo || 0n);
              // Best-effort DB healing for counters that can lag under RPC limits.
              void PredictionEvent.updateOne(
                { eventId: Number(evt.eventId) },
                { $set: { totalVotesYes: row.yes, totalVotesNo: row.no } }
              ).catch(() => null);
            } catch {}
          }
          return row;
        } catch {
          return { eventId: Number(evt.eventId), voted: false, prediction: false, yes: null, no: null };
        }
      })
    );
    const byId = new Map(rows.map((r) => [r.eventId, r]));
    for (let j = i; j < Math.min(i + CHUNK, out.length); j++) {
      const id = Number(out[j].eventId);
      const uv = byId.get(id);
      if (uv?.voted) {
        out[j] = {
          ...out[j],
          userPrediction: uv.prediction,
          totalVotesYes: uv.yes ?? out[j].totalVotesYes,
          totalVotesNo: uv.no ?? out[j].totalVotesNo,
        };
      }
    }
  }
  return out;
}

// Middleware: translate events if ?lang= is set and not "en"
async function withTranslation(events, lang) {
  if (!lang || lang === "en" || !events?.length) return events;
  let localized = translateEvents(events, lang);
  const missing = events.filter((evt) => {
    const stored = evt.translations?.[lang];
    const hasTitle = Boolean(stored?.title) && stored.title !== evt.title;
    const hasDescription = !evt.description || (Boolean(stored?.description) && stored.description !== evt.description);
    const hasReasoning = !evt.aiReasoning || (Boolean(stored?.aiReasoning) && stored.aiReasoning !== evt.aiReasoning);
    return !(hasTitle && hasDescription && hasReasoning);
  });
  if (!missing.length) return localized;

  const generated = await translateMissingEvents(events, lang);
  if (!generated || Object.keys(generated).length === 0) return localized;

  localized = localized.map((evt) => {
    const id = String(evt.eventId || evt._id);
    const tr = generated[id];
    return tr ? { ...evt, ...tr } : evt;
  });

  // Persist best-effort so future reads are instant and free.
  const ops = Object.entries(generated)
    .map(([id, tr]) => ({ eventId: Number(id), tr }))
    .filter((x) => Number.isFinite(x.eventId))
    .map(({ eventId, tr }) =>
      PredictionEvent.updateOne(
        { eventId },
        {
          $set: {
            [`translations.${lang}.title`]: tr.title || "",
            [`translations.${lang}.description`]: tr.description || "",
            [`translations.${lang}.aiReasoning`]: tr.aiReasoning || "",
          },
        }
      ).catch(() => null)
    );
  if (ops.length) await Promise.allSettled(ops);
  return localized;
}

// Active (unresolved, not expired)
router.get("/", async (req, res) => {
  try {
    let events = await PredictionEvent.find({ resolved: false, deadline: { $gt: new Date() } })
      .sort({ deadline: 1 }).lean();
    events = await attachUserVotes(events, req.query.address);
    events = await withTranslation(events, req.query.lang);
    res.json({ success: true, data: events });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// All predictions
router.get("/all", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    let events = await PredictionEvent.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
    events = await withTranslation(events, req.query.lang);
    const total = await PredictionEvent.countDocuments();
    res.json({ success: true, data: events, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Resolved predictions
router.get("/resolved", async (req, res) => {
  try {
    const includeArchived = String(req.query.includeArchived || "").toLowerCase() === "1";
    const query = includeArchived
      ? { resolved: true }
      : { resolved: true, aiReasoning: { $not: /^Archived/i } };
    let events = await PredictionEvent.find(query).sort({ createdAt: -1 }).limit(50).lean();
    if (!events.length && !includeArchived) {
      events = await PredictionEvent.find({ resolved: true }).sort({ createdAt: -1 }).limit(50).lean();
    }
    events = await attachUserVotes(events, req.query.address);
    events = await withTranslation(events, req.query.lang);
    res.json({ success: true, data: events });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Scheduler status
router.get("/scheduler", async (req, res) => {
  const scheduler = await ensureSchedulerStarted();
  res.json({
    success: true,
    data: {
      ...scheduler,
      runtime: {
        enableScheduler: config.enableScheduler,
        enableEventPolling: config.enableEventPolling,
        aiProvider: config.aiProvider,
        hasOpenRouterKey: Boolean(config.openrouterKey),
        openrouterSearchModel: config.openrouterSearchModel,
        openrouterResolveModel: config.openrouterResolveModel,
      },
    },
  });
});

// Emergency maintenance: force-start scheduler in current process.
router.post("/admin/scheduler/start", async (req, res) => {
  try {
    if (!isAdminAuthorized(req)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    const status = await ensureSchedulerStarted();
    return res.json({ success: true, data: status });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Emergency maintenance: trigger one scheduler refill cycle immediately.
router.post("/admin/scheduler/kick", async (req, res) => {
  try {
    if (!isAdminAuthorized(req)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    const status = await runSchedulerKick();
    return res.json({ success: true, data: status });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// One-time maintenance: remove all auto-generated events from MongoDB.
// This does not touch user-created events.
router.post("/admin/purge-generated", async (req, res) => {
  try {
    if (!isAdminAuthorized(req)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    const beforeAuto = await PredictionEvent.countDocuments({ isUserEvent: false });
    const beforeUser = await PredictionEvent.countDocuments({ isUserEvent: true });
    const beforeActiveAuto = await PredictionEvent.countDocuments({
      isUserEvent: false,
      resolved: false,
      deadline: { $gt: new Date() },
    });
    const del = await PredictionEvent.deleteMany({ isUserEvent: false });
    const afterAuto = await PredictionEvent.countDocuments({ isUserEvent: false });
    const afterUser = await PredictionEvent.countDocuments({ isUserEvent: true });
    return res.json({
      success: true,
      data: {
        beforeAuto,
        beforeUser,
        beforeActiveAuto,
        deleted: Number(del.deletedCount || 0),
        afterAuto,
        afterUser,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Emergency maintenance: remove all events from MongoDB.
// By default keeps user-created events unless keepUser=0 is passed.
router.post("/admin/purge-all", async (req, res) => {
  try {
    if (!isAdminAuthorized(req)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    const keepUser = String(req.query.keepUser ?? "1") !== "0";
    const beforeAll = await PredictionEvent.countDocuments();
    const beforeUser = await PredictionEvent.countDocuments({ isUserEvent: true });
    const beforeGenerated = await PredictionEvent.countDocuments({ isUserEvent: false });
    const filter = keepUser ? { isUserEvent: false } : {};
    const del = await PredictionEvent.deleteMany(filter);
    const afterAll = await PredictionEvent.countDocuments();
    const afterUser = await PredictionEvent.countDocuments({ isUserEvent: true });
    const afterGenerated = await PredictionEvent.countDocuments({ isUserEvent: false });
    return res.json({
      success: true,
      data: {
        keepUser,
        beforeAll,
        beforeUser,
        beforeGenerated,
        deleted: Number(del.deletedCount || 0),
        afterAll,
        afterUser,
        afterGenerated,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/voted/:address", async (req, res) => {
  try {
    const address = String(req.params.address || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      return res.status(400).json({ success: false, error: "Invalid address" });
    }

    const { Prediction } = getContracts();
    if (!Prediction) {
      return res.status(503).json({ success: false, error: "Prediction contract unavailable" });
    }
    const oldPrediction = getOldPredictionContract();

    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "300"), 10) || 300, 1), 500);
    const docs = await PredictionEvent.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const voted = [];
    const CHUNK = 25;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = docs.slice(i, i + CHUNK);
      const results = await Promise.all(
        batch.map(async (evt) => {
          try {
            let uv = await Prediction.getUserVote(BigInt(evt.eventId), address);
            if (!uv?.voted && oldPrediction) {
              try {
                const oldUv = await oldPrediction.getUserVote(BigInt(evt.eventId), address);
                if (oldUv?.voted) uv = oldUv;
              } catch {}
            }
            if (!uv?.voted) return null;
            const aiPredictedOutcome = Number(evt.aiProbability || 0) >= 50;
            const userPrediction = Boolean(uv.prediction);
            const isResolved = Boolean(evt.resolved);
            const outcome = Boolean(evt.outcome);
            const userCorrect = isResolved ? userPrediction === outcome : null;
            const aiWasRight = isResolved ? aiPredictedOutcome === outcome : null;
            const beatAi = isResolved ? Boolean(userCorrect && aiWasRight === false) : null;
            const rewardPoints = isResolved
              ? userCorrect
                ? 50 + (beatAi ? 100 : 0)
                : 0
              : null;
            return {
              ...evt,
              _status: isResolved ? "resolved" : "active",
              userPrediction,
              aiPredictedOutcome,
              userCorrect,
              aiWasRight,
              beatAi,
              rewardPoints,
            };
          } catch {
            return null;
          }
        })
      );
      for (const row of results) {
        if (row) voted.push(row);
      }
    }

    const localized = await withTranslation(voted, String(req.query.lang || ""));
    return res.json({ success: true, data: localized });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// User event pre-validation (anti-spam + quality gates)
router.post("/user/validate", async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const category = String(req.body?.category || "").toUpperCase();
    const sourcePolicy = String(req.body?.sourcePolicy || "").toLowerCase();
    const deadlineMs = Number(req.body?.deadlineMs || 0);
    const creator = String(req.body?.creator || "").toLowerCase();

    if (title.length < 12 || title.length > 180) {
      return res.status(400).json({ success: false, error: "Title must be 12-180 characters" });
    }
    if (!USER_EVENT_ALLOWED_CATEGORIES.has(category)) {
      return res.status(400).json({ success: false, error: "Unsupported category" });
    }
    if (!USER_EVENT_ALLOWED_SOURCES.has(sourcePolicy)) {
      return res.status(400).json({ success: false, error: "Unsupported source policy" });
    }
    if (!Number.isFinite(deadlineMs)) {
      return res.status(400).json({ success: false, error: "Invalid deadline" });
    }

    const now = Date.now();
    const minDeadline = now + 10 * 60 * 1000;
    const maxDeadline = now + 14 * 24 * 60 * 60 * 1000;
    if (deadlineMs < minDeadline || deadlineMs > maxDeadline) {
      return res.status(400).json({ success: false, error: "Deadline must be in 10m..14d range" });
    }

    const cooldown = await getCreatorCooldownState(creator);
    if (cooldown.hasWallet && cooldown.secondsLeft > 0) {
      return res.status(429).json({
        success: false,
        error: "Cooldown active",
        data: {
          nextAllowedAt: cooldown.nextAllowedAt,
          secondsLeft: cooldown.secondsLeft,
          cooldownSeconds: cooldown.cooldownSeconds,
        },
      });
    }

    const normalized = normalizeTitle(title);
    const recent = await PredictionEvent.find({
      resolved: false,
      deadline: { $gt: new Date(now - 2 * 24 * 60 * 60 * 1000) },
    })
      .select("title")
      .limit(300)
      .lean();
    const duplicate = recent.some((evt) => normalizeTitle(evt.title) === normalized);
    if (duplicate) {
      return res.status(400).json({ success: false, error: "Duplicate active event detected" });
    }

    const qualityWarnings = [];
    if (!title.endsWith("?")) qualityWarnings.push("Question should end with '?' for clarity.");
    if (!/\b(will|is|does|can|won't|will not)\b/i.test(title)) qualityWarnings.push("Use clear binary wording.");

    const aiAssessment = await assessUserEventForListing({
      title,
      category,
      deadlineMs,
      sourcePolicy,
    });
    if (!aiAssessment.accepted) {
      return res.status(400).json({
        success: false,
        error: aiAssessment.reason || "AI validation rejected this event",
        data: {
          aiAccepted: false,
          sourceLanguage: aiAssessment.sourceLanguage || "unknown",
        },
      });
    }

    return res.json({
      success: true,
      data: {
        normalizedTitle: normalized,
        accepted: true,
        qualityWarnings,
        aiAccepted: true,
        aiProbability: aiAssessment.aiProbability,
        aiReason: aiAssessment.reason,
        sourceLanguage: aiAssessment.sourceLanguage,
        normalizedTitleAi: aiAssessment.normalizedTitle,
        normalizedDescriptionAi: aiAssessment.normalizedDescription,
        cooldown,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Ingest one on-chain user event into Mongo right after tx confirmation
router.post("/user/ingest", async (req, res) => {
  try {
    const eventId = Number(req.body?.eventId || 0);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return res.status(400).json({ success: false, error: "Invalid eventId" });
    }
    const { Prediction } = getContracts();
    if (!Prediction) {
      return res.status(503).json({ success: false, error: "Prediction contract unavailable" });
    }

    const evt = await Prediction["getEvent(uint256)"](BigInt(eventId));
    if (!evt || Number(evt.id || 0n) === 0) {
      return res.status(404).json({ success: false, error: "Event not found on chain" });
    }
    const category = CATEGORY_INDEX_TO_NAME[Number(evt.category || 3)] || "CRYPTO";
    const aiAssessment = await assessUserEventForListing({
      title: String(evt.title || ""),
      category,
      deadlineMs: Number(evt.deadline || 0n) * 1000,
      sourcePolicy: String(evt.sourcePolicy || ""),
    });
    const baseTitle = aiAssessment?.normalizedTitle || String(evt.title || `Event #${eventId}`);
    const baseDescription = aiAssessment?.normalizedDescription || "";
    let localized = {};
    try {
      const pre = await pretranslateEvents([
        { eventId, title: baseTitle, description: baseDescription, aiReasoning: "" },
      ]);
      localized = pre?.[0] || {};
    } catch {
      localized = {};
    }

    const doc = {
      eventId,
      title: baseTitle,
      description: baseDescription,
      category,
      aiProbability: Math.max(0, Math.min(100, Number(aiAssessment?.aiProbability ?? evt.aiProbability ?? 50n))),
      deadline: new Date(Number(evt.deadline || 0n) * 1000),
      verifyAfter: new Date(
        Number(evt.deadline || 0n) * 1000 + getVerifyBufferMs(category, Boolean(evt.isUserEvent))
      ),
      expectedResolveAtUtc: new Date(
        Number(evt.deadline || 0n) * 1000 + getVerifyBufferMs(category, Boolean(evt.isUserEvent))
      ),
      timePrecision: "DATE_ONLY",
      confidence: 0.75,
      popularityScore: 60,
      sources: [],
      qualityVersion: "v2",
      creator: String(evt.creator || "").toLowerCase(),
      isUserEvent: Boolean(evt.isUserEvent),
      listingFeeWei: String(evt.listingFee || 0n),
      sourcePolicy: String(evt.sourcePolicy || ""),
      resolved: Boolean(evt.resolved),
      outcome: Boolean(evt.resolved) ? Boolean(evt.outcome) : null,
      totalVotesYes: Number(evt.totalVotesYes || 0n),
      totalVotesNo: Number(evt.totalVotesNo || 0n),
      translations: localized,
    };

    await PredictionEvent.updateOne({ eventId }, { $set: doc }, { upsert: true });
    return res.json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Manual generate
router.post("/generate", async (req, res) => {
  try {
    const predictions = await generateDailyPredictions();
    const localized = await pretranslateEvents(predictions);
    const { Prediction } = getContracts();
    const signer = getSigner();
    const created = [];

    if (Prediction && signer) {
      let nonce = await signer.getNonce();
      for (let i = 0; i < predictions.length; i++) {
        const pred = predictions[i];
        const normalizedCategory = normalizeAutoCategory(pred.category, pred.title, pred.description || "");
        const timing = buildEventTiming({
          category: normalizedCategory,
          hoursToResolve: pred.hoursToResolve || 8,
          verifyAtUtc: pred.verifyAtUtc,
          isUserEvent: false,
        });
        const catIdx = CATEGORY_NAMES.indexOf(normalizedCategory);
        try {
          const tx = await Prediction.createEvent(pred.title, catIdx >= 0 ? catIdx : 3, Math.floor(timing.deadline.getTime() / 1000), pred.aiProbability, { nonce: nonce++ });
          await tx.wait();
          const id = Number(await Prediction.eventCount());
          const doc = await PredictionEvent.create({
            eventId: id,
            title: pred.title,
            description: pred.description || "",
            category: normalizedCategory,
            aiProbability: pred.aiProbability,
            deadline: timing.deadline,
            verifyAfter: timing.verifyAfter,
            expectedResolveAtUtc: timing.verifyAfter,
            eventStartAtUtc: pred.eventStartAtUtc ? new Date(pred.eventStartAtUtc) : null,
            timePrecision: /\d{1,2}:\d{2}\s*UTC/i.test(pred.title || "") ? "EXACT_MINUTE" : "DATE_ONLY",
            confidence: Math.max(0, Math.min(1, Number(pred.confidence ?? 0.75))),
            popularityScore: Math.max(0, Math.min(100, Number(pred.popularityScore ?? 70))),
            sources: Array.isArray(pred.sources) ? pred.sources.slice(0, 8) : [],
            qualityVersion: "v2",
            translations: localized[i] || undefined,
          });
          created.push(doc);
        } catch (err) {
          console.error("createEvent:", err.message?.slice(0, 100));
        }
      }
    }

    res.json({ success: true, data: created, count: created.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Manual resolve
router.post("/:eventId/resolve", async (req, res) => {
  try {
    const { eventId } = req.params;
    const { outcome } = req.body;
    const { Prediction } = getContracts();
    let finished = true;
    if (Prediction) {
      const tx = await Prediction.resolveEvent(parseInt(eventId), !!outcome);
      await tx.wait();
      const on = await Prediction["getEvent(uint256)"](BigInt(parseInt(eventId)));
      finished = Boolean(on?.resolved);
    }
    await PredictionEvent.updateOne(
      { eventId: parseInt(eventId) },
      finished
        ? { resolved: true, resolvePending: false, outcome: !!outcome }
        : { resolved: false, resolvePending: true, outcome: null, aiReasoning: "Resolution in progress (batched on-chain)." }
    );
    res.json({ success: true, data: { resolved: finished } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
