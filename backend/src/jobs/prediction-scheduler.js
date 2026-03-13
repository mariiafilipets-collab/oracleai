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
const REFILL_AI_THROTTLE_MS = 20 * 60 * 1000; // 20 minutes
const WEEKLY_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour
const NIGHTLY_RETRY_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const PROTOCOL_FEE_DISTRIBUTION_CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes
const QA_WATCHDOG_INTERVAL = 10 * 60 * 1000; // 10 minutes
const MAX_REFILL_BATCH_ROUNDS = 4;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const MAX_WEEKLY_WINNERS = 1000;
const MIN_WINNER_REWARD_WEI = 200000000000000n; // 0.0002 BNB
const PRETRANSLATE_TIMEOUT_MS = 15000;
const SYNC_TIMEOUT_MS = 12000;
const DEFAULT_RESULT_VERIFY_BUFFER_MS = 10 * 60 * 1000;
const CATEGORY_VERIFY_BUFFER_MINUTES = {
  SPORTS: 20,
  POLITICS: 60,
  ECONOMY: 60,
  CRYPTO: 60,
  CLIMATE: 60,
};
const CATEGORY_VOTE_CLOSE_LEAD_MINUTES = {
  SPORTS: 1,
  POLITICS: 30,
  ECONOMY: 60,
  CRYPTO: 60,
  CLIMATE: 30,
};
const CATEGORY_MIN_RESULT_DELAY_MINUTES = {
  SPORTS: 180,
  POLITICS: 90,
  ECONOMY: 60,
  CRYPTO: 60,
  CLIMATE: 90,
};
const CATEGORY_MAX_VERIFY_DEADLINE_GAP_HOURS = {
  SPORTS: 6,
  POLITICS: 12,
  ECONOMY: 24,
  CRYPTO: 24,
  CLIMATE: 24,
};

let io = null;
let generating = false;
let resolving = false;
let lastGenerate = 0;
let lastWeeklyReset = 0;
let stats = { generated: 0, resolved: 0, prizesDistributed: 0, cycles: 0 };
let schedulerInitialized = false;
const schedulerTimers = [];
let qaLastRunAt = 0;
let qaLastReport = {
  ok: true,
  scanned: 0,
  issues: {},
  samples: [],
};
const qaHistory = [];
const QA_HISTORY_MAX = 120;

const CATEGORY_NAMES = ["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"];
const ALLOWED_CATEGORIES = new Set(CATEGORY_NAMES);
const TITLE_STOP_WORDS = new Set([
  "will", "the", "a", "an", "on", "by", "at", "before", "after", "today", "tonight",
  "this", "that", "in", "to", "of", "for", "and", "or", "be", "is", "are", "do", "does",
  "did", "with", "utc", "march", "april", "may", "june", "july", "august", "september",
  "october", "november", "december", "january", "february", "jan", "feb", "mar", "apr",
  "jun", "jul", "aug", "sep", "oct", "nov", "dec",
]);

function normalizeTitleForSimilarity(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !TITLE_STOP_WORDS.has(t) && !/^\d+$/.test(t))
    .join(" ");
}

function isNearDuplicateTitle(a, b) {
  const na = normalizeTitleForSimilarity(a);
  const nb = normalizeTitleForSimilarity(b);
  if (!na || !nb) return false;
  const sa = sportsFixtureSignature(a);
  const sb = sportsFixtureSignature(b);
  if (sa && sb && sa === sb) return true;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const aTokens = new Set(na.split(/\s+/).filter(Boolean));
  const bTokens = new Set(nb.split(/\s+/).filter(Boolean));
  if (!aTokens.size || !bTokens.size) return false;
  let inter = 0;
  for (const t of aTokens) if (bTokens.has(t)) inter++;
  const uni = aTokens.size + bTokens.size - inter;
  const similarity = uni > 0 ? inter / uni : 0;
  return similarity >= 0.82;
}

function extractDateKey(title) {
  const s = String(title || "").toLowerCase();
  const monthMap = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
    jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const monthMatch = s.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})\b/i);
  if (monthMatch) {
    const m = monthMap[String(monthMatch[1] || "").toLowerCase()] || 0;
    const d = Number(monthMatch[2] || 0);
    if (m && d > 0 && d <= 31) return `${m}-${d}`;
  }
  const numeric = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/);
  if (numeric) {
    const m = Number(numeric[1] || 0);
    const d = Number(numeric[2] || 0);
    if (m > 0 && m <= 12 && d > 0 && d <= 31) return `${m}-${d}`;
  }
  return "";
}

function normalizeTeamChunk(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) =>
      x &&
      ![
        "will", "the", "this", "match", "game", "today", "tonight", "on", "by", "at", "and", "or",
        "beat", "defeat", "defeats", "defeated", "win", "wins", "won", "against", "vs", "versus",
      ].includes(x) &&
      !/^\d+$/.test(x)
    )
    .slice(0, 4)
    .join(" ");
}

function sportsFixtureSignature(title) {
  const s = String(title || "");
  let m = s.match(/will\s+(.+?)\s+(?:beat|defeat|win(?:\s+against)?|lose to)\s+(.+?)(?:\s+on\s+|\s+by\s+|\?|$)/i);
  if (!m) {
    m = s.match(/will\s+(.+?)\s+(?:vs\.?|versus)\s+(.+?)(?:\s+on\s+|\s+by\s+|\?|$)/i);
  }
  if (!m) return "";
  const a = normalizeTeamChunk(m[1]);
  const b = normalizeTeamChunk(m[2]);
  if (!a || !b) return "";
  const dateKey = extractDateKey(s);
  const sides = [a, b].sort();
  return `${sides[0]}|${sides[1]}|${dateKey || "na"}`;
}

function genericCategorySignature(title, category) {
  const c = String(category || "").toUpperCase();
  const norm = normalizeTitleForSimilarity(title);
  if (!norm) return "";
  const topicAliases = [
    { key: "SP500", re: /\b(s&p|sp 500|s 500)\b/i },
    { key: "NASDAQ", re: /\b(nasdaq)\b/i },
    { key: "DOW", re: /\b(dow|dow jones)\b/i },
    { key: "BTC", re: /\b(bitcoin|btc)\b/i },
    { key: "ETH", re: /\b(ethereum|eth)\b/i },
    { key: "GOLD", re: /\b(gold)\b/i },
    { key: "WTI", re: /\b(wti|crude oil|oil)\b/i },
    { key: "US_CPI", re: /\b(cpi|inflation)\b/i },
  ];
  const topic = topicAliases.find((x) => x.re.test(String(title || "")))?.key || "";
  const tokens = norm
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t.length > 2)
    .slice(0, 10);
  const dateKey = extractDateKey(title) || "na";
  const nums = Array.from(new Set((String(title || "").match(/\d+(?:\.\d+)?/g) || []).slice(0, 3)));
  const numKey = nums.join(",") || "na";
  if (c === "ECONOMY" || c === "CRYPTO") {
    if (topic) return `${c}|${topic}|${dateKey}`;
    return `${c}|${dateKey}|${numKey}|${tokens.slice(0, 5).join(" ")}`;
  }
  return `${c}|${dateKey}|${tokens.slice(0, 6).join(" ")}`;
}

function marketTopicKey(title, category) {
  const c = String(category || "").toUpperCase();
  if (c !== "ECONOMY" && c !== "CRYPTO") return "";
  const s = String(title || "");
  const topicAliases = [
    { key: "SP500", re: /\b(s&p|sp 500|s 500)\b/i },
    { key: "NASDAQ", re: /\b(nasdaq)\b/i },
    { key: "DOW", re: /\b(dow|dow jones)\b/i },
    { key: "BTC", re: /\b(bitcoin|btc)\b/i },
    { key: "ETH", re: /\b(ethereum|eth)\b/i },
    { key: "GOLD", re: /\b(gold)\b/i },
    { key: "WTI", re: /\b(wti|crude oil|oil)\b/i },
    { key: "US_CPI", re: /\b(cpi|inflation)\b/i },
  ];
  return topicAliases.find((x) => x.re.test(s))?.key || "";
}

function climateTopicKey(title, category) {
  const c = String(category || "").toUpperCase();
  if (c !== "CLIMATE") return "";
  const s = String(title || "");
  const dateKey = extractDateKey(s) || "na";
  const hazard =
    (/\b(tornado|twister)\b/i.test(s) && "TORNADO")
    || (/\b(hurricane|typhoon|cyclone)\b/i.test(s) && "CYCLONE")
    || (/\b(storm|thunderstorm|hail)\b/i.test(s) && "STORM")
    || (/\b(flood|flooding|rainfall|rain)\b/i.test(s) && "FLOOD")
    || (/\b(wildfire|fire)\b/i.test(s) && "WILDFIRE")
    || (/\b(heatwave|heat|temperature)\b/i.test(s) && "HEAT")
    || (/\b(earthquake|quake)\b/i.test(s) && "EARTHQUAKE")
    || (/\b(snow|blizzard)\b/i.test(s) && "SNOW")
    || "GENERIC";
  const ef = s.match(/\bEF\s*([0-5])\+?\b/i);
  const cat = s.match(/\bcat(?:egory)?\s*([1-5])\b/i);
  const mag = s.match(/\bM\s*([0-9]+(?:\.[0-9]+)?)\b/i);
  const intensity = ef ? `EF${ef[1]}` : cat ? `CAT${cat[1]}` : mag ? `M${mag[1]}` : "na";
  return `${c}|${hazard}|${intensity}|${dateKey}`;
}

function isNearDuplicateEvent(a, b) {
  const ca = String(a?.category || "").toUpperCase();
  const cb = String(b?.category || "").toUpperCase();
  if (ca && cb && ca === cb) {
    const cla = climateTopicKey(a?.title, ca);
    const clb = climateTopicKey(b?.title, cb);
    if (cla && clb && cla === clb) return true;
    const ta = marketTopicKey(a?.title, ca);
    const tb = marketTopicKey(b?.title, cb);
    if (ta && tb && ta === tb) return true;
    const sa = ca === "SPORTS" ? sportsFixtureSignature(a?.title) : genericCategorySignature(a?.title, ca);
    const sb = cb === "SPORTS" ? sportsFixtureSignature(b?.title) : genericCategorySignature(b?.title, cb);
    if (sa && sb && sa === sb) return true;
  }
  return isNearDuplicateTitle(a?.title, b?.title);
}
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

export function getVoteCloseLeadMs(category, isUserEvent = false) {
  if (isUserEvent) return 10 * 60 * 1000;
  const key = String(category || "CRYPTO").toUpperCase();
  const minutes = CATEGORY_VOTE_CLOSE_LEAD_MINUTES[key] || 10;
  return minutes * 60 * 1000;
}

function getMinResultDelayMs(category) {
  const key = String(category || "CRYPTO").toUpperCase();
  const minutes = CATEGORY_MIN_RESULT_DELAY_MINUTES[key] || 15;
  return minutes * 60 * 1000;
}

function getMaxVerifyDeadlineGapMs(category, isUserEvent = false) {
  if (isUserEvent) return 72 * 60 * 60 * 1000;
  const key = String(category || "CRYPTO").toUpperCase();
  const hours = CATEGORY_MAX_VERIFY_DEADLINE_GAP_HOURS[key] || 24;
  return hours * 60 * 60 * 1000;
}

function useEventStartAnchor(category, isUserEvent = false) {
  if (isUserEvent) return false;
  const key = String(category || "").toUpperCase();
  // Strict anti-cheat start anchoring is required for sports fixtures.
  // For other categories, eventStartAtUtc often means "window starts" and can
  // incorrectly force very early vote close times.
  return key === "SPORTS";
}

function parseIsoUtc(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

function parseTitleDateEndOfDayUtc(title) {
  const s = String(title || "");
  const monthMap = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4,
    june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8,
    october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
  };
  const m = s.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:,\s*(20\d{2}))?\b/i);
  if (!m) return 0;
  const month = monthMap[String(m[1] || "").toLowerCase()];
  const day = Number(m[2] || 0);
  if (!Number.isFinite(month) || day < 1 || day > 31) return 0;
  const year = m[3] ? Number(m[3]) : new Date().getUTCFullYear();
  return Date.UTC(year, month, day, 23, 59, 59);
}

function hasExplicitUtcTime(title) {
  return /\b\d{1,2}:\d{2}\s*UTC\b/i.test(String(title || ""));
}

function inferTimePrecision(title, verifyAt) {
  const t = String(title || "");
  if (/\b\d{1,2}:\d{2}\s*UTC\b/i.test(t) || verifyAt) return "EXACT_MINUTE";
  if (/\b\d{1,2}\s*(AM|PM)\b/i.test(t)) return "EXACT_HOUR";
  return "DATE_ONLY";
}

export function buildEventTiming({ category, hoursToResolve, verifyAtUtc, eventStartAtUtc, isUserEvent = false, title = "" }) {
  const now = Date.now();
  const resolveMs = Math.max(6, Number(hoursToResolve || 8)) * 3600000;
  const parsedVerifyAt = parseIsoUtc(verifyAtUtc);
  const parsedEventStart = parseIsoUtc(eventStartAtUtc);
  if (!isUserEvent && useEventStartAnchor(category, isUserEvent) && !parsedEventStart) {
    return {
      deadline: new Date(now + 60_000),
      verifyAfter: parsedVerifyAt && parsedVerifyAt.getTime() > now + 60_000 ? parsedVerifyAt : new Date(now + resolveMs),
      verifyBufferMs: getVerifyBufferMs(category, isUserEvent),
      voteCloseLeadMs: getVoteCloseLeadMs(category, isUserEvent),
      isValidWindow: false,
    };
  }
  let resultCheckAt = parsedVerifyAt && parsedVerifyAt.getTime() > now + 60_000
    ? parsedVerifyAt
    : new Date(now + resolveMs);
  const cat = String(category || "").toUpperCase();
  const hasExplicitTimeInTitle = hasExplicitUtcTime(title);
  const hasCloseKeyword = /\b(close|closing|settle|settlement)\b/i.test(String(title || ""));
  const dateOnlyEodTs = (!hasExplicitTimeInTitle && (cat === "ECONOMY" || cat === "CLIMATE"))
    ? parseTitleDateEndOfDayUtc(title)
    : 0;
  if (dateOnlyEodTs > now + 60_000 && resultCheckAt.getTime() < dateOnlyEodTs) {
    resultCheckAt = new Date(dateOnlyEodTs);
  }
  if (!isUserEvent && (cat === "ECONOMY" || cat === "CRYPTO") && hasCloseKeyword && !hasExplicitTimeInTitle) {
    const eodTs = parseTitleDateEndOfDayUtc(title);
    if (eodTs > now + 60_000 && resultCheckAt.getTime() < eodTs) {
      resultCheckAt = new Date(eodTs);
    }
  }
  if (parsedEventStart && useEventStartAnchor(category, isUserEvent)) {
    const minResultTs = parsedEventStart.getTime() + getMinResultDelayMs(category);
    if (resultCheckAt.getTime() < minResultTs) {
      resultCheckAt = new Date(minResultTs);
    }
  }
  const verifyBufferMs = getVerifyBufferMs(category, isUserEvent);
  const voteCloseLeadMs = getVoteCloseLeadMs(category, isUserEvent);
  const latestByVerifyMs = resultCheckAt.getTime() - verifyBufferMs;
  const latestByDayRuleMs = dateOnlyEodTs > 0 ? dateOnlyEodTs - 12 * 60 * 60 * 1000 : Number.POSITIVE_INFINITY;
  const latestByStartMs =
    parsedEventStart && useEventStartAnchor(category, isUserEvent)
      ? parsedEventStart.getTime() - voteCloseLeadMs
      : Number.POSITIVE_INFINITY;
  let candidateDeadlineMs = Math.min(latestByVerifyMs, latestByStartMs, latestByDayRuleMs);
  const maxGapMs = getMaxVerifyDeadlineGapMs(category, isUserEvent);
  const rawGapMs = resultCheckAt.getTime() - candidateDeadlineMs;
  if (Number.isFinite(candidateDeadlineMs) && rawGapMs > maxGapMs) {
    // Guard against overly early vote-close windows (days before resolution).
    // Prefer category lead policy, but keep within sane max-gap envelope.
    const latestAllowedByGap = resultCheckAt.getTime() - maxGapMs;
    const preferredByLead = resultCheckAt.getTime() - voteCloseLeadMs;
    candidateDeadlineMs = Math.max(latestAllowedByGap, preferredByLead);
  }
  // Never push deadline past event start for start-anchored categories (SPORTS).
  if (parsedEventStart && useEventStartAnchor(category, isUserEvent)) {
    const hardCap = parsedEventStart.getTime() - voteCloseLeadMs;
    if (candidateDeadlineMs > hardCap) {
      candidateDeadlineMs = hardCap;
    }
  }
  const isValidWindow = Number.isFinite(candidateDeadlineMs) && candidateDeadlineMs > now + 60_000;
  const voteDeadlineMs = isValidWindow ? candidateDeadlineMs : now + 60_000;
  return {
    deadline: new Date(voteDeadlineMs),
    verifyAfter: resultCheckAt,
    verifyBufferMs,
    voteCloseLeadMs,
    isValidWindow,
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
    schedulerTimers.push(setInterval(runQualityWatchdog, QA_WATCHDOG_INTERVAL));

    console.log(`[Scheduler] Running. Resolve: ${RESOLVE_INTERVAL / 1000}s | Refill: ${REFILL_CHECK_INTERVAL / 60000}min | Gen: ${GENERATE_INTERVAL / 60000}min | Weekly: ${WEEKLY_CHECK_INTERVAL / 60000}min | Fees: ${PROTOCOL_FEE_DISTRIBUTION_CHECK_INTERVAL / 60000}min`);

    // Run startup sync in background to avoid blocking interval registration.
    (async () => {
      try {
        await bootstrapPredictionsFromChain();
        await syncUnresolvedWithChain();
        await resyncArchivedFromChain();
        await refill();
        await runQualityWatchdog();
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
    const deficit = MIN_ACTIVE - active;
    const aiRecentlyRan = Date.now() - Number(lastGenerate || 0) < REFILL_AI_THROTTLE_MS;
    const criticallyLow = active < Math.max(5, Math.floor(MIN_ACTIVE * 0.25));
    if (aiRecentlyRan && !criticallyLow) {
      const leftSec = Math.max(0, Math.round((REFILL_AI_THROTTLE_MS - (Date.now() - Number(lastGenerate || 0))) / 1000));
      console.log(`[Scheduler] Refill throttled: ${active}/${MIN_ACTIVE} active, AI cooldown ${leftSec}s`);
      return;
    }
    console.log(`[Scheduler] ${active}/${MIN_ACTIVE} active — refilling (need +${deficit})...`);
    await publishNewBatch({ targetToCreate: deficit, maxRounds: MAX_REFILL_BATCH_ROUNDS });
  }
}

async function scheduledGenerate() {
  const active = await PredictionEvent.countDocuments({ resolved: false, deadline: { $gt: new Date() } });
  if (active < MIN_ACTIVE * 2) {
    console.log(`[Scheduler] Scheduled generation (${active} active)...`);
    await publishNewBatch({ targetToCreate: Math.max(5, MIN_ACTIVE - active), maxRounds: 2 });
  }
}

async function publishNewBatch(options = {}) {
  if (generating) return;
  generating = true;

  try {
    const { Prediction } = getContracts();
    const signer = getSigner();
    if (!Prediction || !signer) { generating = false; return; }
    const targetToCreate = Math.max(1, Number(options?.targetToCreate || 5));
    const maxRounds = Math.max(1, Number(options?.maxRounds || 1));
    const activeTitles = await PredictionEvent.find({ resolved: false, deadline: { $gt: new Date() } })
      .select("title category")
      .limit(1000)
      .lean();
    const existing = activeTitles.map((x) => ({
      title: String(x.title || ""),
      category: String(x.category || "CRYPTO").toUpperCase(),
    }));
    const activeByCategory = Object.fromEntries(CATEGORY_NAMES.map((c) => [c, 0]));
    for (const row of existing) {
      if (ALLOWED_CATEGORIES.has(row.category)) {
        activeByCategory[row.category] = (activeByCategory[row.category] || 0) + 1;
      }
    }
    const categoryTarget = Math.max(1, Math.floor(MIN_ACTIVE / CATEGORY_NAMES.length));
    const categorySoftCap = categoryTarget + 1;
    const categoryDeficit = (cat) => Math.max(0, categoryTarget - Number(activeByCategory[String(cat || "").toUpperCase()] || 0));
    const hasAnyCategoryDeficit = () => CATEGORY_NAMES.some((c) => categoryDeficit(c) > 0);
    const climateTopicCounts = new Map();
    for (const row of existing) {
      if (row.category !== "CLIMATE") continue;
      const key = climateTopicKey(row.title, row.category);
      if (!key) continue;
      climateTopicCounts.set(key, (climateTopicCounts.get(key) || 0) + 1);
    }
    const createdTitles = [];
    let nonce = await signer.getNonce();
    let ok = 0;

    for (let round = 1; round <= maxRounds && ok < targetToCreate; round++) {
      const neededCategories = CATEGORY_NAMES.filter((c) => categoryDeficit(c) > 0);
      const generationCategories = neededCategories.length ? neededCategories : CATEGORY_NAMES;
      const predictions = await generateDailyPredictions({
        avoidTitles: [...existing, ...createdTitles].map((x) => String(x?.title || "")).filter(Boolean),
        categories: generationCategories,
      });
      const seenInBatch = [];
      const unique = predictions.filter((p) => {
        const t = String(p?.title || "");
        if (!t) return false;
        if (seenInBatch.some((x) => isNearDuplicateEvent(x, p))) return false;
        if (existing.some((x) => isNearDuplicateEvent(x, p))) return false;
        if (createdTitles.some((x) => isNearDuplicateEvent(x, p))) return false;
        seenInBatch.push({ title: t, category: p?.category || "CRYPTO" });
        return true;
      });
      if (!unique.length) {
        console.warn(`[Scheduler] Round ${round}/${maxRounds}: no unique candidates`);
        continue;
      }
      let localized = [];
      try {
        localized = await Promise.race([
          pretranslateEvents(unique),
          new Promise((resolve) => setTimeout(() => resolve([]), PRETRANSLATE_TIMEOUT_MS)),
        ]);
        if (!Array.isArray(localized)) localized = [];
      } catch {
        localized = [];
      }

      for (let i = 0; i < unique.length && ok < targetToCreate; i++) {
        const p = unique[i];
        if (!p?.description || String(p.description).trim().length < 80) {
          continue;
        }
        const normalizedCategory = normalizeStoredCategory(
          p.category,
          p.title,
          p.description || "",
          false
        );
        const deficitsRemaining = hasAnyCategoryDeficit();
        const deficitNow = categoryDeficit(normalizedCategory);
        if (deficitsRemaining && deficitNow <= 0) {
          let hasDeficitAhead = false;
          for (let j = i + 1; j < unique.length; j++) {
            const n = unique[j];
            const nCat = normalizeStoredCategory(n?.category, n?.title, n?.description || "", false);
            if (categoryDeficit(nCat) > 0) {
              hasDeficitAhead = true;
              break;
            }
          }
          if (hasDeficitAhead) continue;
          if ((activeByCategory[normalizedCategory] || 0) >= categorySoftCap) continue;
        }
        if (normalizedCategory === "CLIMATE") {
          const climateKey = climateTopicKey(p.title, normalizedCategory);
          if (climateKey && (climateTopicCounts.get(climateKey) || 0) >= 1) {
            continue;
          }
        }
        const timing = buildEventTiming({
          category: normalizedCategory,
          hoursToResolve: p.hoursToResolve || 8,
          verifyAtUtc: p.verifyAtUtc,
          eventStartAtUtc: p.eventStartAtUtc,
          isUserEvent: false,
          title: p.title,
        });
        if (!timing.isValidWindow) {
          continue;
        }
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
          createdTitles.push({ title: String(p.title || ""), category: normalizedCategory });
          activeByCategory[normalizedCategory] = (activeByCategory[normalizedCategory] || 0) + 1;
          if (normalizedCategory === "CLIMATE") {
            const climateKey = climateTopicKey(p.title, normalizedCategory);
            if (climateKey) {
              climateTopicCounts.set(climateKey, (climateTopicCounts.get(climateKey) || 0) + 1);
            }
          }
        } catch (e) {
          console.error(`[Scheduler] create: ${e.message?.slice(0, 80)}`);
        }
      }
    }

    lastGenerate = Date.now();
    stats.generated += ok;
    stats.cycles++;
    console.log(`[Scheduler] Published ${ok} (target ${targetToCreate}, rounds ${maxRounds})`);
    if (io) io.emit("prediction:new", { count: ok });
  } catch (e) {
    console.error(`[Scheduler] gen error: ${e.message}`);
  } finally {
    generating = false;
  }
}

function inferCategoryFromText(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(vs|versus|match|fixture|derby|league|cup|goal|score|scorer|assist|player|team|coach|lineup|penalty|football|soccer|basketball|tennis|hockey|baseball|cricket|mma|ufc|f1|formula 1|motogp|grand prix|gp|verstappen|hamilton|nba|nfl|mlb|nhl|uefa|fifa|premier league|la liga|laliga|serie a|bundesliga|champions league|europa league|beat|defeat|defeats|defeated|lose to|lost to|arsenal|manchester|man utd|manchester united|liverpool|chelsea|tottenham|real madrid|barcelona|atletico|bayern|psg|juventus|inter|milan|dortmund|burnley|bournemouth|aston villa|crystal palace|leeds|nottingham forest|west ham|newcastle)\b/.test(t)) {
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

function inferCategoryStrong(text) {
  const t = String(text || "").toLowerCase();
  // Require unambiguous sports keywords; "beat"/"match"/"score" alone are too generic
  if (/\b(defeat|defeats|defeated|lose to|lost to|vs|versus|fixture|derby|league|cup|goal|goalkeeper|arsenal|manchester|man utd|liverpool|chelsea|tottenham|real madrid|barcelona|atletico|bayern|psg|juventus|inter|milan|burnley|bournemouth|aston villa|west ham|newcastle|everton|nba|nfl|mlb|nhl|ufc|mma|f1|formula 1)\b/.test(t)) {
    return "SPORTS";
  }
  // "beat" is SPORTS only when followed by a team-like word (not "expectations", "estimates", etc.)
  if (/\b(beat)\b/.test(t) && /\b(arsenal|manchester|man utd|liverpool|chelsea|tottenham|real madrid|barcelona|atletico|bayern|psg|juventus|inter|milan|burnley|bournemouth|aston villa|west ham|newcastle|everton|spurs)\b/.test(t)) {
    return "SPORTS";
  }
  if (/\b(tornado|hail|hurricane|earthquake|wildfire|flood|heatwave|temperature|weather|climate|rainfall|cyclone|storm)\b/.test(t)) {
    return "CLIMATE";
  }
  if (/\b(election|parliament|congress|senate|president|ceasefire|sanction|summit|government|minister|white house|vote)\b/.test(t)) {
    return "POLITICS";
  }
  if (/\b(cpi|inflation|gdp|fed|ecb|interest rate|jobs report|payrolls|dow|nasdaq|s&p|gold|oil|brent|wti|bond|yield)\b/.test(t)) {
    return "ECONOMY";
  }
  if (/\b(bitcoin|btc|ethereum|eth|solana|xrp|crypto|token|etf|on-chain|wallet|binance|coinbase)\b/.test(t)) {
    return "CRYPTO";
  }
  return "";
}

function normalizeStoredCategory(eventCategory, title, description, isUserEvent) {
  const modelCategory = ALLOWED_CATEGORIES.has(String(eventCategory || "").toUpperCase())
    ? String(eventCategory).toUpperCase()
    : "CRYPTO";
  if (isUserEvent) return modelCategory;
  // Only match against title to avoid false positives from description keywords
  // (e.g. "beat" in "market beat expectations" triggering SPORTS)
  const strong = inferCategoryStrong(title || "");
  if (strong && strong !== modelCategory) return strong;
  return modelCategory;
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
      .select("eventId verifyAfter eventStartAtUtc category isUserEvent")
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
        const derivedVerifyTs =
          deadline.getTime() + getVerifyBufferMs(normalizedCategory, Boolean(on.isUserEvent));
        const existingVerifyTs = row?.verifyAfter ? new Date(row.verifyAfter).getTime() : 0;
        const eventStartTs = row?.eventStartAtUtc ? new Date(row.eventStartAtUtc).getTime() : 0;
        const minByStartTs = eventStartTs
          && useEventStartAnchor(normalizedCategory, Boolean(on.isUserEvent))
          ? eventStartTs + getMinResultDelayMs(normalizedCategory)
          : 0;
        const verifyAfter = new Date(
          Math.max(
            derivedVerifyTs,
            Number.isFinite(existingVerifyTs) ? existingVerifyTs : 0,
            Number.isFinite(minByStartTs) ? minByStartTs : 0
          )
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
        const retryDelayMs = 60 * 60 * 1000; // fixed 1h retry for unresolved/no-result cases
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

async function runQualityWatchdog() {
  try {
    const now = Date.now();
    const active = await PredictionEvent.find({ resolved: false, deadline: { $gt: new Date() } })
      .select("eventId title description category deadline verifyAfter eventStartAtUtc isUserEvent")
      .lean();
    const issues = {
      categoryMismatch: 0,
      sportsMissingStart: 0,
      sportsLeadBad: 0,
      sportsVerifyTooEarly: 0,
      verifyLeDeadline: 0,
      dayRuleBad: 0,
      voteWindowTooEarly: 0,
    };
    const samples = [];
    const corrections = [];
    for (const evt of active) {
      const cat = String(evt?.category || "").toUpperCase();
      const title = String(evt?.title || "");
      const desc = String(evt?.description || "");
      const deadlineTs = new Date(evt?.deadline).getTime();
      const verifyTs = new Date(evt?.verifyAfter || evt?.deadline).getTime();
      const startTs = evt?.eventStartAtUtc ? new Date(evt.eventStartAtUtc).getTime() : 0;
      const strong = inferCategoryStrong(title);
      if (strong && strong !== cat && !evt?.isUserEvent) {
        issues.categoryMismatch++;
        const correction = { category: strong };
        // When correcting to SPORTS, recalculate deadline to respect event start anchoring
        if (strong === "SPORTS" && startTs) {
          const reTiming = buildEventTiming({
            category: strong,
            hoursToResolve: Math.max(6, Math.round((verifyTs - now) / 3600000)),
            verifyAtUtc: new Date(verifyTs).toISOString(),
            eventStartAtUtc: new Date(startTs).toISOString(),
            isUserEvent: false,
            title,
          });
          if (reTiming.isValidWindow) {
            correction.deadline = reTiming.deadline;
            correction.verifyAfter = reTiming.verifyAfter;
          }
        }
        corrections.push({
          updateOne: {
            filter: { eventId: evt.eventId },
            update: { $set: correction },
          },
        });
        if (samples.length < 12) samples.push({ eventId: evt.eventId, type: "categoryMismatch", from: cat, to: strong, title });
      }
      if (verifyTs <= deadlineTs) {
        issues.verifyLeDeadline++;
        if (samples.length < 12) samples.push({ eventId: evt.eventId, type: "verify<=deadline", title });
      }
      const maxGapMs = getMaxVerifyDeadlineGapMs(cat, Boolean(evt?.isUserEvent));
      const timingGapMs = verifyTs - deadlineTs;
      if (!evt?.isUserEvent && timingGapMs > maxGapMs) {
        issues.voteWindowTooEarly++;
        corrections.push({
          updateOne: {
            filter: { eventId: evt.eventId },
            update: {
              $set: {
                resolved: true,
                resolvePending: false,
                outcome: false,
                aiReasoning: "Archived: vote window was mis-timed (closed too early vs verification).",
                nextResolveRetryAt: null,
                lastResolveError: "",
              },
            },
          },
        });
        if (samples.length < 12) {
          samples.push({
            eventId: evt.eventId,
            type: "voteWindowTooEarly",
            gapHours: Math.round((timingGapMs / 3600000) * 100) / 100,
            title,
          });
        }
      }
      if (cat === "SPORTS") {
        if (!startTs) {
          issues.sportsMissingStart++;
          // Archive — can't enforce anti-cheat without kickoff time
          corrections.push({
            updateOne: {
              filter: { eventId: evt.eventId },
              update: {
                $set: {
                  resolved: true,
                  resolvePending: false,
                  outcome: false,
                  aiReasoning: "Archived: SPORTS event missing eventStartAtUtc (anti-cheat cannot be enforced).",
                  nextResolveRetryAt: null,
                  lastResolveError: "",
                },
              },
            },
          });
          if (samples.length < 12) samples.push({ eventId: evt.eventId, type: "sportsMissingStart", title });
        } else {
          const leadMin = Math.round((startTs - deadlineTs) / 60000);
          const lagMin = Math.round((verifyTs - startTs) / 60000);
          if (leadMin !== 1) {
            issues.sportsLeadBad++;
            if (samples.length < 12) samples.push({ eventId: evt.eventId, type: "sportsLeadBad", leadMin, title });
            // Fix: recalculate deadline or archive if match already started
            if (startTs <= now) {
              // Match already started, archive the event
              corrections.push({
                updateOne: {
                  filter: { eventId: evt.eventId },
                  update: {
                    $set: {
                      resolved: true,
                      resolvePending: false,
                      outcome: false,
                      aiReasoning: "Archived: voting was still open after match started (bad lead time).",
                      nextResolveRetryAt: null,
                      lastResolveError: "",
                    },
                  },
                },
              });
            } else {
              // Match not started yet, fix deadline to start - 1 min
              const fixedDeadline = new Date(startTs - getVoteCloseLeadMs(cat, false));
              if (fixedDeadline.getTime() > now + 60_000) {
                corrections.push({
                  updateOne: {
                    filter: { eventId: evt.eventId },
                    update: { $set: { deadline: fixedDeadline } },
                  },
                });
              }
            }
          }
          if (lagMin < 180) {
            issues.sportsVerifyTooEarly++;
            if (samples.length < 12) samples.push({ eventId: evt.eventId, type: "sportsVerifyTooEarly", lagMin, title });
          }
        }
      }
      if ((cat === "ECONOMY" || cat === "CLIMATE") && !hasExplicitUtcTime(title)) {
        const eodTs = parseTitleDateEndOfDayUtc(title);
        if (eodTs > now + 60_000) {
          const latestDeadline = eodTs - 12 * 60 * 60 * 1000;
          if (deadlineTs > latestDeadline || verifyTs < eodTs) {
            issues.dayRuleBad++;
            if (samples.length < 12) {
              samples.push({
                eventId: evt.eventId,
                type: "dayRuleBad",
                title,
              });
            }
          }
        }
      }
    }
    if (corrections.length) {
      await PredictionEvent.bulkWrite(corrections, { ordered: false });
    }
    const totalIssues = Object.values(issues).reduce((s, v) => s + Number(v || 0), 0);
    qaLastRunAt = Date.now();
    qaLastReport = {
      ok: totalIssues === 0,
      scanned: active.length,
      issues,
      samples,
    };
    qaHistory.unshift({
      runAt: new Date(qaLastRunAt).toISOString(),
      ok: qaLastReport.ok,
      scanned: qaLastReport.scanned,
      issues: { ...issues },
      sampleCount: samples.length,
      samples,
    });
    if (qaHistory.length > QA_HISTORY_MAX) {
      qaHistory.length = QA_HISTORY_MAX;
    }
    if (totalIssues === 0) {
      console.log(`[QA] PASS scanned=${active.length}`);
    } else {
      console.warn(`[QA] FAIL scanned=${active.length} issues=${JSON.stringify(issues)}`);
    }
  } catch (e) {
    qaLastRunAt = Date.now();
    qaLastReport = {
      ok: false,
      scanned: 0,
      issues: { runtimeError: 1 },
      samples: [{ type: "runtimeError", message: String(e?.message || e).slice(0, 160) }],
    };
    qaHistory.unshift({
      runAt: new Date(qaLastRunAt).toISOString(),
      ok: false,
      scanned: 0,
      issues: { runtimeError: 1 },
      sampleCount: 1,
      samples: qaLastReport.samples,
    });
    if (qaHistory.length > QA_HISTORY_MAX) {
      qaHistory.length = QA_HISTORY_MAX;
    }
    console.warn(`[QA] Watchdog error: ${e.message}`);
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
    qaWatchdog: {
      intervalMin: QA_WATCHDOG_INTERVAL / 60000,
      lastRunAt: qaLastRunAt ? new Date(qaLastRunAt).toISOString() : null,
      report: qaLastReport,
    },
    aiThrottle: {
      refillThrottleSec: Math.round(REFILL_AI_THROTTLE_MS / 1000),
      secondsSinceLastGenerate: lastGenerate ? Math.round((Date.now() - lastGenerate) / 1000) : null,
    },
  };
}

export async function runSchedulerKick() {
  await refill();
  await runQualityWatchdog();
  return getSchedulerStatus();
}

export function getQaHistory(limit = 20) {
  const n = Math.max(1, Math.min(100, Number(limit || 20)));
  return qaHistory.slice(0, n);
}
