import { Router } from "express";
import { ethers } from "ethers";
import PredictionEvent from "../models/PredictionEvent.js";
import { assessUserEventForListing, generateDailyPredictions } from "../services/ai.service.js";
import { getContracts, getSigner } from "../services/blockchain.service.js";
import config from "../config/index.js";
import { buildEventTiming, getQaHistory, getSchedulerStatus, getVerifyBufferMs, initScheduler, runSchedulerKick } from "../jobs/prediction-scheduler.js";
import { isTranslationComplete, pretranslateEvents, translateEvents, translateMissingEvents } from "../services/translate.service.js";

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
  if (/\b(vs|versus|match|fixture|derby|league|cup|goal|score|scorer|assist|football|soccer|basketball|tennis|hockey|ufc|f1|motogp|grand prix|gp|verstappen|hamilton|nba|nfl|mlb|nhl|beat|defeat|defeats|defeated|lose to|lost to|serie a|la liga|bundesliga|ligue 1|premier league|champions league|arsenal|manchester|man utd|manchester united|liverpool|chelsea|tottenham|real madrid|barcelona|atletico|bayern|psg|juventus|inter|milan|burnley|bournemouth|aston villa|crystal palace|leeds|nottingham forest|west ham|newcastle|roma|as roma|napoli|lazio|fiorentina|atalanta|como|cagliari|genoa|lecce|udinese|verona|monza|parma|empoli|venezia|torino|bologna|dortmund|leverkusen|wolfsburg|frankfurt|marseille|lyon|lille|monaco|villarreal|sevilla|betis|sociedad|celtic|rangers|porto|benfica|ajax|brighton|wolves|brentford|fulham|everton|spurs)\b/.test(t)) return "SPORTS";
  if (/\b(election|president|parliament|sanction|summit|ceasefire|government|minister|vote)\b/.test(t)) return "POLITICS";
  if (/\b(cpi|inflation|gdp|fed|ecb|interest rate|jobs report|earnings|dow|nasdaq|s&p|gold|oil)\b/.test(t)) return "ECONOMY";
  if (/\b(bitcoin|btc|ethereum|eth|solana|xrp|crypto|token|etf|on-chain|wallet|binance|coinbase)\b/.test(t)) return "CRYPTO";
  if (/\b(storm|hurricane|earthquake|wildfire|flood|temperature|heatwave|weather|climate)\b/.test(t)) return "CLIMATE";
  return "CRYPTO";
}

function inferCategoryStrong(text) {
  const t = String(text || "").toLowerCase();
  // Require unambiguous sports keywords; "beat"/"match"/"score" alone are too generic
  // Premier League, Serie A, La Liga, Bundesliga, Ligue 1, and other major clubs
  if (/\b(defeat|defeats|defeated|lose to|lost to|vs|versus|fixture|derby|league|cup|goal|goalkeeper|serie a|la liga|bundesliga|ligue 1|premier league|champions league|europa league|conference league|copa del rey|fa cup|carabao|arsenal|manchester|man utd|liverpool|chelsea|tottenham|real madrid|barcelona|atletico|bayern|psg|juventus|inter|milan|burnley|bournemouth|aston villa|west ham|newcastle|everton|crystal palace|wolves|wolverhampton|brentford|fulham|brighton|nottingham forest|leicester|ipswich|southampton|leeds|roma|as roma|napoli|lazio|fiorentina|atalanta|como|cagliari|genoa|lecce|udinese|verona|monza|parma|empoli|venezia|torino|sassuolo|sampdoria|bologna|dortmund|leverkusen|wolfsburg|frankfurt|mainz|freiburg|stuttgart|hoffenheim|marseille|lyon|lille|monaco|nice|rennes|lens|villarreal|sevilla|betis|sociedad|bilbao|valencia|celta|celtic|rangers|porto|benfica|sporting|ajax|feyenoord|galatasaray|fenerbahce|besiktas|nba|nfl|mlb|nhl|ufc|mma|f1|formula 1)\b/.test(t)) return "SPORTS";
  if (/\b(beat|win)\b/.test(t) && /\b(arsenal|manchester|man utd|liverpool|chelsea|tottenham|real madrid|barcelona|atletico|bayern|psg|juventus|inter|milan|burnley|bournemouth|aston villa|west ham|newcastle|everton|spurs|roma|napoli|lazio|fiorentina|atalanta|como|cagliari|dortmund|leverkusen|marseille|lyon|villarreal|sevilla|porto|benfica|celtic|ajax|brighton|wolves|brentford|fulham|crystal palace)\b/.test(t)) return "SPORTS";
  if (/\b(tornado|hail|hurricane|earthquake|wildfire|flood|heatwave|temperature|weather|climate|rainfall|cyclone|storm|blizzard|typhoon|drought)\b/.test(t)) return "CLIMATE";
  if (/\b(election|parliament|congress|senate|president|ceasefire|sanction|summit|government|minister|white house|vote|troops|military|war powers|shutdown)\b/.test(t)) return "POLITICS";
  if (/\b(cpi|inflation|gdp|fed|ecb|interest rate|jobs report|payrolls|dow|nasdaq|s&p|gold|oil|brent|wti|bond|yield)\b/.test(t)) return "ECONOMY";
  if (/\b(bitcoin|btc|ethereum|eth|solana|xrp|crypto|token|etf|on-chain|wallet|binance|coinbase)\b/.test(t)) return "CRYPTO";
  return "";
}

function normalizeAutoCategory(category, title, description = "") {
  const model = String(category || "").toUpperCase();
  const fallback = CATEGORY_NAMES.includes(model) ? model : inferCategoryFromText(title);
  // Only match against title to avoid false positives from description keywords
  const strong = inferCategoryStrong(title);
  return strong || fallback;
}

function isAdminAuthorized(req) {
  const key = String(req.header("x-admin-key") || "").trim();
  if (!key) return false;
  // Use dedicated admin API key only — never fall back to deployer private key
  if (!config.adminApiKey) {
    console.warn("[Auth] ADMIN_API_KEY is not set — admin endpoints are disabled");
    return false;
  }
  return key === String(config.adminApiKey).trim();
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

function isNearDuplicateTitle(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  const sa = sportsFixtureSignature(a);
  const sb = sportsFixtureSignature(b);
  if (sa && sb && sa === sb) return true;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const aSet = new Set(na.split(/\s+/).filter(Boolean));
  const bSet = new Set(nb.split(/\s+/).filter(Boolean));
  if (!aSet.size || !bSet.size) return false;
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  const uni = aSet.size + bSet.size - inter;
  return uni > 0 ? inter / uni >= 0.72 : false;
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
  let m = s.match(/will\s+(.+?)\s+(?:beat|defeat|win(?:\s+against)?|lose to)\s+(.+?)(?:\s+in\s+their|\s+on\s+|\s+by\s+|\?|$)/i);
  if (!m) {
    // "win their X match against Y" pattern
    m = s.match(/will\s+(.+?)\s+win\s+their\s+\S+(?:\s+\S+)?\s+match\s+against\s+(.+?)(?:\s+on\s+|\s+by\s+|\?|$)/i);
  }
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
  const norm = normalizeTitle(title);
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

function isNearDuplicateEvent(a, b) {
  const ca = String(a?.category || "").toUpperCase();
  const cb = String(b?.category || "").toUpperCase();
  if (ca && cb && ca === cb) {
    const ta = marketTopicKey(a?.title, ca);
    const tb = marketTopicKey(b?.title, cb);
    if (ta && tb && ta === tb) return true;
    const sa = ca === "SPORTS" ? sportsFixtureSignature(a?.title) : genericCategorySignature(a?.title, ca);
    const sb = cb === "SPORTS" ? sportsFixtureSignature(b?.title) : genericCategorySignature(b?.title, cb);
    if (sa && sb && sa === sb) return true;
  }
  return isNearDuplicateTitle(a?.title, b?.title);
}

function buildFallbackDescription(evt) {
  const title = String(evt?.title || "").trim();
  const category = String(evt?.category || "CRYPTO").toUpperCase();
  const verifyAfter = evt?.verifyAfter ? new Date(evt.verifyAfter).toISOString() : "";
  const criterion = {
    SPORTS: "final match result only (not aggregate/tournament progression)",
    POLITICS: "official decision, vote, or statement outcome",
    ECONOMY: "official release value or market close figure",
    CRYPTO: "exchange/market close value or official listing/regulatory outcome",
    CLIMATE: "official agency report and measured event data",
  }[category] || "objective public outcome";
  return `Resolution criterion: ${criterion}. Market question: ${title}. Verification occurs at/after ${verifyAfter || "the scheduled verification window"} using objective public sources.`;
}

function ensureDetailedDescriptions(events) {
  return (events || []).map((evt) => {
    const current = String(evt?.description || "").trim();
    if (current.length >= 80) return evt;
    return { ...evt, description: buildFallbackDescription(evt) };
  });
}

function dedupeNearDuplicateEvents(events) {
  const out = [];
  for (const evt of events || []) {
    const exists = out.some((x) => isNearDuplicateEvent(x, evt));
    if (exists) continue;
    out.push(evt);
  }
  return out;
}

function recategorizeByTitle(events) {
  return (events || []).map((evt) => {
    if (evt?.isUserEvent) return evt;
    // Only match against title to avoid false positives from description keywords
    const strong = inferCategoryStrong(evt?.title || "");
    if (!strong) return evt;
    if (String(evt?.category || "").toUpperCase() === strong) return evt;
    return { ...evt, category: strong };
  });
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
    return !isTranslationComplete(evt, stored, lang);
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

// Active + pending resolution (unresolved events)
router.get("/", async (req, res) => {
  try {
    const now = new Date();
    // Include events pending resolution (past deadline but not yet resolved, up to 7 days old)
    const pendingCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    let events = await PredictionEvent.find({
      resolved: false,
      deadline: { $gt: pendingCutoff },
    }).sort({ deadline: 1 }).lean();
    // Mark active vs pending
    events = events.map((evt) => ({
      ...evt,
      _status: new Date(evt.deadline) > now ? "active" : "pending",
    }));
    events = await attachUserVotes(events, req.query.address);
    events = recategorizeByTitle(events);
    events = ensureDetailedDescriptions(events);
    events = dedupeNearDuplicateEvents(events);
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
    events = recategorizeByTitle(events);
    events = ensureDetailedDescriptions(events);
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
    events = recategorizeByTitle(events);
    events = ensureDetailedDescriptions(events);
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
        openrouterRetrieverModel: config.openrouterRetrieverModel || config.openrouterSearchModel,
        openrouterNormalizerModel: config.openrouterNormalizerModel || config.openrouterModel,
        openrouterArbiterModel: config.openrouterArbiterModel || config.openrouterFallback || config.openrouterModel,
        openrouterSearchModel: config.openrouterSearchModel,
        openrouterResolveModel: config.openrouterResolveModel,
      },
    },
  });
});

// QA watchdog history (latest runs)
router.get("/qa-report", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
    return res.json({
      success: true,
      data: {
        limit,
        rows: getQaHistory(limit),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
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

// Admin: comprehensive cleanup — fix categories, archive orphans, remove DB duplicates
router.post("/admin/cleanup", async (req, res) => {
  try {
    if (!isAdminAuthorized(req)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const report = { categoriesFixed: 0, orphansArchived: 0, duplicatesArchived: 0, details: [] };

    // 1. Fix categories in MongoDB
    const unresolved = await PredictionEvent.find({ resolved: false }).lean();
    for (const evt of unresolved) {
      if (evt.isUserEvent) continue;
      const strong = inferCategoryStrong(evt.title || "");
      if (strong && String(evt.category || "").toUpperCase() !== strong) {
        await PredictionEvent.updateOne({ _id: evt._id }, { $set: { category: strong } });
        report.categoriesFixed++;
        report.details.push(`eventId ${evt.eventId}: ${evt.category} → ${strong} ("${(evt.title || "").slice(0, 60)}")`);
      }
    }

    // 2. Archive orphaned events (eventId > chain count)
    const { Prediction } = getContracts();
    if (Prediction) {
      let chainCount;
      try { chainCount = Number(await Prediction.eventCount()); } catch { chainCount = 0; }
      if (chainCount > 0) {
        const orphans = await PredictionEvent.find({
          resolved: false,
          eventId: { $gt: chainCount },
        }).lean();
        for (const o of orphans) {
          await PredictionEvent.updateOne(
            { _id: o._id },
            { $set: { resolved: true, outcome: false, aiReasoning: "Archived: event not on chain (orphaned)." } }
          );
          report.orphansArchived++;
          report.details.push(`eventId ${o.eventId}: orphaned (chain count=${chainCount})`);
        }
      }
    }

    // 3. Remove duplicates from unresolved — keep earliest eventId
    const active = await PredictionEvent.find({ resolved: false }).sort({ eventId: 1 }).lean();
    const kept = [];
    for (const evt of active) {
      const isDupe = kept.some((k) => isNearDuplicateEvent(k, evt));
      if (isDupe) {
        await PredictionEvent.updateOne(
          { _id: evt._id },
          { $set: { resolved: true, outcome: false, aiReasoning: `Archived: duplicate of earlier event.` } }
        );
        report.duplicatesArchived++;
        report.details.push(`eventId ${evt.eventId}: duplicate ("${(evt.title || "").slice(0, 60)}")`);
      } else {
        kept.push(evt);
      }
    }

    return res.json({ success: true, data: report });
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
    const activeTitles = await PredictionEvent.find({ resolved: false, deadline: { $gt: new Date() } })
      .select("title category")
      .limit(1000)
      .lean();
    const existing = activeTitles.map((x) => ({
      title: String(x.title || ""),
      category: String(x.category || "CRYPTO").toUpperCase(),
    }));
    const seen = [];
    const filteredPredictions = predictions.filter((pred) => {
      const t = String(pred?.title || "");
      const d = String(pred?.description || "").trim();
      if (!t || d.length < 80) return false;
      if (seen.some((x) => isNearDuplicateEvent(x, pred))) return false;
      if (existing.some((x) => isNearDuplicateEvent(x, pred))) return false;
      seen.push({ title: t, category: String(pred?.category || "CRYPTO").toUpperCase() });
      return true;
    });
    const localized = await pretranslateEvents(filteredPredictions);
    const { Prediction } = getContracts();
    const signer = getSigner();
    const created = [];

    if (Prediction && signer) {
      let nonce = await signer.getNonce();
      for (let i = 0; i < filteredPredictions.length; i++) {
        const pred = filteredPredictions[i];
        const normalizedCategory = normalizeAutoCategory(pred.category, pred.title, pred.description || "");
        const timing = buildEventTiming({
          category: normalizedCategory,
          hoursToResolve: pred.hoursToResolve || 8,
          verifyAtUtc: pred.verifyAtUtc,
          eventStartAtUtc: pred.eventStartAtUtc,
          isUserEvent: false,
          title: pred.title,
        });
        if (!timing.isValidWindow) {
          console.warn(`[Predictions] Skipping generated event with unsafe/closed vote window: "${pred.title}"`);
          continue;
        }
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
