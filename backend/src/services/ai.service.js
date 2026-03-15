import OpenAI from "openai";
import config from "../config/index.js";
import { trackAICall } from "./ai-metrics.service.js";

const CATEGORIES = ["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"];
const RESOLVE_RETRIES = 3;
const CATEGORY_REPROMPT_MIN_INTERVAL_MS = Math.max(
  60 * 1000,
  Number(process.env.AI_CATEGORY_REPROMPT_MIN_INTERVAL_MS || 15 * 60 * 1000)
);
const MAX_CATEGORY_REPROMPTS_PER_CYCLE = Math.max(
  0,
  Number(process.env.AI_MAX_CATEGORY_REPROMPTS_PER_CYCLE || 2)
);
const categoryRepromptLastAt = new Map();
const STAGE_NAMES = ["vet", "arbiter"];
const STAGE_NO_GAIN_STREAK_LIMIT = Math.max(
  1,
  Number(process.env.AI_STAGE_NO_GAIN_STREAK_LIMIT || 2)
);
const STAGE_COOLDOWN_CYCLES = Math.max(
  1,
  Number(process.env.AI_STAGE_COOLDOWN_CYCLES || 1)
);
const stageNoGainStreak = new Map();
const stageCooldownCyclesLeft = new Map();

let client = null;
let aiPauseUntil = 0;
const AI_PAUSE_MS_ON_CREDIT_ERROR = 10 * 60 * 1000;

/** Extract first valid JSON object from AI response text (handles markdown, explanatory text, truncated responses). */
function extractJSON(text) {
  if (!text || typeof text !== "string") return null;
  // 1. Try direct parse first
  try { return JSON.parse(text); } catch {}
  // 2. Try to find JSON object in the text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}
    // 3. If JSON is truncated (unterminated string), try to fix it
    let candidate = jsonMatch[0];
    // Close unterminated strings and object
    if (!candidate.endsWith("}")) {
      // Try adding closing quote + }
      candidate = candidate.replace(/,?\s*$/, '') + '"}';
      try { return JSON.parse(candidate); } catch {}
    }
  }
  // 4. Try regex extraction for our specific verdict schema
  const verdictMatch = text.match(/["']?verdict["']?\s*:\s*["'](YES|NO)["']/i);
  const reasonMatch = text.match(/["']?reasoning["']?\s*:\s*["']([^"']*?)["']/i);
  if (verdictMatch) {
    return { verdict: verdictMatch[1].toUpperCase(), reasoning: reasonMatch?.[1] || "Extracted from malformed response" };
  }
  return null;
}

/** OpenRouter Structured Outputs schema: array of up to 5 prediction events (root object with "predictions" key). */
const PREDICTIONS_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "event_predictions",
    strict: true,
    schema: {
      type: "object",
      properties: {
        predictions: {
          type: "array",
          description: "Exactly 5 prediction market events",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Yes/no question, max 90 chars" },
              description: { type: "string", description: "120-220 chars, detailed" },
              category: { type: "string", description: "Category e.g. SPORTS, ECONOMY" },
              aiProbability: { type: "number", description: "15-85" },
              hoursToResolve: { type: "number", description: "6-720" },
              eventStartAtUtc: { type: ["string", "null"], description: "ISO UTC or null" },
              verifyAtUtc: { type: "string", description: "ISO UTC verification time" },
              sources: { type: "array", items: { type: "string" }, description: "URLs" },
              confidence: { type: "number", description: "0-1" },
              popularityScore: { type: "number", description: "0-100" },
            },
            required: [
              "title", "description", "category", "aiProbability", "hoursToResolve",
              "eventStartAtUtc", "verifyAtUtc", "sources", "confidence", "popularityScore",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["predictions"],
      additionalProperties: false,
    },
  },
};

function isInsufficientCreditsError(err) {
  const msg = String(err?.message || err || "");
  return msg.includes("402") || /insufficient credits/i.test(msg);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferOutcomeFromReasoning(title, reasoning) {
  const t = String(title || "").toLowerCase();
  const r = String(reasoning || "").toLowerCase();
  if (!r) return null;

  const has = (re) => re.test(r);

  // Team-vs-team win/beat style questions.
  const m = t.match(/will\s+(.+?)\s+(beat|win against|defeat)\s+(.+?)\s+(tonight|today|\?)/);
  if (m) {
    const teamA = m[1].trim();
    const teamB = m[3].trim();
    // In cup two-leg contexts, "lost on aggregate" does not imply losing this specific match.
    if (has(/\bon aggregate\b/) && (has(/\bwon\b/) || has(/\bbeat\b/) || has(/\bdefeated\b/))) {
      if (teamA && has(new RegExp(`\\b${teamA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`))) return true;
    }
    if (has(/\b(draw|drew|0-0|1-1|2-2)\b/)) return false;
    if (teamB && has(new RegExp(`\\b${teamB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b\\s+won`))) return false;
    if (teamA && has(new RegExp(`\\b${teamA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b\\s+won`))) return true;
    if (has(/\b(did not beat|failed to beat|lost)\b/)) return false;
    if (has(/\b(beat|defeated)\b/)) return true;
  }

  // Threshold style questions.
  if (/(above|exceed|reach|>=|more than|at least)/.test(t)) {
    if (has(/\b(less than|below|under|not more than|did not|didn't|not reach|failed to)\b/)) return false;
    if (has(/\b(did not|didn't|below|under|failed to|no evidence|not reach|did not exceed)\b/)) return false;
    if (has(/\b(exceeded|above|reached|surged above|closed above)\b/)) return true;
  }

  // "Any new ..." style.
  if (/\b(any new|new wildfire|new wildfires)\b/.test(t)) {
    if (has(/\b(no new|none reported|not reported)\b/)) return false;
    if (has(/\b(new .* reported|were reported|has been reported)\b/)) return true;
  }

  // Goals count style.
  if (/(>=3 goals|3\+ goals|three goals)/.test(t)) {
    if (has(/\b(0-0|1-0|1-1|2-0|2-1|2 goals|0 goals|1 goal)\b/)) return false;
    if (has(/\b(3-0|3-1|3-2|4-1|4-2|5 goals|4 goals|3 goals)\b/)) return true;
  }

  return null;
}

function getClient() {
  if (!client && config.openrouterKey) {
    client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: config.openrouterKey,
      defaultHeaders: { "HTTP-Referer": "https://oracleai.predict", "X-Title": "OracleAI Predict" },
    });
  }
  return client;
}

async function ask(model, messages, temp = 0.5, tokens = 2048, operation = "generate", options = {}) {
  if (Date.now() < aiPauseUntil) {
    trackAICall({ operation, model, status: "skipped", latencyMs: 0, error: "paused-after-credit-error" });
    return null;
  }
  const c = getClient();
  if (!c) {
    trackAICall({ operation, model, status: "skipped", latencyMs: 0, error: "client-not-configured" });
    return null;
  }
  const started = Date.now();
  const body = { model, messages, temperature: temp, max_tokens: tokens };
  if (options?.response_format) body.response_format = options.response_format;
  try {
    const r = await c.chat.completions.create(body);
    const content = r?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Empty model response");
    }
    trackAICall({ operation, model, status: "success", latencyMs: Date.now() - started });
    return content.trim().replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  } catch (err) {
    trackAICall({ operation, model, status: "error", latencyMs: Date.now() - started, error: err?.message || err });
    if (isInsufficientCreditsError(err)) {
      aiPauseUntil = Date.now() + AI_PAUSE_MS_ON_CREDIT_ERROR;
      console.warn("[AI] OpenRouter credits exhausted, pausing AI calls for 10 minutes");
    }
    throw err;
  }
}

async function askWithFallbackModels(models, messages, temp, tokens, operation, options = {}) {
  const tried = new Set();
  let lastErr = null;
  for (const model of (models || []).map((m) => String(m || "").trim()).filter(Boolean)) {
    if (tried.has(model)) continue;
    tried.add(model);
    try {
      const out = await ask(model, messages, temp, tokens, operation, options);
      if (out) return out;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

function modelList(...items) {
  const out = [];
  const seen = new Set();
  for (const m of items) {
    const s = String(m || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function parseJsonArrayLenient(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const text = raw.trim();
  try {
    const direct = JSON.parse(text);
    return Array.isArray(direct) ? direct : null;
  } catch {}
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) {
    const slice = text.slice(start, end + 1);
    try {
      const parsed = JSON.parse(slice);
      return Array.isArray(parsed) ? parsed : null;
    } catch {}
  }
  return null;
}

function canRunCategoryReprompt(category, nowTs) {
  const key = String(category || "").toUpperCase();
  const lastTs = Number(categoryRepromptLastAt.get(key) || 0);
  if (!lastTs) return true;
  return nowTs - lastTs >= CATEGORY_REPROMPT_MIN_INTERVAL_MS;
}

function stageKey(stage, category) {
  return `${String(stage || "").toLowerCase()}:${String(category || "").toUpperCase()}`;
}

function eventFingerprint(e) {
  return [
    String(e?.title || "").trim().toLowerCase(),
    String(e?.verifyAtUtc || "").trim(),
    String(e?.eventStartAtUtc || "").trim(),
    String(e?.category || "").trim().toUpperCase(),
  ].join("|");
}

function sameEventSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const aa = a.map(eventFingerprint).sort();
  const bb = b.map(eventFingerprint).sort();
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

function shouldRunStage(stage, category) {
  const key = stageKey(stage, category);
  return Number(stageCooldownCyclesLeft.get(key) || 0) <= 0;
}

function markStageResult(stage, category, { noGain }) {
  const key = stageKey(stage, category);
  if (!noGain) {
    stageNoGainStreak.set(key, 0);
    return;
  }
  const next = Number(stageNoGainStreak.get(key) || 0) + 1;
  if (next >= STAGE_NO_GAIN_STREAK_LIMIT) {
    stageNoGainStreak.set(key, 0);
    stageCooldownCyclesLeft.set(key, STAGE_COOLDOWN_CYCLES);
    console.log(
      `[AI] ${String(category).toUpperCase()} ${stage} cooldown armed for ${STAGE_COOLDOWN_CYCLES} cycle(s) after ${next} no-gain runs`
    );
    return;
  }
  stageNoGainStreak.set(key, next);
}

function decayStageCooldowns(categories = []) {
  const cats = categories.map((x) => String(x || "").toUpperCase());
  for (const stage of STAGE_NAMES) {
    for (const cat of cats) {
      const key = stageKey(stage, cat);
      const left = Number(stageCooldownCyclesLeft.get(key) || 0);
      if (left > 0) {
        const next = left - 1;
        if (next <= 0) stageCooldownCyclesLeft.delete(key);
        else stageCooldownCyclesLeft.set(key, next);
      }
    }
  }
}

async function search(query) {
  const retrieverModels = modelList(
    config.openrouterRetrieverModel,
    config.openrouterSearchModel,
    config.openrouterFallback
  );
  return askWithFallbackModels(retrieverModels, [
    { role: "system", content: "You have live web search. Return only verified, factual, current information. Be specific: names, numbers, times, scores. Focus on mainstream/high-interest topics with reliable sources. Include both currently running events and upcoming events in the next 30 days, prioritizing the next 1-7 days." },
    { role: "user", content: query },
  ], 0.1, 2000, "search");
}

async function generate(sysPrompt, userPrompt) {
  // Prefer dedicated formatter when set (strict formatting by rules); else normalizer/general.
  const normalizerModels = modelList(
    config.openrouterFormatterModel,
    config.openrouterNormalizerModel,
    config.openrouterModel,
    config.openrouterFallback
  );
  try {
    const out = await askWithFallbackModels(
      normalizerModels,
      [
        { role: "system", content: sysPrompt },
        { role: "user", content: userPrompt },
      ],
      0.35,
      2500,
      "generate",
      { response_format: PREDICTIONS_RESPONSE_FORMAT }
    );
    if (!out) return null;
    // Structured output returns { predictions: [...] }; unwrap so caller still gets array string.
    try {
      const parsed = JSON.parse(out);
      if (parsed && Array.isArray(parsed.predictions)) {
        return JSON.stringify(parsed.predictions);
      }
    } catch (_) {}
    return out;
  } catch (e) {
    if (isInsufficientCreditsError(e)) return null;
    console.error(`[AI] Generate failed: ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════

function getTodayStr() {
  return new Date().toISOString().split("T")[0];
}

function getTimeInfo() {
  const now = new Date();
  const h = now.getUTCHours();
  const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getUTCDay()];
  return { today: getTodayStr(), hour: h, day };
}

const SEARCH_QUERIES = {
  SPORTS: `What MAJOR sports matches and games are happening now and in the next 30 days?
Check: Premier League, La Liga, Serie A, Champions League, NBA, NHL, UFC/MMA, F1, ATP/WTA.
Prioritize globally popular fixtures in the next 1-7 days, but include important events later in the month when relevant.
List kickoff/tip-off/start times in UTC.`,

  POLITICS: `What are the TOP political stories and scheduled decisions happening now and in the next 30 days?
Focus on: US politics, Russia-Ukraine, Israel-Iran, China, EU decisions, elections, sanctions, major summits.
Prioritize high-impact events in the next 1-7 days, then major events later this month.`,

  ECONOMY: `What is happening in financial markets now and in the next 30 days?
Provide current exact prices: S&P 500, Nasdaq, Dow Jones, Gold, Oil.
Include major upcoming events: central bank meetings, CPI/jobs data, top earnings.
Prioritize items in the next 1-7 days and include exact times/dates in UTC.`,

  CRYPTO: `What is happening in crypto now and over the next 30 days?
Bitcoin exact price right now? Ethereum exact price? 24h change?
What coins are pumping or dumping now? Any hacks/exploits?
Any regulatory events, ETF decisions, token unlocks, major listings/delistings in the next 1-7 days (and key ones later this month)?`,

  CLIMATE: `What weather and climate events are active now and likely to be highly relevant in the next 30 days?
Include active severe warnings, storms, earthquakes, heatwaves, floods, wildfire situations.
Prioritize events with strong public attention in the next 1-7 days, and include major scheduled weather risks later in the month.`,
};

const POPULARITY_PATTERNS = {
  SPORTS: /\b(arsenal|manchester|liverpool|chelsea|tottenham|real madrid|barcelona|atletico|bayern|psg|juventus|inter|milan|champions league|premier league|la liga|serie a|bundesliga|nba|nfl|mlb|nhl|ufc|f1|atp|wta|grand slam|world cup)\b/i,
  POLITICS: /\b(us|white house|congress|senate|eu|european union|ukraine|russia|china|israel|iran|un|nato|election|parliament|sanctions|summit|sec|fed|ecb|imf|g7|g20)\b/i,
  ECONOMY: /\b(s&p|nasdaq|dow|gold|oil|brent|fed|ecb|cpi|inflation|jobs|nonfarm|payrolls|earnings|treasury|bond|yield|rate cut|rate hike|recession)\b/i,
  CRYPTO: /\b(bitcoin|btc|ethereum|eth|solana|xrp|bnb|doge|ton|sec|etf|coinbase|binance|blackrock|grayscale|ark|token unlock|airdrop|listing)\b/i,
  CLIMATE: /\b(hurricane|storm|tornado|earthquake|wildfire|flood|heatwave|weather warning|red warning|landfall|severe weather|cyclone|air quality)\b/i,
};

const CATEGORY_VERIFY_BUFFER_MINUTES = {
  SPORTS: 20,
  POLITICS: 60,
  ECONOMY: 60,
  CRYPTO: 60,
  CLIMATE: 60,
};

const CATEGORY_VOTE_LEAD_MINUTES = {
  SPORTS: 1,
  POLITICS: 30,
  ECONOMY: 60,
  CRYPTO: 60,
  CLIMATE: 30,
};

function useEventStartAnchor(category) {
  return String(category || "").toUpperCase() === "SPORTS";
}

function parseIsoUtc(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return null;
  return ts;
}

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

function removeNonUtcTimezoneTokens(text) {
  return String(text || "")
    .replace(/\b(ET|EST|EDT|PT|PST|PDT|CET|CEST|BST|IST)\b/gi, "UTC")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function titleTokens(title) {
  const norm = normalizeTitleForSimilarity(title);
  return new Set(norm ? norm.split(/\s+/).filter(Boolean) : []);
}

function jaccard(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  const uni = aSet.size + bSet.size - inter;
  return uni > 0 ? inter / uni : 0;
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
  return jaccard(titleTokens(na), titleTokens(nb)) >= 0.78;
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
    // Strong anti-repeat for same asset/metric in same window regardless of small threshold changes.
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

function buildDetailedDescription(event) {
  const title = String(event?.title || "").trim();
  const category = String(event?.category || "CRYPTO").toUpperCase();
  const verifyAt = String(event?.verifyAtUtc || "").trim();
  const sourceHint = Array.isArray(event?.sources) && event.sources.length > 0 ? "trusted public sources" : "official and mainstream public sources";
  const catHint = {
    SPORTS: "match result only (not aggregate progression)",
    POLITICS: "official announcement or vote outcome",
    ECONOMY: "official release or market close value",
    CRYPTO: "exchange/market close value or official listing/regulatory outcome",
    CLIMATE: "official agency report and measured event data",
  }[category] || "official measurable outcome";
  return `Resolution criterion: ${catHint}. This market asks: ${title}. Verification will use ${sourceHint} at/after ${verifyAt || "the scheduled verify window"}, and the final verdict is based on objective published data only.`;
}

function inferCategoryFromText(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(vs|versus|match|fixture|derby|league|cup|goal|score|scorer|assist|player|team|coach|lineup|penalty|football|soccer|basketball|tennis|hockey|baseball|cricket|mma|ufc|f1|formula 1|motogp|nba|nfl|mlb|nhl|grand prix|gp|verstappen|hamilton|uefa|fifa|premier league|la liga|laliga|serie a|bundesliga|champions league|europa league|beat|defeat|defeats|defeated|lose to|lost to|arsenal|manchester|man utd|manchester united|liverpool|chelsea|tottenham|real madrid|barcelona|atletico|bayern|psg|juventus|inter|milan|dortmund|burnley|bournemouth|aston villa|crystal palace|leeds|nottingham forest|west ham|newcastle)\b/.test(t)) {
    return "SPORTS";
  }
  if (/\b(election|president|parliament|sanction|summit|ceasefire|government|minister|vote|white house|congress|senate|diplomacy|unsc|united nations)\b/.test(t)) {
    return "POLITICS";
  }
  if (/\b(cpi|inflation|gdp|fed|ecb|interest rate|jobs report|earnings|dow|nasdaq|s&p|gold|oil|brent|nfp|payrolls|bond|yield)\b/.test(t)) {
    return "ECONOMY";
  }
  if (/\b(bitcoin|btc|ethereum|eth|solana|xrp|crypto|token|etf|on-chain|wallet|binance|coinbase|defi|staking|airdrop|halving)\b/.test(t)) {
    return "CRYPTO";
  }
  if (/\b(storm|hurricane|earthquake|wildfire|flood|temperature|heatwave|weather|climate|rainfall|tornado|cyclone)\b/.test(t)) {
    return "CLIMATE";
  }
  return "UNKNOWN";
}

function isPopularEvent(category, title, description = "") {
  const text = `${String(title || "")} ${String(description || "")}`;
  const re = POPULARITY_PATTERNS[category];
  if (!re) return true;
  return re.test(text);
}

async function vetPredictionsWithWeb(category, events, nowInfo) {
  if (!Array.isArray(events) || !events.length) return [];
  const payload = events.map((e, idx) => ({
    idx,
    title: e.title,
    description: e.description || "",
    hoursToResolve: e.hoursToResolve,
    eventStartAtUtc: e.eventStartAtUtc || null,
    verifyAtUtc: e.verifyAtUtc || null,
    category,
  }));
  const sys = `You are a strict prediction-market QA checker with live web search.
Validate each candidate for:
1) mainstream relevance (massively discussed topic),
2) temporal correctness (event still pending, not already decided),
3) resolvability timing consistency.
Return ONLY JSON array:
[{"idx":number,"accepted":true|false,"reason":"short","adjustedHoursToResolve":number|null,"adjustedEventStartAtUtc":"ISO-8601 UTC or null","adjustedVerifyAtUtc":"ISO-8601 UTC or null","adjustedPopularityScore":0..100|null}]
Rules:
- Reject stale/incongruent events ("today/tonight" already passed).
- Reject unrealistic or trivial market thresholds.
- Reject mismatched timing where verification would happen before event window ends.
- Keep only high-signal mainstream events.`;
  const user = `Now UTC: ${nowInfo.day}, ${nowInfo.today}, ${nowInfo.hour}:00 UTC
Candidates:
${JSON.stringify(payload)}`;
  try {
    const raw = await search(`${sys}\n\n${user}`);
    if (!raw) return [];
    const parsed = parseJsonArrayLenient(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return events;
    const byIdx = new Map(
      parsed
        .filter((x) => Number.isFinite(Number(x?.idx)))
        .map((x) => [Number(x.idx), x])
    );
    const out = [];
    for (let i = 0; i < events.length; i++) {
      const verdict = byIdx.get(i);
      if (!verdict || !verdict.accepted) continue;
      const adjusted = Number(verdict.adjustedHoursToResolve);
      const adjustedStartIso = typeof verdict.adjustedEventStartAtUtc === "string" ? verdict.adjustedEventStartAtUtc : null;
      const adjustedIso = typeof verdict.adjustedVerifyAtUtc === "string" ? verdict.adjustedVerifyAtUtc : null;
      const adjustedPopularity = Number(verdict.adjustedPopularityScore);
      out.push({
        ...events[i],
        eventStartAtUtc: adjustedStartIso || events[i].eventStartAtUtc || "",
        verifyAtUtc: adjustedIso || events[i].verifyAtUtc || null,
        hoursToResolve: Number.isFinite(adjusted)
          ? Math.max(6, Math.min(720, adjusted))
          : events[i].hoursToResolve,
        popularityScore: Number.isFinite(adjustedPopularity)
          ? Math.max(0, Math.min(100, adjustedPopularity))
          : events[i].popularityScore,
      });
    }
    const targetMin = Math.min(3, events.length);
    if (out.length >= targetMin) return out;
    // If web QA is too strict/noisy, keep best untouched candidates to avoid empty expensive loops.
    const used = new Set(out.map((x) => String(x.title || "").trim().toLowerCase()));
    for (const candidate of events) {
      if (out.length >= targetMin) break;
      const key = String(candidate?.title || "").trim().toLowerCase();
      if (!key || used.has(key)) continue;
      used.add(key);
      out.push(candidate);
    }
    return out;
  } catch {
    return events;
  }
}

async function finalizePredictionsWithArbiter(category, events, nowInfo) {
  if (!Array.isArray(events) || !events.length) return [];
  const arbiterModels = modelList(
    config.openrouterArbiterModel,
    config.openrouterFallback,
    config.openrouterModel
  );
  const payload = events.map((e, idx) => ({
    idx,
    title: e.title,
    description: e.description || "",
    category,
    eventStartAtUtc: e.eventStartAtUtc || null,
    verifyAtUtc: e.verifyAtUtc || null,
    hoursToResolve: Number(e.hoursToResolve || 0),
    sources: Array.isArray(e.sources) ? e.sources : [],
    popularityScore: Number(e.popularityScore ?? 0),
    confidence: Number(e.confidence ?? 0),
  }));
  const messages = [
    {
      role: "system",
      content: `You are a strict final arbiter for prediction market listings with live web search.
Return ONLY JSON array:
[{"idx":number,"accepted":true|false,"reason":"short","verifyAtUtc":"ISO UTC|null","eventStartAtUtc":"ISO UTC|null","sources":["https://..."],"description":"120-220 chars"}]
Hard rules:
- Keep only events that are real, mainstream, and currently/upcoming (next 30 days).
- Require at least 2 credible source URLs per accepted event.
- verifyAtUtc must be after current time and after event start (if provided).
- Reject if timing is ambiguous or likely already known.
- Never invent fake URLs.
- REJECT events with hallucinated prices/thresholds. If a title says "Gold above $5,200" but Gold is actually ~$2,900, REJECT it. Verify all numeric thresholds against current real data.
- REJECT niche/local events that would not attract global attention (local elections <1M voters, routine weather, obscure sports).
- Description must be concrete and useful (what exactly is checked, in what time window, by which source type).
- Only accept events that would genuinely engage prediction market users (crypto traders, sports bettors, news followers).`,
    },
    {
      role: "user",
      content: `Now UTC: ${nowInfo.day}, ${nowInfo.today}, ${nowInfo.hour}:00 UTC\nCandidates:\n${JSON.stringify(payload)}`,
    },
  ];
  try {
    const raw = await askWithFallbackModels(arbiterModels, messages, 0.1, 1800, "arbiter");
    if (!raw) return events;
    const parsed = parseJsonArrayLenient(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return events;
    const byIdx = new Map(
      parsed.filter((x) => Number.isFinite(Number(x?.idx))).map((x) => [Number(x.idx), x])
    );
    const out = [];
    for (let i = 0; i < events.length; i++) {
      const verdict = byIdx.get(i);
      if (!verdict || !verdict.accepted) continue;
      const src = Array.isArray(verdict.sources) ? verdict.sources : events[i].sources;
      const sources = Array.from(new Set(src.map((x) => String(x || "").trim()).filter((x) => /^https?:\/\//i.test(x))));
      out.push({
        ...events[i],
        verifyAtUtc: typeof verdict.verifyAtUtc === "string" ? verdict.verifyAtUtc : events[i].verifyAtUtc,
        eventStartAtUtc: typeof verdict.eventStartAtUtc === "string" ? verdict.eventStartAtUtc : events[i].eventStartAtUtc,
        description: typeof verdict.description === "string" ? verdict.description : events[i].description,
        sources,
      });
    }
    const targetMin = Math.min(3, events.length);
    if (out.length >= targetMin) return out;
    // Avoid over-pruning by arbiter: preserve top candidates for downstream deterministic checks.
    const used = new Set(out.map((x) => String(x.title || "").trim().toLowerCase()));
    const sorted = [...events].sort(
      (a, b) => Number(b?.popularityScore ?? 0) - Number(a?.popularityScore ?? 0)
    );
    for (const candidate of sorted) {
      if (out.length >= targetMin) break;
      const key = String(candidate?.title || "").trim().toLowerCase();
      if (!key || used.has(key)) continue;
      used.add(key);
      out.push(candidate);
    }
    return out;
  } catch {
    return events;
  }
}

async function searchPopularEvents(category) {
  const { today, hour, day } = getTimeInfo();
  try {
    const r = await search(`Today is ${day}, ${today}, current time is ${hour}:00 UTC. ${SEARCH_QUERIES[category]}`);
    return r || "";
  } catch (e) {
    console.error(`[AI] Search ${category}: ${e.message}`);
    return "";
  }
}

// ═══════════════════════════════════════════════════════════════════════════

async function generateCategoryPredictions(category, context, options = {}) {
  const { today, hour, day } = getTimeInfo();
  const avoidTitles = Array.isArray(options?.avoidTitles) ? options.avoidTitles : [];
  const strictReprompt = Boolean(options?.strictReprompt);
  const repromptReason = String(options?.repromptReason || "").trim();
  const avoidBlock = avoidTitles.length
    ? `\nDO NOT repeat, paraphrase, or closely mirror these already active markets.
For SPORTS: never propose the same fixture (same teams and date) with different wording.
For ECONOMY/CRYPTO: never propose the same metric + threshold + date window with different wording.
For POLITICS/CLIMATE: never propose the same decision/event window with rephrased text.\n${avoidTitles
        .slice(0, 80)
        .map((t, i) => `${i + 1}. ${String(t).slice(0, 120)}`)
        .join("\n")}`
    : "";

  const strictBlock = strictReprompt
    ? `
STRICT RECOVERY MODE (LOW-YIELD CATEGORY):
- This is a retry because previous pass produced too few valid events.
- Prioritize exact compliance over creativity.
- Do not output borderline items that can drift category.
- Include mainstream source-backed events only.
- Prefer events with explicit UTC timing and clearly measurable outcomes.
- Make description concrete and specific to the exact metric/result.
${repromptReason ? `- Previous pass issue focus: ${repromptReason}` : ""}`
    : "";

  const r = await generate(
    `You create prediction market events. You are strict about timing, verifiability, and factual accuracy.

ABSOLUTE RULES:
- Today is ${day}, ${today}, ${hour}:00 UTC
- Create predictions for events from now up to the next 30 days.
- Prefer the next 1-7 days for most events.
- At least 3 of 5 predictions should resolve in 1-7 days.

FACTUAL ACCURACY (CRITICAL):
- Use ONLY prices, scores, and facts from the VERIFIED NEWS provided below.
- NEVER invent or guess prices/thresholds. If the news says "Bitcoin is at $83,000", use a threshold near $83,000 — NOT $70,000 or $100,000.
- For ECONOMY/CRYPTO: the threshold in the title MUST be within 5-15% of the CURRENT price from the news. Example: if Gold is $2,920, use "$2,900" or "$3,000" — NEVER "$5,200".
- If no current price is available in the news for an asset, do NOT create a prediction about it.

POPULARITY (CRITICAL):
- ONLY create events that would attract mass interest on a prediction market.
- Think: "Would 1000+ crypto/betting users want to vote on this?"
- GOOD: Champions League matches, Bitcoin price, Fed rate decisions, major elections, celebrity events
- BAD: niche weather events, local elections with <1M voters, obscure sports leagues, routine data releases
- For CLIMATE: only major disasters making global headlines (Cat 3+ hurricanes, M7+ earthquakes, record heatwaves). NO routine weather.
- popularityScore must honestly reflect global interest (80+ = mainstream, 60-80 = notable, <60 = niche — reject niche)

TIMING:
- The outcome MUST be verifiable by trusted sources at or shortly after deadline.
- Frame as a clear YES/NO question with specific names and numbers
- hoursToResolve = hours from NOW until result is known (6-720 max)
- Most hoursToResolve should be 24-168 (1-7 days)
- If hoursToResolve > 24, include explicit UTC date context in title (e.g., "on March 9", "by Mar 10 18:00 UTC")
- Do NOT use "today/tonight/now" unless hoursToResolve <= 6
- Always provide verifyAtUtc in strict ISO UTC format, e.g. "2026-03-22T21:30:00Z"
- For SPORTS: use exact kickoff in UTC and set verifyAtUtc to expected final-result availability (prefer kickoff + 3h to 4h for delays/overtime)
- For SPORTS diversity: include at least 2 events from non-football sports (NBA/NHL/tennis/MMA/F1/etc.) when such mainstream fixtures exist in the next 7 days.
- Never use non-UTC timezone abbreviations (ET/PT/CET etc.) in title; convert to UTC.
- hoursToResolve must reflect real result availability (match end, market close, official statement window)
- Timing guardrails by category:
  - SPORTS: vote closes 1 minute before kickoff; verify usually kickoff + 3-4h.
  - ECONOMY: vote closes ~60 minutes before release/close; verify +20 minutes.
  - CRYPTO: vote closes ~60 minutes before target candle/event; verify +20 minutes.
  - POLITICS: vote closes ~30 minutes before official cutoff; verify +60 to +120 minutes.
  - CLIMATE: vote closes ~30 minutes before window end; verify +60 to +120 minutes.
- Category lock is strict: every object.category MUST be exactly "${category}"
- For SPORTS: eventStartAtUtc is mandatory and must be exact kickoff UTC
- For non-SPORTS: eventStartAtUtc must be null or omitted unless truly needed
- If exact timing is uncertain, do NOT include that event
${strictBlock}

REJECT these types of predictions:
- Events with deadlines beyond 30 days
- Vague timing ("sometime soon") or unverifiable outcomes
- Events that already happened
- Events that are not sufficiently popular/visible
- Niche/local events that would not interest a global audience
- Price predictions with hallucinated thresholds not grounded in current data`,

    `Today: ${day}, ${today}, ${hour}:00 UTC. Category: ${category}

VERIFIED NEWS AND CURRENT DATA (use these facts, do NOT invent prices):
${context || "No specific news available. Skip price-based predictions if no current prices are provided."}

Create exactly 5 predictions about events in the next 30 days.
Each: {"title":"yes/no question max 90 chars","description":"120-220 chars, detailed and user-friendly","category":"${category}","aiProbability":15-85,"hoursToResolve":6-720,"eventStartAtUtc":"ISO UTC or null","verifyAtUtc":"ISO UTC","sources":["https://..."],"confidence":0..1,"popularityScore":0..100}
Required horizon mix per 5 events:
- at least 1 event resolving within 6-24h
- at least 3 events resolving within 24-168h (1-7 days)
- at least 1 event resolving within 168-720h (8-30 days)

PRICE/THRESHOLD RULES (CRITICAL):
- Any number in your title (price, index level, percentage) MUST come from the VERIFIED NEWS above.
- If the news says "S&P 500 is at 5,521", your threshold should be near 5,521 (e.g., 5,500 or 5,550), NOT 6,000.
- Round thresholds to clean numbers: $83,000 not $83,247; $2,900 not $2,917.
- If you cannot find a current price in the news, do NOT create that price prediction.

For SPORTS wording precision:
- If it is a two-leg/tournament tie, title MUST be about this specific match result only.
- Good: "Will Barcelona win this match vs Atletico tonight?"
- Bad: "Will Barcelona advance vs Atletico tonight?"

ENGAGEMENT RULES:
- Write titles that make users want to vote immediately.
- Use exciting, specific language. "Will Arsenal beat Everton?" > "Will a team win?"
- Descriptions must include: exact metric/outcome, verification window, and source type.
- Each event should feel like something people discuss on Twitter/Reddit.

Before returning, self-check each candidate:
1) in next 30 days,
2) verifiable by >=2 credible URLs,
3) no category drift,
4) no "today/tonight" with horizon > 6h,
5) verifyAtUtc after now and after eventStartAtUtc (if present),
6) ALL prices/thresholds match the verified news data above.${avoidBlock}`
  );

  if (!r) return [];
  try {
    const events = parseJsonArrayLenient(r);
    if (!Array.isArray(events)) return [];

    // Filter out events with obviously stale timing semantics.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = new Date();
    const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const monthMap = {
      january: 0, jan: 0,
      february: 1, feb: 1,
      march: 2, mar: 2,
      april: 3, apr: 3,
      may: 4,
      june: 5, jun: 5,
      july: 6, jul: 6,
      august: 7, aug: 7,
      september: 8, sep: 8,
      october: 9, oct: 9,
      november: 10, nov: 10,
      december: 11, dec: 11,
    };
    const buildUtcDate = (year, monthIdx, day) => {
      const ts = Date.UTC(year, monthIdx, day);
      const d = new Date(ts);
      if (d.getUTCFullYear() !== year || d.getUTCMonth() !== monthIdx || d.getUTCDate() !== day) return null;
      return ts;
    };
    const normalizeYear = (y) => (y < 100 ? 2000 + y : y);
    const parseVerifyAtUtc = (value) => {
      const s = String(value || "").trim();
      if (!s) return null;
      const ts = Date.parse(s);
      if (!Number.isFinite(ts)) return null;
      return ts;
    };
    const parseDateFromTitle = (title) => {
      const s = String(title || "");
      const yNow = now.getUTCFullYear();

      // ISO-like date: 2026-03-10
      const iso = s.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
      if (iso) {
        return buildUtcDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      }

      // Month name date: "March 10", "March 10 2026", "March 10, 2026".
      // Important: do NOT interpret time fragments like ", 10:00 UTC" as a year.
      const monthNamed = s.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:(?:,\s*|\s+)(20\d{2}))?\b/i);
      if (monthNamed) {
        const monthIdx = monthMap[String(monthNamed[1] || "").toLowerCase()];
        const day = Number(monthNamed[2]);
        let year = monthNamed[3] ? Number(monthNamed[3]) : yNow;
        let ts = buildUtcDate(year, monthIdx, day);
        if (ts === null) return null;
        // If year is omitted and this date has already passed, treat as next year occurrence.
        if (!monthNamed[3] && ts < todayUtcMs) {
          ts = buildUtcDate(year + 1, monthIdx, day);
        }
        return ts;
      }

      // Numeric date: 3/10[/2026]
      const md = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
      if (md) {
        const monthIdx = Number(md[1]) - 1;
        const day = Number(md[2]);
        let year = md[3] ? normalizeYear(Number(md[3])) : yNow;
        let ts = buildUtcDate(year, monthIdx, day);
        if (ts === null) return null;
        if (!md[3] && ts < todayUtcMs) {
          ts = buildUtcDate(year + 1, monthIdx, day);
        }
        return ts;
      }
      return null;
    };
    const parseTitleTimingConstraint = (title) => {
      const s = String(title || "");
      const full = s.match(/\b(on|by|before|at|after)\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,\s*(20\d{2}))?(?:\s+(\d{1,2}):(\d{2})\s*UTC)?\b/i);
      if (!full) return null;
      const mode = String(full[1] || "").toLowerCase();
      const monthIdx = monthMap[String(full[2] || "").toLowerCase()];
      const day = Number(full[3]);
      const year = full[4] ? Number(full[4]) : now.getUTCFullYear();
      const hh = full[5] ? Number(full[5]) : 20;
      const mm = full[6] ? Number(full[6]) : 0;
      const ts = Date.UTC(year, monthIdx, day, hh, mm, 0);
      if (!Number.isFinite(ts)) return null;
      return { mode, ts, hasTime: Boolean(full[5]) };
    };
    const isWithinNext30Days = (ts) => {
      const diffDays = Math.floor((ts - todayUtcMs) / DAY_MS);
      return diffDays >= 0 && diffDays <= 30;
    };

    const preprocessed = events.map((raw) => {
      const prepared = { ...(raw || {}) };
      let title = removeNonUtcTimezoneTokens(String(prepared.title || ""));
      const rawHours = Math.max(6, Math.min(720, parseInt(prepared.hoursToResolve) || 72));
      const parsedTs = parseDateFromTitle(title);
      let verifyTs = parseVerifyAtUtc(prepared.verifyAtUtc);
      let eventStartTs = parseVerifyAtUtc(prepared.eventStartAtUtc);

      // Repair missing verify timestamp using hoursToResolve to reduce avoidable rejects.
      if (verifyTs === null && Number.isFinite(rawHours)) {
        verifyTs = Date.now() + rawHours * 60 * 60 * 1000;
        prepared.verifyAtUtc = new Date(verifyTs).toISOString();
      }

      // Keep title semantics aligned with horizon.
      if (/\b(today|tonight|now)\b/i.test(title) && rawHours > 6 && verifyTs !== null) {
        const dayHint = new Date(verifyTs).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });
        title = title.replace(/\b(today|tonight|now)\b/gi, `by ${dayHint} UTC`);
      }

      // Add explicit date context for long-horizon markets if model omitted it.
      if (rawHours > 24 && parsedTs === null && verifyTs !== null) {
        const safeTitle = title.replace(/\?+$/, "").trim();
        const dayHint = new Date(verifyTs).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });
        title = `${safeTitle} by ${dayHint} UTC?`.slice(0, 100);
      }

      // For sports, infer event start if omitted but verify is present.
      if (String(category).toUpperCase() === "SPORTS" && eventStartTs === null && verifyTs !== null) {
        eventStartTs = verifyTs - 3 * 60 * 60 * 1000;
        prepared.eventStartAtUtc = new Date(eventStartTs).toISOString();
      }

      prepared.title = title;
      prepared.hoursToResolve = rawHours;
      return prepared;
    });

    const rejectionStats = {
      outOfWindowTitle: 0,
      outOfWindowVerify: 0,
      stale: 0,
      lowPopularity: 0,
      categoryDrift: 0,
      nonUtcTz: 0,
      ambiguousToday: 0,
      missingDateOrVerify: 0,
      sportsNoTime: 0,
      priceHallucination: 0,
    };

    const filtered = preprocessed.filter(e => {
      const title = String(e.title || "");
      const description = String(e.description || "");
      const rawHours = Math.max(6, Math.min(720, parseInt(e.hoursToResolve) || 72));
      const verifyTs = parseVerifyAtUtc(e.verifyAtUtc);
      const hasUtcTimeTitle = /\b\d{1,2}:\d{2}\s*UTC\b/i.test(title);
      const hasNonUtcTz = /\b(ET|EST|EDT|PT|PST|PDT|CET|CEST|BST|IST)\b/i.test(title);
      const parsedTs = parseDateFromTitle(title);
      const inferredCategory = inferCategoryFromText(`${title} ${description}`);
      if (parsedTs !== null && !isWithinNext30Days(parsedTs)) {
        rejectionStats.outOfWindowTitle += 1;
        console.log(`[AI] Filtered out out-of-window event (outside next 30d): "${title}"`);
        return false;
      }
      if (verifyTs !== null && !isWithinNext30Days(verifyTs)) {
        rejectionStats.outOfWindowVerify += 1;
        console.log(`[AI] Filtered out out-of-window verifyAtUtc: "${title}"`);
        return false;
      }
      if (/\b(yesterday|last week|last month|already happened)\b/i.test(title)) {
        rejectionStats.stale += 1;
        console.log(`[AI] Filtered out stale timing event: "${title}"`);
        return false;
      }
      const modelPopularity = Math.max(0, Math.min(100, Number(e.popularityScore ?? 0)));
      if (modelPopularity < 60) {
        rejectionStats.lowPopularity += 1;
        console.log(`[AI] Filtered out low-popularity event (score ${modelPopularity}): "${title}"`);
        return false;
      }
      if (!isPopularEvent(category, title, description) && modelPopularity < 75) {
        rejectionStats.lowPopularity += 1;
        console.log(`[AI] Filtered out low-popularity event (no keyword match, score ${modelPopularity}): "${title}"`);
        return false;
      }
      if (inferredCategory !== category) {
        rejectionStats.categoryDrift += 1;
        console.log(`[AI] Filtered out category-drift event (${category} -> ${inferredCategory}): "${title}"`);
        return false;
      }
      if (hasNonUtcTz) {
        rejectionStats.nonUtcTz += 1;
        console.log(`[AI] Filtered out non-UTC timezone in title: "${title}"`);
        return false;
      }
      if (/\b(today|tonight|now)\b/i.test(title) && rawHours > 6) {
        rejectionStats.ambiguousToday += 1;
        console.log(`[AI] Filtered out ambiguous timing event (>6h with today/tonight): "${title}"`);
        return false;
      }
      if (rawHours > 24 && parsedTs === null && verifyTs === null) {
        rejectionStats.missingDateOrVerify += 1;
        console.log(`[AI] Filtered out future-window event without explicit date/verifyAtUtc: "${title}"`);
        return false;
      }
      if (category === "SPORTS" && rawHours > 24 && verifyTs === null && !hasUtcTimeTitle) {
        rejectionStats.sportsNoTime += 1;
        console.log(`[AI] Filtered out sports event without exact UTC time: "${title}"`);
        return false;
      }
      return true;
    });
    if (events.length > 0) {
      console.log(
        `[AI] ${category} raw=${events.length} kept=${filtered.length} rejected=${events.length - filtered.length} reasons=${JSON.stringify(rejectionStats)}`
      );
    }

    const toSourceList = (v) => {
      if (!Array.isArray(v)) return [];
      return v
        .map((x) => String(x || "").trim())
        .filter((x) => /^https?:\/\//i.test(x))
        .slice(0, 8);
    };
    const normalized = filtered.map(e => ({
      title: String(e.title || "").slice(0, 100),
      description: String(e.description || "").slice(0, 260),
      category,
      aiProbability: Math.max(15, Math.min(85, parseInt(e.aiProbability) || 50)),
      hoursToResolve: Math.max(6, Math.min(720, parseInt(e.hoursToResolve) || 72)),
      eventStartAtUtc: typeof e.eventStartAtUtc === "string" ? e.eventStartAtUtc : "",
      verifyAtUtc: typeof e.verifyAtUtc === "string" ? e.verifyAtUtc : "",
      sources: toSourceList(e.sources),
      confidence: Math.max(0, Math.min(1, Number(e.confidence ?? 0.75))),
      popularityScore: Math.max(0, Math.min(100, Number(e.popularityScore ?? 70))),
      hasExplicitVerifyAt: typeof e.verifyAtUtc === "string" && Boolean(String(e.verifyAtUtc).trim()),
    }));

    const fmtUtc = (ts) => {
      const d = new Date(ts);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    };

    // Keep semantic consistency: "today/tonight/now" should stay very near-term.
    for (const e of normalized) {
      const nowTs = Date.now();
      const verifyTs = parseVerifyAtUtc(e.verifyAtUtc);
      const hasExplicitTimeInTitle = /\b\d{1,2}:\d{2}\s*UTC\b/i.test(String(e.title || ""));
      if (verifyTs !== null) {
        const diffH = Math.round((verifyTs - nowTs) / 3600000);
        if (diffH >= 6 && diffH <= 720) {
          e.hoursToResolve = diffH;
        }
      }
      if (/\b(today|tonight|now)\b/i.test(e.title) && e.hoursToResolve > 6) {
        e.hoursToResolve = 6;
      }
      const titleConstraint = parseTitleTimingConstraint(e.title);
      if (titleConstraint) {
        if (titleConstraint.mode === "after") {
          const currentVerify = parseVerifyAtUtc(e.verifyAtUtc) || nowTs;
          const minTs = titleConstraint.ts + 60 * 60 * 1000;
          e.verifyAtUtc = new Date(Math.max(currentVerify, minTs)).toISOString();
        } else {
          e.verifyAtUtc = new Date(titleConstraint.ts).toISOString();
        }
      }
      if (e.hoursToResolve > 24 && parseDateFromTitle(e.title) === null) {
        const targetTs = Date.now() + e.hoursToResolve * 3600000;
        const safeTitle = e.title.replace(/\?+$/, "").trim();
        e.title = `${safeTitle} by ${fmtUtc(targetTs)} UTC?`.slice(0, 100);
      }
      // If title includes explicit date, align hours to that date window.
      const parsedTs = parseDateFromTitle(e.title);
      if (parsedTs !== null) {
        const diffH = Math.round((parsedTs - nowTs) / 3600000);
        if (diffH > 6) {
          e.hoursToResolve = Math.max(6, Math.min(720, diffH));
        }
      }
      // Preserve explicit verify timestamp; synthesize only if missing.
      const finalVerifyTs = parseVerifyAtUtc(e.verifyAtUtc) ?? (nowTs + e.hoursToResolve * 3600000);
      e.verifyAtUtc = new Date(finalVerifyTs).toISOString();
      // For date-only ECONOMY/CLIMATE events, verify no earlier than end of that day.
      if ((category === "ECONOMY" || category === "CLIMATE") && parsedTs !== null && !hasExplicitTimeInTitle) {
        const dayEndTs = parsedTs + (24 * 60 * 60 * 1000) - 1000;
        const currentVerify = parseVerifyAtUtc(e.verifyAtUtc) || nowTs;
        if (currentVerify < dayEndTs) {
          e.verifyAtUtc = new Date(dayEndTs).toISOString();
        }
      }
      // If title has an explicit date, never allow verify date before that date.
      if (parsedTs !== null) {
        const currentVerify = parseVerifyAtUtc(e.verifyAtUtc) || nowTs;
        if (currentVerify < parsedTs) {
          e.verifyAtUtc = new Date(parsedTs + 20 * 60 * 60 * 1000).toISOString();
        }
      }
      const finalVerifyTs2 = parseVerifyAtUtc(e.verifyAtUtc) || nowTs;
      e.hoursToResolve = Math.max(6, Math.min(720, Math.round((finalVerifyTs2 - nowTs) / 3600000)));
      const startTs = parseVerifyAtUtc(e.eventStartAtUtc);
      if (startTs !== null) {
        e.eventStartAtUtc = new Date(startTs).toISOString();
      } else if (category === "SPORTS" && e.hoursToResolve > 24) {
        e.eventStartAtUtc = "";
      }
    }

    // Enforce horizon mix so feed is not concentrated in same-day events.
    if (normalized.length >= 5) {
      const recalc = () => ({
        within24: normalized.filter((e) => e.hoursToResolve <= 24).length,
        withinWeek: normalized.filter((e) => e.hoursToResolve > 24 && e.hoursToResolve <= 168).length,
        withinMonth: normalized.filter((e) => e.hoursToResolve > 168 && e.hoursToResolve <= 720).length,
      });
      let { withinWeek, withinMonth } = recalc();

      // At least 1 event in 8-30d.
      if (withinMonth < 1) {
        const candidate = normalized.find((e) => !/\b(today|tonight|now)\b/i.test(e.title));
        if (candidate) {
          candidate.hoursToResolve = 216; // ~9 days
          ({ withinWeek, withinMonth } = recalc());
        }
      }

      // At least 3 events in 1-7d.
      if (withinWeek < 3) {
        let need = 3 - withinWeek;
        for (const e of normalized) {
          if (need <= 0) break;
          if (e.hoursToResolve <= 24 && !/\b(today|tonight|now)\b/i.test(e.title) && !e.hasExplicitVerifyAt) {
            e.hoursToResolve = 72;
            ({ withinWeek } = recalc());
            need -= 1;
          } else if (e.hoursToResolve > 168 && !e.hasExplicitVerifyAt) {
            e.hoursToResolve = 120;
            ({ withinWeek, withinMonth } = recalc());
            need -= 1;
          }
        }
      }
    }
    // Keep timestamps coherent after any horizon rebalance.
    for (const e of normalized) {
      if (!parseVerifyAtUtc(e.verifyAtUtc) || !e.hasExplicitVerifyAt) {
        e.verifyAtUtc = new Date(Date.now() + e.hoursToResolve * 3600000).toISOString();
      }
    }

    const applyFinalTitleTimingConstraint = (e) => {
      const nowTs = Date.now();
      const constrained = { ...e };
      const titleConstraint = parseTitleTimingConstraint(constrained.title);
      if (titleConstraint) {
        if (titleConstraint.mode === "after") {
          const currentVerify = parseVerifyAtUtc(constrained.verifyAtUtc) || nowTs;
          const minTs = titleConstraint.ts + 60 * 60 * 1000;
          constrained.verifyAtUtc = new Date(Math.max(currentVerify, minTs)).toISOString();
        } else if (titleConstraint.hasTime) {
          constrained.verifyAtUtc = new Date(titleConstraint.ts).toISOString();
        } else {
          // Date-only "on/by/before" must resolve within that UTC date, not next day.
          const d = new Date(titleConstraint.ts);
          const eodTs = Date.UTC(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate(),
            23,
            59,
            59
          );
          constrained.verifyAtUtc = new Date(eodTs).toISOString();
        }
      }
      const verifyTs = parseVerifyAtUtc(constrained.verifyAtUtc) || nowTs;
      const eventStartTs = parseVerifyAtUtc(constrained.eventStartAtUtc);
      if (eventStartTs && verifyTs <= eventStartTs) {
        const verifyBufferMs = (CATEGORY_VERIFY_BUFFER_MINUTES[String(category || "CRYPTO").toUpperCase()] || 10) * 60 * 1000;
        constrained.verifyAtUtc = new Date(eventStartTs + verifyBufferMs).toISOString();
      }
      const verifyTs2 = parseVerifyAtUtc(constrained.verifyAtUtc) || nowTs;
      constrained.hoursToResolve = Math.max(6, Math.min(720, Math.round((verifyTs2 - nowTs) / 3600000)));
      return constrained;
    };

    let vetted = normalized;
    if (shouldRunStage("vet", category)) {
      vetted = await vetPredictionsWithWeb(category, normalized, { today, hour, day });
      markStageResult("vet", category, { noGain: sameEventSet(normalized, vetted) });
    } else {
      console.log(`[AI] ${category} vet skipped by cooldown`);
    }

    let arbitrated = vetted;
    if (shouldRunStage("arbiter", category)) {
      arbitrated = await finalizePredictionsWithArbiter(category, vetted, { today, hour, day });
      markStageResult("arbiter", category, { noGain: sameEventSet(vetted, arbitrated) });
    } else {
      console.log(`[AI] ${category} arbiter skipped by cooldown`);
    }
    const nowTs = Date.now();
    const finalRejectStats = {
      notEnoughSources: 0,
      missingVerify: 0,
      verifyTooSoon: 0,
      sportsMissingStart: 0,
      verifyBeforeStart: 0,
      shortDescription: 0,
      unsafeVoteWindow: 0,
    };

    const final = arbitrated
      .map(applyFinalTitleTimingConstraint)
      .filter((e) => {
        const longHorizon = Number(e?.hoursToResolve || 0) > 24;
        const verifyTs = parseIsoUtc(e?.verifyAtUtc);
        const eventStartTs = parseIsoUtc(e?.eventStartAtUtc);
        const sources = Array.isArray(e?.sources) ? e.sources : [];
        const uniqueSources = Array.from(
          new Set(sources.map((x) => String(x || "").trim()).filter((x) => /^https?:\/\//i.test(x)))
        );
        // Require at least two URLs to reduce hallucinated events.
        if (uniqueSources.length < 2) {
          finalRejectStats.notEnoughSources += 1;
          return false;
        }
        if (!verifyTs) {
          finalRejectStats.missingVerify += 1;
          return false;
        }
        if (verifyTs <= nowTs + 10 * 60 * 1000) {
          finalRejectStats.verifyTooSoon += 1;
          return false;
        }
        if (longHorizon && !verifyTs) {
          finalRejectStats.missingVerify += 1;
          return false;
        }
        if (category === "SPORTS" && !eventStartTs) {
          finalRejectStats.sportsMissingStart += 1;
          return false;
        }
        if (eventStartTs && verifyTs <= eventStartTs) {
          finalRejectStats.verifyBeforeStart += 1;
          return false;
        }
        const desc = String(e?.description || "").trim();
        if (desc.length < 80) {
          finalRejectStats.shortDescription += 1;
          return false;
        }
        const verifyBufferMs = (CATEGORY_VERIFY_BUFFER_MINUTES[String(category || "CRYPTO").toUpperCase()] || 10) * 60 * 1000;
        const voteLeadMs = (CATEGORY_VOTE_LEAD_MINUTES[String(category || "CRYPTO").toUpperCase()] || 10) * 60 * 1000;
        const voteCloseByVerify = verifyTs - verifyBufferMs;
        const parsedDateTs = parseDateFromTitle(e?.title);
        const hasTitleUtcTime = /\b\d{1,2}:\d{2}\s*UTC\b/i.test(String(e?.title || ""));
        const voteCloseByDateRule =
          (category === "ECONOMY" || category === "CLIMATE") && parsedDateTs !== null && !hasTitleUtcTime
            ? (parsedDateTs + (24 * 60 * 60 * 1000) - 1000) - (12 * 60 * 60 * 1000)
            : Number.POSITIVE_INFINITY;
        const voteCloseByStart =
          eventStartTs && useEventStartAnchor(category)
            ? eventStartTs - voteLeadMs
            : Number.POSITIVE_INFINITY;
        const voteCloseTs = Math.min(voteCloseByVerify, voteCloseByStart, voteCloseByDateRule);
        // Reject events where voting window is already unsafe/closed.
        if (!Number.isFinite(voteCloseTs) || voteCloseTs <= nowTs + 60 * 1000) {
          finalRejectStats.unsafeVoteWindow += 1;
          return false;
        }
        return true;
      })
      .map(({ hasExplicitVerifyAt, ...rest }) => ({
        ...rest,
        description: String(rest.description || "").trim(),
        sources: Array.from(
          new Set((Array.isArray(rest.sources) ? rest.sources : []).map((x) => String(x || "").trim()).filter((x) => /^https?:\/\//i.test(x)))
        ).slice(0, 8),
      }));

    const deduped = [];
    for (const evt of final) {
      if (deduped.some((x) => isNearDuplicateEvent(x, evt))) continue;
      const richDescription = evt.description.length >= 80 ? evt.description : buildDetailedDescription(evt);
      deduped.push({
        ...evt,
        description: String(richDescription).slice(0, 260),
      });
    }
    console.log(
      `[AI] ${category} pipeline: rawModel=${events.length} preFilter=${filtered.length} normalized=${normalized.length} vetted=${vetted.length} arbitrated=${arbitrated.length} final=${final.length} deduped=${deduped.length}`
    );
    if (arbitrated.length > final.length) {
      console.log(`[AI] ${category} final-rejects: ${JSON.stringify(finalRejectStats)}`);
    }
    return deduped;
  } catch (err) {
    console.warn(`[AI] ${category} generation parse/normalize failed: ${String(err?.message || err)}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════

export async function generateDailyPredictions(options = {}) {
  if (config.aiProvider === "mock" || !config.openrouterKey) {
    console.warn("[AI] Generation skipped: production mock generation is disabled.");
    return [];
  }

  const { today, hour, day } = getTimeInfo();
  console.log(`[AI] Generating for ${day} ${today} ${hour}:00 UTC`);
  console.log("[AI] Searching today's real news in 5 categories...");

  const avoidTitles = Array.isArray(options?.avoidTitles)
    ? options.avoidTitles.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const requestedCategories = Array.isArray(options?.categories)
    ? options.categories
      .map((x) => String(x || "").toUpperCase())
      .filter((x) => CATEGORIES.includes(x))
    : [];
  const selectedCategories = requestedCategories.length ? requestedCategories : CATEGORIES;
  decayStageCooldowns(selectedCategories);
  const contexts = await Promise.all(
    selectedCategories.map(async cat => {
      const ctx = await searchPopularEvents(cat);
      console.log(`[AI]   ${cat}: ${ctx.length} chars`);
      return { cat, ctx };
    })
  );

  console.log("[AI] Generating predictions from today's real news...");
  const initialBatches = await Promise.all(
    contexts.map(({ cat, ctx }) => generateCategoryPredictions(cat, ctx, { avoidTitles }))
  );

  const allByCategory = new Map();
  selectedCategories.forEach((cat, idx) => {
    allByCategory.set(cat, Array.isArray(initialBatches[idx]) ? initialBatches[idx] : []);
  });

  // Adaptive targeted reprompt: retry only low-yield categories.
  let repromptCount = 0;
  for (const { cat, ctx } of contexts) {
    const current = allByCategory.get(cat) || [];
    if (current.length >= 3) continue;
    if (repromptCount >= MAX_CATEGORY_REPROMPTS_PER_CYCLE) {
      console.log(
        `[AI] ${cat} adaptive-reprompt skipped: cycle limit reached (${MAX_CATEGORY_REPROMPTS_PER_CYCLE})`
      );
      continue;
    }
    const nowTs = Date.now();
    if (!canRunCategoryReprompt(cat, nowTs)) {
      const lastTs = Number(categoryRepromptLastAt.get(cat) || 0);
      const retryInSec = Math.max(
        0,
        Math.ceil((CATEGORY_REPROMPT_MIN_INTERVAL_MS - (nowTs - lastTs)) / 1000)
      );
      console.log(
        `[AI] ${cat} adaptive-reprompt skipped: cooldown active, retry in ${retryInSec}s`
      );
      continue;
    }
    const repromptAvoid = [
      ...avoidTitles,
      ...current.map((x) => String(x?.title || "").trim()).filter(Boolean),
    ];
    const extra = await generateCategoryPredictions(cat, ctx, {
      avoidTitles: repromptAvoid,
      strictReprompt: true,
      repromptReason: `Category produced only ${current.length} valid events in first pass`,
    });
    const merged = [];
    for (const evt of [...current, ...extra]) {
      if (merged.some((x) => isNearDuplicateEvent(x, evt))) continue;
      merged.push(evt);
    }
    allByCategory.set(cat, merged);
    categoryRepromptLastAt.set(cat, nowTs);
    repromptCount += 1;
    console.log(`[AI] ${cat} adaptive-reprompt: before=${current.length} extra=${extra.length} merged=${merged.length}`);
  }

  const all = selectedCategories.flatMap((cat) => allByCategory.get(cat) || []);
  const dist = selectedCategories.map(c => `${c}(${all.filter(e => e.category === c).length})`).join(" ");
  console.log(`[AI] Done: ${all.length} predictions — ${dist}`);
  if (all.length === 0) {
    console.warn("[AI] No production-grade predictions passed QA; returning empty set (mock fallback disabled).");
  }
  return all;
}

// ═══════════════════════════════════════════════════════════════════════════

export async function resolveExpiredPredictions(expiredEvents) {
  if (!expiredEvents?.length) return [];
  if (config.aiProvider === "mock" || !config.openrouterKey) {
    return expiredEvents.map(e => ({ eventId: e.eventId, outcome: Math.random() < 0.5, reasoning: "Mock" }));
  }

  const results = [];
  const resolveModel = config.openrouterResolveModel || config.openrouterSearchModel || config.openrouterModel;

  for (const evt of expiredEvents) {
    try {
      const evidence = await search(
        `What is the actual result of: "${evt.title}"? Search for today's real outcome. Give specific scores, prices, or facts.`
      );

      const resolverMessages = [
        {
          role: "system",
          content: `You fact-check prediction market outcomes. Based ONLY on evidence.
Return ONLY valid JSON in this strict schema:
{"verdict":"YES"|"NO","reasoning":"specific factual reason with key number/score"}
Rules:
- YES = statement in prediction title happened.
- NO = statement did not happen.
- If unclear, return NO.`,
        },
        {
          role: "user",
          content: `Prediction: "${evt.title}"
Evidence: ${evidence || "No evidence found."}
Critical disambiguation for sports:
- If title asks who won THIS MATCH tonight, evaluate only this match final score.
- Do NOT use aggregate/two-leg advancement as winner of this specific match.
Return: {"verdict":"YES"|"NO","reasoning":"specific fact"}`,
        },
      ];

      let parsed = null;
      let lastErr = null;
      for (let attempt = 1; attempt <= RESOLVE_RETRIES; attempt++) {
        try {
          const resolveOpts = { response_format: { type: "json_object" } };
          let judgment = await ask(resolveModel, resolverMessages, 0.1, 500, "resolve", resolveOpts);
          if (!judgment && config.openrouterFallback && config.openrouterFallback !== resolveModel) {
            judgment = await ask(config.openrouterFallback, resolverMessages, 0.1, 500, "resolve", resolveOpts);
          }
          if (!judgment) throw new Error("Empty resolver response");
          parsed = extractJSON(judgment);
          if (!parsed || (parsed.verdict !== "YES" && parsed.verdict !== "NO")) {
            throw new Error("Invalid resolver verdict: " + String(judgment).slice(0, 120));
          }
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < RESOLVE_RETRIES) {
            await sleep(700 * attempt); // backoff
          }
        }
      }

      if (!parsed) {
        const why = String(lastErr?.message || "resolver unavailable").slice(0, 100);
        results.push({
          eventId: evt.eventId,
          outcome: false,
          reasoning: `Resolve pending: ${why}`,
          retryable: true,
        });
        continue;
      }

      const outcome = parsed.verdict === "YES";
      const reasoning = String(parsed.reasoning || "").slice(0, 300);
      const inferred = inferOutcomeFromReasoning(evt.title, reasoning);
      if (inferred !== null && inferred !== outcome) {
        results.push({
          eventId: evt.eventId,
          outcome: false,
          reasoning: "Resolve pending: model verdict conflicts with factual reasoning text",
          retryable: true,
        });
        continue;
      }

      results.push({
        eventId: evt.eventId,
        outcome,
        reasoning,
        retryable: false,
      });
      console.log(`[AI]   #${evt.eventId}: ${outcome ? "YES" : "NO"} — ${(reasoning || "").slice(0, 60)}`);
    } catch (e) {
      console.error(`[AI]   #${evt.eventId} error: ${e.message}`);
      const short = String(e?.message || "").slice(0, 80);
      results.push({ eventId: evt.eventId, outcome: false, reasoning: `Resolve pending: ${short || "temporary error"}`, retryable: true });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════

export async function assessUserEventForListing({ title, category, deadlineMs, sourcePolicy }) {
  const isLikelyBinaryQuestion = (text) => {
    const t = String(text || "").trim();
    if (!t) return false;
    const hasQuestionMark = /\?\s*$/.test(t);
    const hasBinaryCueEn = /\b(will|is|are|does|do|did|can|could|would|won't|will not|happen|occur|reach|close|open|resume|start|end|win|lose|arrive)\b/i.test(t);
    const hasBinaryCueRu = /\b(ли|будет|будут|состоится|откроют|закроют|выиграет|произойдет|прилет|возобновят)\b/i.test(t);
    const hasSubjectiveCue = /\b(best|better|worse|beautiful|interesting|popular|good|bad)\b/i.test(t);
    return hasQuestionMark && (hasBinaryCueEn || hasBinaryCueRu) && !hasSubjectiveCue;
  };

  const cleanTitle = String(title || "").trim().slice(0, 180);
  if (!cleanTitle) {
    return {
      accepted: false,
      reason: "Empty title",
      normalizedTitle: "",
      normalizedDescription: "",
      aiProbability: 50,
      sourceLanguage: "unknown",
    };
  }

  if (config.aiProvider === "mock" || !config.openrouterKey) {
    return {
      accepted: true,
      reason: "AI unavailable, accepted with defaults",
      normalizedTitle: cleanTitle,
      normalizedDescription: "",
      aiProbability: 50,
      sourceLanguage: "unknown",
    };
  }

  const deadlineIso = Number.isFinite(Number(deadlineMs))
    ? new Date(Number(deadlineMs)).toISOString()
    : "unknown";
  const safeCategory = String(category || "CRYPTO").toUpperCase();
  const safeSourcePolicy = String(sourcePolicy || "official").toLowerCase();

  const sys = `You validate user-submitted prediction market events and estimate forecast probability.
Return ONLY strict JSON:
{
  "accepted": true|false,
  "reason": "short reason",
  "sourceLanguage": "BCP-47 code or language name",
  "normalizedTitle": "clear yes/no question in English, max 180 chars",
  "normalizedDescription": "short English context, max 180 chars",
  "aiProbability": 0-100
}
Rules:
- Preserve original meaning; do not invent new facts.
- normalizedTitle must be binary and unambiguous.
- Reject vague, subjective, impossible-to-verify, or non-binary questions.
- Keep names/tickers/numbers intact.
- If uncertain, accepted=false with clear reason.`;

  const user = `Category: ${safeCategory}
Source policy: ${safeSourcePolicy}
Deadline ISO: ${deadlineIso}
Original user title: "${cleanTitle}"`;

  const models = [config.openrouterModel, config.openrouterFallback].filter(Boolean);
  let parsed = null;
  let lastErr = null;

  for (const model of models) {
    if (!model) continue;
    try {
      const raw = await ask(model, [
        { role: "system", content: sys },
        { role: "user", content: user },
      ], 0.1, 700, "validate-user-event");
      if (!raw) continue;
      const data = JSON.parse(raw);
      const prob = Math.max(0, Math.min(100, parseInt(String(data.aiProbability), 10) || 50));
      parsed = {
        accepted: Boolean(data.accepted),
        reason: String(data.reason || "").slice(0, 200) || "Validation complete",
        sourceLanguage: String(data.sourceLanguage || "unknown").slice(0, 40),
        normalizedTitle: String(data.normalizedTitle || cleanTitle).slice(0, 180),
        normalizedDescription: String(data.normalizedDescription || "").slice(0, 180),
        aiProbability: prob,
      };
      break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!parsed) {
    return {
      accepted: true,
      reason: `AI validation fallback: ${String(lastErr?.message || "unavailable").slice(0, 120)}`,
      sourceLanguage: "unknown",
      normalizedTitle: cleanTitle,
      normalizedDescription: "",
      aiProbability: 50,
    };
  }

  // Basic hard guard independent of model output.
  if (!/[?]$/.test(parsed.normalizedTitle)) {
    parsed.normalizedTitle = `${parsed.normalizedTitle.replace(/\?*$/, "").trim()}?`.slice(0, 180);
  }

  // Guardrail: sometimes validator model rejects clearly binary questions as "vague/non-binary".
  // Accept such cases when local deterministic heuristic says the question is binary and verifiable.
  if (!parsed.accepted) {
    const rejectReason = String(parsed.reason || "").toLowerCase();
    const looksLikeFalseNegative = /(not.*binary|non[- ]?binary|vague question|too vague|unclear|question is in\s+[a-z-]+)/i.test(rejectReason);
    const candidate = parsed.normalizedTitle || cleanTitle;
    if (looksLikeFalseNegative && isLikelyBinaryQuestion(candidate)) {
      parsed.accepted = true;
      parsed.reason = "Accepted by binary guard after AI false-negative";
    }
  }

  return parsed;
}

// ═══════════════════════════════════════════════════════════════════════════

function generateMock() {
  return [
    { title: "Will Bitcoin be above $85,000 tonight?", category: "CRYPTO", aiProbability: 50, description: "BTC price check", hoursToResolve: 6 },
    { title: "Will S&P 500 close green today?", category: "ECONOMY", aiProbability: 52, description: "Market direction", hoursToResolve: 6 },
    { title: "Will any Premier League match today have 3+ goals?", category: "SPORTS", aiProbability: 55, description: "EPL today", hoursToResolve: 8 },
    { title: "Will any M5.0+ earthquake be reported today?", category: "CLIMATE", aiProbability: 60, description: "Seismic activity", hoursToResolve: 10 },
    { title: "Will any new sanctions be announced today?", category: "POLITICS", aiProbability: 30, description: "Geopolitics", hoursToResolve: 10 },
  ];
}
