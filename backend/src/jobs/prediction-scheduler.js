import PredictionEvent from "../models/PredictionEvent.js";
import User from "../models/User.js";
import WeeklyPrizeEpoch from "../models/WeeklyPrizeEpoch.js";
import { generateDailyPredictions, resolveExpiredPredictions } from "../services/ai.service.js";
import { getContracts, getSigner, getProvider } from "../services/blockchain.service.js";
import { pretranslateEvents } from "../services/translate.service.js";
import { ethers } from "ethers";

const MIN_ACTIVE = 40;
const GENERATE_INTERVAL = 90 * 60 * 1000;   // 1.5 hours
const RESOLVE_INTERVAL = 5 * 60 * 1000;      // 5 minutes
const REFILL_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const WEEKLY_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour
const NIGHTLY_RETRY_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const PROTOCOL_FEE_DISTRIBUTION_CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const MAX_WEEKLY_WINNERS = 1000;
const MIN_WINNER_REWARD_WEI = 200000000000000n; // 0.0002 BNB
const PRETRANSLATE_TIMEOUT_MS = 15000;
const SYNC_TIMEOUT_MS = 12000;
const DEFAULT_RESULT_VERIFY_BUFFER_MS = 10 * 60 * 1000;
const CATEGORY_VERIFY_BUFFER_MINUTES = {
  SPORTS: 20,
  POLITICS: 45,
  ECONOMY: 30,
  CRYPTO: 15,
  CLIMATE: 45,
};

let io = null;
let generating = false;
let resolving = false;
let lastGenerate = 0;
let lastWeeklyReset = 0;
let stats = { generated: 0, resolved: 0, prizesDistributed: 0, cycles: 0 };
let schedulerInitialized = false;
const schedulerTimers = [];

const CATEGORY_NAMES = ["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"];
const ALLOWED_CATEGORIES = new Set(CATEGORY_NAMES);
const withTimeout = async (promise, timeoutMs, label) => {
  return await Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label || "operation"} timeout`)), timeoutMs)),
  ]);
};

export function getVerifyBufferMs(category, isUserEvent = false) {
  if (isUserEvent) return DEFAULT_RESULT_VERIFY_BUFFER_MS;
  const key = String(category || "CRYPTO").toUpperCase();
  const minutes = CATEGORY_VERIFY_BUFFER_MINUTES[key] || 10;
  return minutes * 60 * 1000;
}

function parseIsoUtc(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

function inferTimePrecision(title, verifyAt) {
  const t = String(title || "");
  if (/\b\d{1,2}:\d{2}\s*UTC\b/i.test(t) || verifyAt) return "EXACT_MINUTE";
  if (/\b\d{1,2}\s*(AM|PM)\b/i.test(t)) return "EXACT_HOUR";
  return "DATE_ONLY";
}

export function buildEventTiming({ category, hoursToResolve, verifyAtUtc, isUserEvent = false }) {
  const now = Date.now();
  const resolveMs = Math.max(6, Number(hoursToResolve || 8)) * 3600000;
  const parsedVerifyAt = parseIsoUtc(verifyAtUtc);
  const resultCheckAt = parsedVerifyAt && parsedVerifyAt.getTime() > now + 60_000
    ? parsedVerifyAt
    : new Date(now + resolveMs);
  const verifyBufferMs = getVerifyBufferMs(category, isUserEvent);
  const voteDeadlineMs = Math.max(now + 60_000, resultCheckAt.getTime() - verifyBufferMs);
  return {
    deadline: new Date(voteDeadlineMs),
    verifyAfter: resultCheckAt,
    verifyBufferMs,
  };
}

async function getOnChainEvent(Prediction, eventId) {
  // In ethers v6, contract.getEvent is a meta-method; call by full signature to avoid name collision.
  return Prediction["getEvent(uint256)"](BigInt(eventId));
}

function determineWinnerCount(participantsCount, poolWei) {
  if (participantsCount <= 0 || poolWei <= 0n) return 0;
  const byMinReward = Number(poolWei / MIN_WINNER_REWARD_WEI);
  return Math.max(1, Math.min(MAX_WEEKLY_WINNERS, participantsCount, Math.max(1, byMinReward)));
}

function buildDynamicShares(pool, winnersCount) {
  if (winnersCount <= 0) return [];

  // Target bucket allocation for up to 1000 winners:
  // #1:8% | #2-10:12% | #11-100:25% | #101-300:20% | #301-1000:35%
  const buckets = [
    { start: 1, end: 1, pct: 800n },
    { start: 2, end: 10, pct: 1200n },
    { start: 11, end: 100, pct: 2500n },
    { start: 101, end: 300, pct: 2000n },
    { start: 301, end: 1000, pct: 3500n },
  ];

  const activeBuckets = buckets
    .map((b) => {
      const from = b.start;
      const to = Math.min(b.end, winnersCount);
      const count = to >= from ? to - from + 1 : 0;
      return { ...b, count };
    })
    .filter((b) => b.count > 0);

  const activePct = activeBuckets.reduce((acc, b) => acc + b.pct, 0n);
  if (activePct === 0n) return [];

  const shares = Array(winnersCount).fill(0n);
  let distributed = 0n;

  for (const b of activeBuckets) {
    const bucketTotal = (pool * b.pct) / activePct;
    const each = bucketTotal / BigInt(b.count);
    for (let rank = b.start; rank <= Math.min(b.end, winnersCount); rank++) {
      shares[rank - 1] = each;
      distributed += each;
    }
  }

  // Assign rounding remainder to top rank.
  const remainder = pool - distributed;
  if (remainder > 0n && shares.length > 0) {
    shares[0] += remainder;
  }

  return shares;
}

function hashPair(a, b) {
  const [x, y] = String(a).toLowerCase() <= String(b).toLowerCase() ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([x, y]));
}

function buildMerkleTree(leaves) {
  if (!leaves.length) return { root: ethers.ZeroHash, levels: [[ethers.ZeroHash]] };
  const levels = [leaves.slice()];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i];
      const right = i + 1 < prev.length ? prev[i + 1] : prev[i];
      next.push(hashPair(left, right));
    }
    levels.push(next);
  }
  return { root: levels[levels.length - 1][0], levels };
}

function buildProof(levels, leafIndex) {
  const proof = [];
  let index = leafIndex;
  for (let level = 0; level < levels.length - 1; level++) {
    const layer = levels[level];
    const siblingIndex = index ^ 1;
    const sibling = layer[siblingIndex] ?? layer[index];
    proof.push(sibling);
    index = Math.floor(index / 2);
  }
  return proof;
}

export function initScheduler(socketIO) {
  if (schedulerInitialized) {
    console.warn("[Scheduler] init skipped: already initialized in this process");
    return;
  }
  schedulerInitialized = true;
  io = socketIO;

  setTimeout(() => {
    console.log("[Scheduler] Starting autonomous cycle...");
    lastWeeklyReset = Date.now();

    // Register periodic jobs first so scheduler remains alive even if initial sync hits slow RPC.
    schedulerTimers.push(setInterval(resolveExpired, RESOLVE_INTERVAL));
    schedulerTimers.push(setInterval(refill, REFILL_CHECK_INTERVAL));
    schedulerTimers.push(setInterval(scheduledGenerate, GENERATE_INTERVAL));
    schedulerTimers.push(setInterval(weeklyCheck, WEEKLY_CHECK_INTERVAL));
    schedulerTimers.push(setInterval(nightlyRetryPendingResolutions, NIGHTLY_RETRY_INTERVAL));
    schedulerTimers.push(setInterval(distributeProtocolFeesIfDue, PROTOCOL_FEE_DISTRIBUTION_CHECK_INTERVAL));

    console.log(`[Scheduler] Running. Resolve: ${RESOLVE_INTERVAL / 1000}s | Refill: ${REFILL_CHECK_INTERVAL / 60000}min | Gen: ${GENERATE_INTERVAL / 60000}min | Weekly: ${WEEKLY_CHECK_INTERVAL / 60000}min | Fees: ${PROTOCOL_FEE_DISTRIBUTION_CHECK_INTERVAL / 60000}min`);

    // Run startup sync in background to avoid blocking interval registration.
    (async () => {
      try {
        await bootstrapPredictionsFromChain();
        await syncUnresolvedWithChain();
        await resyncArchivedFromChain();
        await refill();
      } catch (err) {
        console.error(`[Scheduler] Startup sync failed: ${err?.message || err}`);
      }
    })();
  }, 5000);
}

// ─── REFILL ─────────────────────────────────────────────────────────────────

async function refill() {
  try {
    await withTimeout(syncUnresolvedWithChain(500), SYNC_TIMEOUT_MS, "syncUnresolvedWithChain");
  } catch (e) {
    console.warn(`[Scheduler] Refill sync timeout, continuing with DB counts: ${e.message}`);
  }
  let active = await PredictionEvent.countDocuments({ resolved: false, deadline: { $gt: new Date() } });
  if (active === 0) {
    try {
      await withTimeout(bootstrapPredictionsFromChain(), SYNC_TIMEOUT_MS, "bootstrapPredictionsFromChain");
    } catch (e) {
      console.warn(`[Scheduler] Bootstrap timeout during refill: ${e.message}`);
    }
    active = await PredictionEvent.countDocuments({ resolved: false, deadline: { $gt: new Date() } });
  }
  if (active < MIN_ACTIVE) {
    console.log(`[Scheduler] ${active}/${MIN_ACTIVE} active — refilling...`);
    await publishNewBatch();
  }
}

async function scheduledGenerate() {
  const active = await PredictionEvent.countDocuments({ resolved: false, deadline: { $gt: new Date() } });
  if (active < MIN_ACTIVE * 2) {
    console.log(`[Scheduler] Scheduled generation (${active} active)...`);
    await publishNewBatch();
  }
}

async function publishNewBatch() {
  if (generating) return;
  generating = true;

  try {
    const predictions = await generateDailyPredictions();
    const { Prediction } = getContracts();
    const signer = getSigner();
    if (!Prediction || !signer) { generating = false; return; }

    // Deduplicate only within current AI batch.
    // We intentionally do NOT dedup against already-active events here,
    // otherwise refill can get stuck below MIN_ACTIVE when AI repeats top headlines.
    const seenInBatch = new Set();
    const unique = predictions.filter((p) => {
      const key = p.title.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seenInBatch.has(key)) return false;
      seenInBatch.add(key);
      return true;
    });

    if (unique.length < predictions.length) {
      console.log(`[Scheduler] Dedup: ${predictions.length - unique.length} duplicates removed`);
    }
    let localized = [];
    try {
      // Do not block event publishing on slow translation calls.
      localized = await Promise.race([
        pretranslateEvents(unique),
        new Promise((resolve) => setTimeout(() => resolve([]), PRETRANSLATE_TIMEOUT_MS)),
      ]);
      if (!Array.isArray(localized)) localized = [];
      if (localized.length === 0) {
        console.warn("[Scheduler] Pretranslate timeout/fallback: publishing with source text");
      }
    } catch (e) {
      console.warn(`[Scheduler] Pretranslate skipped: ${e.message}`);
      localized = [];
    }

    let nonce = await signer.getNonce();
    let ok = 0;

    for (let i = 0; i < unique.length; i++) {
      const p = unique[i];
      const normalizedCategory = normalizeStoredCategory(
        p.category,
        p.title,
        p.description || "",
        false
      );
      const timing = buildEventTiming({
        category: normalizedCategory,
        hoursToResolve: p.hoursToResolve || 8,
        verifyAtUtc: p.verifyAtUtc,
        isUserEvent: false,
      });
      const catIdx = CATEGORY_NAMES.indexOf(normalizedCategory);
      try {
        const tx = await Prediction.createEvent(
          p.title,
          catIdx >= 0 ? catIdx : 3,
          Math.floor(timing.deadline.getTime() / 1000),
          p.aiProbability,
          { nonce: nonce++ }
        );
        await tx.wait();
        const id = Number(await Prediction.eventCount());
        // Re-deploy on local chain resets eventId back to 1.
        // Use upsert to overwrite stale docs with same eventId instead of failing on unique index.
        await PredictionEvent.updateOne(
          { eventId: id },
          {
            $set: {
              eventId: id,
              title: p.title,
              description: p.description || "",
              category: normalizedCategory,
              aiProbability: p.aiProbability,
              deadline: timing.deadline,
              verifyAfter: timing.verifyAfter,
              eventStartAtUtc: parseIsoUtc(p.eventStartAtUtc),
              expectedResolveAtUtc: timing.verifyAfter,
              timePrecision: inferTimePrecision(p.title, p.verifyAtUtc),
              confidence: Math.max(0, Math.min(1, Number(p.confidence ?? 0.75))),
              popularityScore: Math.max(0, Math.min(100, Number(p.popularityScore ?? 70))),
              sources: Array.isArray(p.sources) ? p.sources.slice(0, 8).map((x) => String(x).slice(0, 300)) : [],
              qualityVersion: "v2",
              creator: "",
              isUserEvent: false,
              listingFeeWei: "0",
              sourcePolicy: "",
              resolved: false,
              resolvePending: false,
              outcome: null,
              aiReasoning: "",
              nextResolveRetryAt: null,
              resolveAttempts: 0,
              lastResolveError: "",
              lastResolveTriedAt: null,
              translations: localized[i] || {},
            },
          },
          { upsert: true }
        );
        ok++;
      } catch (e) {
        console.error(`[Scheduler] create: ${e.message?.slice(0, 80)}`);
      }
    }

    lastGenerate = Date.now();
    stats.generated += ok;
    stats.cycles++;
    console.log(`[Scheduler] Published ${ok}/${unique.length}`);
    if (io) io.emit("prediction:new", { count: ok });
  } catch (e) {
    console.error(`[Scheduler] gen error: ${e.message}`);
  } finally {
    generating = false;
  }
}

function inferCategoryFromText(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(vs|match|fixture|derby|league|cup|goal|score|scorer|assist|player|team|coach|lineup|penalty|football|soccer|basketball|tennis|hockey|baseball|cricket|mma|ufc|f1|formula 1|motogp|nba|nfl|mlb|nhl|uefa|fifa|premier league|la liga|laliga|serie a|bundesliga|champions league|europa league|arsenal|manchester|liverpool|chelsea|tottenham|real madrid|barcelona|atletico|bayern|psg|juventus|inter|milan|dortmund)\b/.test(t)) {
    return "SPORTS";
  }
  if (/\b(election|president|parliament|sanction|summit|ceasefire|government|minister|vote)\b/.test(t)) {
    return "POLITICS";
  }
  if (/\b(cpi|inflation|gdp|fed|ecb|interest rate|jobs report|earnings|dow|nasdaq|s&p)\b/.test(t)) {
    return "ECONOMY";
  }
  if (/\b(bitcoin|btc|ethereum|eth|solana|crypto|token|etf|on-chain|wallet)\b/.test(t)) {
    return "CRYPTO";
  }
  if (/\b(storm|hurricane|earthquake|wildfire|flood|temperature|heatwave|weather|climate)\b/.test(t)) {
    return "CLIMATE";
  }
  return "CRYPTO";
}

function normalizeStoredCategory(eventCategory, title, description, isUserEvent) {
  const modelCategory = ALLOWED_CATEGORIES.has(String(eventCategory || "").toUpperCase())
    ? String(eventCategory).toUpperCase()
    : "CRYPTO";
  if (isUserEvent) return modelCategory;
  const inferredCategory = inferCategoryFromText(`${title || ""} ${description || ""}`);
  return inferredCategory !== "CRYPTO" ? inferredCategory : modelCategory;
}

async function bootstrapPredictionsFromChain() {
  try {
    const localDocs = await PredictionEvent.countDocuments();
    if (localDocs > 0) return;

    const { Prediction } = getContracts();
    if (!Prediction) return;

    const total = Number(await Prediction.eventCount());
    if (!total || Number.isNaN(total)) return;

    let imported = 0;
    for (let id = 1; id <= total; id++) {
      try {
        const evt = await getOnChainEvent(Prediction, id);
        const category = normalizeStoredCategory(
          CATEGORY_NAMES[Number(evt.category ?? 3)] || "CRYPTO",
          String(evt.title || `Event #${id}`),
          "",
          Boolean(evt.isUserEvent)
        );
        const deadlineSec = Number(evt.deadline ?? 0n);
        const deadline = new Date(deadlineSec * 1000);
        const verifyAfter = new Date(
          deadline.getTime() + getVerifyBufferMs(category, Boolean(evt.isUserEvent))
        );

        await PredictionEvent.updateOne(
          { eventId: id },
          {
            $setOnInsert: {
              eventId: id,
              title: String(evt.title || `Event #${id}`),
              description: "",
              category,
              aiProbability: Number(evt.aiProbability ?? 50n),
              deadline,
              verifyAfter,
              expectedResolveAtUtc: verifyAfter,
              timePrecision: "DATE_ONLY",
              confidence: 0.7,
              popularityScore: 60,
              sources: [],
              qualityVersion: "v2",
              creator: String(evt.creator || "").toLowerCase(),
              isUserEvent: Boolean(evt.isUserEvent),
              listingFeeWei: String(evt.listingFee || 0n),
              sourcePolicy: String(evt.sourcePolicy || ""),
              resolved: Boolean(evt.resolved),
              outcome: Boolean(evt.resolved) ? Boolean(evt.outcome) : null,
              totalVotesYes: Number(evt.totalVotesYes ?? 0n),
              totalVotesNo: Number(evt.totalVotesNo ?? 0n),
            },
          },
          { upsert: true }
        );
        imported++;
      } catch {}
    }

    if (imported > 0) {
      console.log(`[Scheduler] Bootstrapped ${imported} events from chain`);
    }
  } catch (e) {
    console.warn(`[Scheduler] Bootstrap skipped: ${e.message}`);
  }
}

async function resyncArchivedFromChain() {
  try {
    const { Prediction } = getContracts();
    if (!Prediction) return;
    const chainEventCount = Number(await Prediction.eventCount());
    if (!chainEventCount || Number.isNaN(chainEventCount)) return;

    const archived = await PredictionEvent.find({
      resolved: true,
      aiReasoning: /Archived/i,
      eventId: { $lte: chainEventCount },
    })
      .select("eventId")
      .limit(500)
      .lean();

    if (!archived.length) return;

    let fixed = 0;
    for (const row of archived) {
      try {
        const on = await getOnChainEvent(Prediction, row.eventId);
        if (!on || Number(on.id || 0n) === 0) continue;
        const onResolved = Boolean(on.resolved);
        const normalizedCategory = normalizeStoredCategory(
          CATEGORY_NAMES[Number(on.category || 3)] || "CRYPTO",
          String(on.title || ""),
          "",
          Boolean(on.isUserEvent)
        );
        const update = {
          category: normalizedCategory,
          resolved: onResolved,
          outcome: onResolved ? Boolean(on.outcome) : null,
          aiReasoning: onResolved ? "Synced from chain after restart recovery." : "",
          deadline: new Date(Number(on.deadline || 0n) * 1000),
          totalVotesYes: Number(on.totalVotesYes || 0n),
          totalVotesNo: Number(on.totalVotesNo || 0n),
          creator: String(on.creator || "").toLowerCase(),
          isUserEvent: Boolean(on.isUserEvent),
          listingFeeWei: String(on.listingFee || 0n),
          sourcePolicy: String(on.sourcePolicy || ""),
        };
        await PredictionEvent.updateOne({ eventId: row.eventId }, { $set: update });
        fixed++;
      } catch {}
    }
    if (fixed > 0) {
      console.log(`[Scheduler] Resynced ${fixed} archived events from chain state`);
    }
  } catch (e) {
    console.warn(`[Scheduler] Resync skipped: ${e.message}`);
  }
}

async function syncUnresolvedWithChain(limit = 1000) {
  try {
    const { Prediction } = getContracts();
    if (!Prediction) return;

    const chainEventCount = Number(await Prediction.eventCount());
    if (Number.isNaN(chainEventCount)) return;

    const localMaxDoc = await PredictionEvent.findOne().sort({ eventId: -1 }).select("eventId").lean();
    const localMaxEventId = Number(localMaxDoc?.eventId || 0);
    if (chainEventCount > localMaxEventId) {
      // Avoid repopulating very old historical events after admin purge/reset.
      // Keep sync focused on the most recent chain window.
      const startId = Math.max(1, localMaxEventId + 1, chainEventCount - 300 + 1);
      const importUntil = Math.min(chainEventCount, startId + 300);
      for (let id = startId; id <= importUntil; id++) {
        try {
          const on = await getOnChainEvent(Prediction, id);
          if (!on || Number(on.id || 0n) === 0) continue;
          const normalizedCategory = normalizeStoredCategory(
            CATEGORY_NAMES[Number(on.category || 3)] || "CRYPTO",
            String(on.title || `Event #${id}`),
            "",
            Boolean(on.isUserEvent)
          );
          const deadline = new Date(Number(on.deadline || 0n) * 1000);
          const verifyAfter = new Date(
            deadline.getTime() + getVerifyBufferMs(normalizedCategory, Boolean(on.isUserEvent))
          );
          await PredictionEvent.updateOne(
            { eventId: id },
            {
              $setOnInsert: {
                eventId: id,
                title: String(on.title || `Event #${id}`),
                description: "",
                category: normalizedCategory,
                aiProbability: Number(on.aiProbability || 50n),
                deadline,
                verifyAfter,
                expectedResolveAtUtc: verifyAfter,
                timePrecision: "DATE_ONLY",
                confidence: 0.7,
                popularityScore: 60,
                sources: [],
                qualityVersion: "v2",
                creator: String(on.creator || "").toLowerCase(),
                isUserEvent: Boolean(on.isUserEvent),
                listingFeeWei: String(on.listingFee || 0n),
                sourcePolicy: String(on.sourcePolicy || ""),
                resolved: Boolean(on.resolved),
                outcome: Boolean(on.resolved) ? Boolean(on.outcome) : null,
                totalVotesYes: Number(on.totalVotesYes || 0n),
                totalVotesNo: Number(on.totalVotesNo || 0n),
              },
            },
            { upsert: true }
          );
        } catch {}
      }
    }

    const stale = await PredictionEvent.updateMany(
      { eventId: { $gt: chainEventCount }, aiReasoning: { $not: /^Archived/i } },
      {
        $set: {
          resolved: true,
          resolvePending: false,
          outcome: false,
          aiReasoning: "Archived after local chain reset (event is not present on current chain).",
        },
      }
    );
    if ((stale.modifiedCount || 0) > 0) {
      console.log(`[Scheduler] Archived ${stale.modifiedCount} unresolved stale events`);
    }

    const unresolved = await PredictionEvent.find({ resolved: false, eventId: { $lte: chainEventCount } })
      .select("eventId")
      .limit(limit)
      .lean();
    if (!unresolved.length) return;

    const ops = [];
    for (const row of unresolved) {
      try {
        const on = await getOnChainEvent(Prediction, row.eventId);
        if (!on || Number(on.id || 0n) === 0) {
          ops.push({
            updateOne: {
              filter: { eventId: row.eventId },
              update: {
                $set: {
                  resolved: true,
                  resolvePending: false,
                  outcome: false,
                  aiReasoning: "Archived: event not found on current chain.",
                },
              },
            },
          });
          continue;
        }

        const onResolved = Boolean(on.resolved);
        const normalizedCategory = normalizeStoredCategory(
          CATEGORY_NAMES[Number(on.category || 3)] || "CRYPTO",
          String(on.title || ""),
          "",
          Boolean(on.isUserEvent)
        );
        const deadline = new Date(Number(on.deadline || 0n) * 1000);
        const verifyAfter = new Date(
          deadline.getTime() + getVerifyBufferMs(normalizedCategory, Boolean(on.isUserEvent))
        );
        ops.push({
          updateOne: {
            filter: { eventId: row.eventId },
            update: {
              $set: {
                category: normalizedCategory,
                deadline,
                verifyAfter,
                expectedResolveAtUtc: verifyAfter,
                qualityVersion: "v2",
                totalVotesYes: Number(on.totalVotesYes || 0n),
                totalVotesNo: Number(on.totalVotesNo || 0n),
                creator: String(on.creator || "").toLowerCase(),
                isUserEvent: Boolean(on.isUserEvent),
                listingFeeWei: String(on.listingFee || 0n),
                sourcePolicy: String(on.sourcePolicy || ""),
                resolved: onResolved,
                resolvePending: false,
                outcome: onResolved ? Boolean(on.outcome) : null,
                aiReasoning: onResolved ? "Synced from chain: already resolved." : "",
              },
            },
          },
        });
      } catch {}
    }

    if (ops.length) {
      const bulk = await PredictionEvent.bulkWrite(ops, { ordered: false });
      const changed = (bulk.modifiedCount || 0) + (bulk.upsertedCount || 0);
      if (changed > 0) {
        console.log(`[Scheduler] Synced ${changed} unresolved events with chain state`);
      }
    }
  } catch (e) {
    console.warn(`[Scheduler] Unresolved sync skipped: ${e.message}`);
  }
}

// ─── RESOLVE ────────────────────────────────────────────────────────────────

async function resolveExpired() {
  if (resolving) return;

  const { Prediction } = getContracts();
  const signer = getSigner();
  if (!Prediction || !signer) return;

  let chainEventCount = 0;
  try {
    chainEventCount = Number(await Prediction.eventCount());
  } catch (e) {
    console.warn(`[Scheduler] resolve skipped: eventCount unavailable (${e.message})`);
    return;
  }

  // Dev chain often resets, while local Mongo keeps old events.
  // Archive stale docs so they stop triggering repeated AI resolutions forever.
  try {
    const stale = await PredictionEvent.updateMany(
      { resolved: false, eventId: { $gt: chainEventCount } },
      {
        $set: {
          resolved: true,
          outcome: false,
          aiReasoning: "Archived after local chain reset (event is not present on current chain).",
        },
      }
    );
    if ((stale.modifiedCount || 0) > 0) {
      console.log(`[Scheduler] Archived ${stale.modifiedCount} stale events after chain reset`);
    }
  } catch {}

  const now = Date.now();
  const expiredCandidates = await PredictionEvent.find({
    resolved: false,
    $or: [
      { nextResolveRetryAt: null },
      { nextResolveRetryAt: { $exists: false } },
      { nextResolveRetryAt: { $lte: new Date() } },
    ],
    deadline: { $lte: new Date() },
    eventId: { $lte: chainEventCount },
  }).lean();
  const expired = expiredCandidates.filter((evt) => {
    const verifyAt = evt.verifyAfter
      ? new Date(evt.verifyAfter).getTime()
      : new Date(evt.deadline).getTime() + getVerifyBufferMs(evt.category, Boolean(evt.isUserEvent));
    return verifyAt <= now;
  });
  if (!expired.length) return;

  resolving = true;

  try {
    console.log(`[Scheduler] Resolving ${expired.length} expired...`);
    const toResolve = [];
    for (const evt of expired) {
      try {
        const onChain = await getOnChainEvent(Prediction, evt.eventId);
        const alreadyResolved = Boolean(onChain?.resolved);
        if (alreadyResolved) {
          await PredictionEvent.updateOne(
            { eventId: evt.eventId },
            {
              resolved: true,
              resolvePending: false,
              outcome: Boolean(onChain?.outcome),
              aiReasoning: evt.aiReasoning || "Synced from chain: already resolved.",
              nextResolveRetryAt: null,
              lastResolveError: "",
            }
          );
          continue;
        }
        toResolve.push(evt);
      } catch {
        await PredictionEvent.updateOne(
          { eventId: evt.eventId },
          {
            resolved: true,
            resolvePending: false,
            outcome: false,
            aiReasoning: "Archived: event not found on current chain.",
            nextResolveRetryAt: null,
            lastResolveError: "",
          }
        );
      }
    }

    if (!toResolve.length) {
      resolving = false;
      return;
    }

    const resolutions = await resolveExpiredPredictions(toResolve);
    let nonce = await signer.getNonce();
    let ok = 0;

    for (const r of resolutions) {
      if (r.retryable) {
        const doc = await PredictionEvent.findOne({ eventId: r.eventId }).select("resolveAttempts").lean();
        const attempts = Number(doc?.resolveAttempts || 0) + 1;
        const retryDelayMs = Math.min(6 * 60 * 60 * 1000, attempts * 10 * 60 * 1000); // max 6h
        await PredictionEvent.updateOne(
          { eventId: r.eventId },
          {
            $set: {
              resolved: false,
              resolvePending: true,
              aiReasoning: r.reasoning || "Resolve pending",
              lastResolveError: r.reasoning || "Resolve pending",
              lastResolveTriedAt: new Date(),
              nextResolveRetryAt: new Date(Date.now() + retryDelayMs),
            },
            $inc: { resolveAttempts: 1 },
          }
        );
        continue;
      }

      try {
        const tx = await Prediction.resolveEvent(r.eventId, r.outcome, { nonce: nonce++ });
        await tx.wait();
        const onAfter = await getOnChainEvent(Prediction, r.eventId);
        const finished = Boolean(onAfter?.resolved);
        await PredictionEvent.updateOne(
          { eventId: r.eventId },
          {
            $set: {
              resolved: finished,
              resolvePending: !finished,
              outcome: finished ? r.outcome : null,
              aiReasoning: finished ? r.reasoning : "Resolution in progress (batched on-chain).",
              resolveAttempts: finished ? 0 : Number((await PredictionEvent.findOne({ eventId: r.eventId }).select("resolveAttempts").lean())?.resolveAttempts || 0),
              nextResolveRetryAt: finished ? null : new Date(Date.now() + 30 * 1000),
              lastResolveError: finished ? "" : "Batched resolution still in progress",
              lastResolveTriedAt: new Date(),
            },
          }
        );
        if (finished) {
          ok++;
          console.log(`  #${r.eventId}: ${r.outcome ? "YES" : "NO"} — ${r.reasoning?.slice(0, 70)}`);
        } else {
          console.log(`  #${r.eventId}: batched resolution in progress...`);
        }
      } catch (e) {
        const msg = e.message || "";
        if (msg.includes("Event not found")) {
          await PredictionEvent.updateOne(
            { eventId: r.eventId },
            {
              resolved: true,
              resolvePending: false,
              outcome: false,
              aiReasoning: "Archived: resolve failed because event is missing on current chain.",
              nextResolveRetryAt: null,
              lastResolveError: "",
            }
          );
          continue;
        }
        console.error(`  #${r.eventId}: ${msg.slice(0, 80)}`);
      }
    }

    stats.resolved += ok;
    if (io && ok > 0) io.emit("prediction:resolved", { count: ok });

    await refill();
  } catch (e) {
    console.error(`[Scheduler] resolve error: ${e.message}`);
  } finally {
    resolving = false;
  }
}

async function nightlyRetryPendingResolutions() {
  try {
    const pendingCount = await PredictionEvent.countDocuments({ resolved: false, resolvePending: true });
    if (!pendingCount) return;
    const res = await PredictionEvent.updateMany(
      { resolved: false, resolvePending: true },
      { $set: { nextResolveRetryAt: new Date() } }
    );
    if ((res.modifiedCount || 0) > 0) {
      console.log(`[Scheduler] Nightly retry unlocked ${res.modifiedCount} pending resolutions`);
    }
  } catch (e) {
    console.warn(`[Scheduler] Nightly retry skipped: ${e.message}`);
  }
}

async function distributeProtocolFeesIfDue() {
  try {
    const { Prediction } = getContracts();
    const signer = getSigner();
    if (!Prediction || !signer || !Prediction.getProtocolDistributionState || !Prediction.distributeProtocolFees) {
      return;
    }

    const state = await Prediction.getProtocolDistributionState();
    const pending = BigInt(state?.pendingAmount ?? state?.[0] ?? 0n);
    const secondsLeft = Number(state?.secondsLeft ?? state?.[2] ?? 0n);
    if (pending <= 0n || secondsLeft > 0) return;

    try {
      const tx = await Prediction.distributeProtocolFees();
      await tx.wait();
      console.log(`[Scheduler] Distributed batched protocol fees: ${pending.toString()} wei`);
    } catch (err) {
      const msg = String(err?.message || err || "");
      if (msg.includes("Distribution cooldown") || msg.includes("No protocol fees")) return;
      console.warn(`[Scheduler] Protocol fee distribution failed: ${msg.slice(0, 140)}`);
    }
  } catch (e) {
    console.warn(`[Scheduler] Protocol fee distribution check skipped: ${e.message}`);
  }
}

// ─── WEEKLY LEADERBOARD RESET + PRIZE DISTRIBUTION ──────────────────────────

async function weeklyCheck() {
  const elapsed = Date.now() - lastWeeklyReset;
  if (elapsed < WEEK_SECONDS * 1000) return;

  console.log("[Weekly] Starting weekly leaderboard reset and prize distribution...");

  try {
    const { Points, PrizePool, PrizePoolV2 } = getContracts();
    const signer = getSigner();
    const provider = getProvider();
    if (!Points || !PrizePool || !signer || !provider) return;

    // Get top users (up to 1000) from Points contract
    const [topAddrs, topPts] = await Points.getTopUsers(MAX_WEEKLY_WINNERS);
    const winners = [];
    for (let i = 0; i < topAddrs.length; i++) {
      if (topAddrs[i] !== "0x0000000000000000000000000000000000000000" && Number(topPts[i]) > 0) {
        winners.push({ address: topAddrs[i], points: Number(topPts[i]) });
      }
    }

    if (winners.length === 0) {
      console.log("[Weekly] No participants to reward");
      lastWeeklyReset = Date.now();
      return;
    }

    // Get prize pool balance
    const poolBalance = await PrizePool.getBalance();
    const pool = BigInt(poolBalance);

    if (pool === 0n) {
      console.log("[Weekly] Prize pool empty, skipping distribution");
      lastWeeklyReset = Date.now();
      return;
    }

    const winnersCount = determineWinnerCount(winners.length, pool);
    const selected = winners.slice(0, winnersCount);
    const shareByRank = buildDynamicShares(pool, winnersCount);
    console.log(`[Weekly] Pool: ${Number(pool) / 1e18} BNB, participants: ${winners.length}, winners: ${winnersCount}`);

    if (selected.length > 0) {
      if (PrizePoolV2) {
        const claims = [];
        let totalAllocation = 0n;
        for (let i = 0; i < selected.length; i++) {
          const amount = shareByRank[i];
          if (amount <= 0n) continue;
          claims.push({
            index: claims.length,
            address: selected[i].address.toLowerCase(),
            amount,
            rank: i + 1,
            points: selected[i].points,
          });
          totalAllocation += amount;
        }

        if (claims.length > 0 && totalAllocation > 0n) {
          const leaves = claims.map((c) =>
            ethers.keccak256(
              ethers.solidityPacked(["uint256", "address", "uint256"], [BigInt(c.index), c.address, c.amount])
            )
          );
          const { root, levels } = buildMerkleTree(leaves);
          const docs = claims.map((c) => ({
            ...c,
            amount: c.amount.toString(),
            proof: buildProof(levels, c.index),
          }));

          let nonce = await signer.getNonce();
          const tx = await PrizePoolV2.startEpoch(root, totalAllocation, { nonce: nonce++ });
          await tx.wait();
          const epochNum = Number(await PrizePoolV2.currentEpoch());

          await WeeklyPrizeEpoch.findOneAndUpdate(
            { epoch: epochNum },
            {
              $set: {
                epoch: epochNum,
                merkleRoot: root,
                totalAllocation: totalAllocation.toString(),
                winners: docs,
                winnerCount: docs.length,
                createdAt: new Date(),
              },
            },
            { upsert: true }
          );

          stats.prizesDistributed++;
          console.log(`[Weekly] PrizePoolV2 epoch #${epochNum} started (${docs.length} claimable winners)`);
          if (io) io.emit("prizes:distributed", { winners: docs.length, mode: "claim", epoch: epochNum });
        }
      } else {
        // Gas-safe chunking for up to 1000 winners.
        const CHUNK_SIZE = 150;
        let nonce = await signer.getNonce();
        let distributedWinners = 0;

        for (let start = 0; start < selected.length; start += CHUNK_SIZE) {
          const end = Math.min(start + CHUNK_SIZE, selected.length);
          const addrs = [];
          const shares = [];
          for (let i = start; i < end; i++) {
            const amount = shareByRank[i];
            if (amount > 0n) {
              addrs.push(selected[i].address);
              shares.push(amount);
            }
          }
          if (!addrs.length) continue;
          try {
            const tx = await PrizePool.distributePrizes(addrs, shares, { nonce: nonce++ });
            await tx.wait();
            distributedWinners += addrs.length;
          } catch (e) {
            console.error(`[Weekly] Distribution chunk failed (${start}-${end}): ${e.message?.slice(0, 100)}`);
          }
        }

        if (distributedWinners > 0) {
          stats.prizesDistributed++;
          console.log(`[Weekly] Distributed to ${distributedWinners} winners`);
          if (io) io.emit("prizes:distributed", { winners: distributedWinners, mode: "direct" });
        }
      }
    }

    // Reset weekly points in Points contract
    try {
      const totalUsers = Number(await Points.getUserCount());
      const BATCH = 200;
      let nonce2 = await signer.getNonce();
      for (let start = 0; start < totalUsers; start += BATCH) {
        const tx2 = await Points.resetWeeklyPointsBatch(start, BATCH, { nonce: nonce2++ });
        await tx2.wait();
      }
      console.log(`[Weekly] Reset weekly points in batches (${totalUsers} users)`);
    } catch (e) {
      console.error(`[Weekly] Reset failed: ${e.message?.slice(0, 100)}`);
    }

    // Reset in MongoDB
    await User.updateMany({}, { $set: { weeklyPoints: 0 } });

    lastWeeklyReset = Date.now();
    console.log("[Weekly] Complete!");
  } catch (e) {
    console.error(`[Weekly] Error: ${e.message}`);
  }
}

export function getSchedulerStatus() {
  const nextWeeklyReset = lastWeeklyReset + WEEK_SECONDS * 1000;
  return {
    initialized: schedulerInitialized,
    timersCount: schedulerTimers.length,
    generating, resolving, lastGenerate, stats, minActive: MIN_ACTIVE,
    generateIntervalMin: GENERATE_INTERVAL / 60000,
    resolveIntervalSec: RESOLVE_INTERVAL / 1000,
    nextWeeklyReset: new Date(nextWeeklyReset).toISOString(),
    weeklyResetIn: Math.max(0, Math.round((nextWeeklyReset - Date.now()) / 60000)) + " min",
  };
}

export async function runSchedulerKick() {
  await refill();
  return getSchedulerStatus();
}
