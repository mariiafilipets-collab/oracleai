import { Router } from "express";
import PredictionEvent from "../models/PredictionEvent.js";
import { generateDailyPredictions } from "../services/ai.service.js";
import { getContracts, getSigner } from "../services/blockchain.service.js";
import { getSchedulerStatus } from "../jobs/prediction-scheduler.js";
import { pretranslateEvents, translateEvents, translateMissingEvents } from "../services/translate.service.js";

const router = Router();
const USER_EVENT_ALLOWED_CATEGORIES = new Set(["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"]);
const USER_EVENT_ALLOWED_SOURCES = new Set(["official", "market", "newswire", "oracle"]);
const CATEGORY_INDEX_TO_NAME = ["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"];

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
    events = await withTranslation(events, req.query.lang);
    res.json({ success: true, data: events });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Scheduler status
router.get("/scheduler", (req, res) => {
  res.json({ success: true, data: getSchedulerStatus() });
});

// User event pre-validation (anti-spam + quality gates)
router.post("/user/validate", async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const category = String(req.body?.category || "").toUpperCase();
    const sourcePolicy = String(req.body?.sourcePolicy || "").toLowerCase();
    const deadlineMs = Number(req.body?.deadlineMs || 0);

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

    return res.json({
      success: true,
      data: {
        normalizedTitle: normalized,
        accepted: true,
        qualityWarnings,
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
    const doc = {
      eventId,
      title: String(evt.title || `Event #${eventId}`),
      description: "",
      category,
      aiProbability: Number(evt.aiProbability || 50n),
      deadline: new Date(Number(evt.deadline || 0n) * 1000),
      creator: String(evt.creator || ""),
      isUserEvent: Boolean(evt.isUserEvent),
      listingFeeWei: String(evt.listingFee || 0n),
      sourcePolicy: String(evt.sourcePolicy || ""),
      resolved: Boolean(evt.resolved),
      outcome: Boolean(evt.resolved) ? Boolean(evt.outcome) : null,
      totalVotesYes: Number(evt.totalVotesYes || 0n),
      totalVotesNo: Number(evt.totalVotesNo || 0n),
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
        const hours = pred.hoursToResolve || 8;
        const deadline = new Date(Date.now() + hours * 3600000);
        const catIdx = ["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"].indexOf(pred.category);
        try {
          const tx = await Prediction.createEvent(pred.title, catIdx >= 0 ? catIdx : 3, Math.floor(deadline.getTime() / 1000), pred.aiProbability, { nonce: nonce++ });
          await tx.wait();
          const id = Number(await Prediction.eventCount());
          const doc = await PredictionEvent.create({
            eventId: id,
            title: pred.title,
            description: pred.description || "",
            category: pred.category,
            aiProbability: pred.aiProbability,
            deadline,
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
