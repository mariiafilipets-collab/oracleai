import OpenAI from "openai";
import config from "../config/index.js";
import { trackAICall } from "./ai-metrics.service.js";

const CATEGORIES = ["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"];
const RESOLVE_RETRIES = 3;

let client = null;
let aiPauseUntil = 0;
const AI_PAUSE_MS_ON_CREDIT_ERROR = 10 * 60 * 1000;

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

async function ask(model, messages, temp = 0.5, tokens = 2048, operation = "generate") {
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
  try {
    const r = await c.chat.completions.create({ model, messages, temperature: temp, max_tokens: tokens });
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

async function search(query) {
  return ask(config.openrouterSearchModel, [
    { role: "system", content: "You have live web search. Return only verified, factual, current information. Be specific: names, numbers, times, scores. Only events happening TODAY." },
    { role: "user", content: query },
  ], 0.1, 2000, "search");
}

async function generate(sysPrompt, userPrompt) {
  try {
    return await ask(config.openrouterModel, [
      { role: "system", content: sysPrompt },
      { role: "user", content: userPrompt },
    ], 0.7, 2500, "generate");
  } catch (e) {
    if (isInsufficientCreditsError(e)) return null;
    console.error(`[AI] Primary failed: ${e.message}`);
    return ask(config.openrouterFallback, [
      { role: "system", content: sysPrompt },
      { role: "user", content: userPrompt },
    ], 0.7, 2500, "generate");
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
  SPORTS: `What MAJOR sports matches and games are being played RIGHT NOW or in the next few hours TODAY?
Check: Premier League, La Liga, Serie A, Champions League, NBA tonight, NHL tonight, UFC/MMA fight card TODAY, F1 if race weekend, tennis tournaments in progress.
ONLY list matches happening TODAY with kickoff/tip-off times. Do NOT list future matches on other days.`,

  POLITICS: `What are the TOP political news stories RIGHT NOW today?
Focus on: US politics, Russia-Ukraine, Israel-Iran, China, EU decisions, elections TODAY, major protests happening NOW, sanctions announced TODAY.
Only things happening or announced TODAY — not scheduled for future days.`,

  ECONOMY: `What is happening in financial markets RIGHT NOW today?
Current exact prices: S&P 500, Nasdaq, Dow Jones, Gold, Oil. Are markets open now?
Any earnings reports TODAY? Central bank decisions TODAY? Economic data releases TODAY?
What stocks moved the most TODAY? Give exact current numbers and percentage changes.`,

  CRYPTO: `What is happening in crypto RIGHT NOW?
Bitcoin exact price right now? Ethereum exact price? 24h change?
What coins are pumping or dumping TODAY? Any hacks or exploits TODAY?
Any regulatory news TODAY? Any major listings or delistings TODAY?`,

  CLIMATE: `What weather and climate events are happening RIGHT NOW today?
Any active severe weather warnings RIGHT NOW? Hurricanes, storms, earthquakes in last 24h?
Extreme temperatures TODAY in any major city? Active wildfires? Flood warnings?
Only current, active events — not forecasts for next week.`,
};

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

async function generateCategoryPredictions(category, context) {
  const { today, hour, day } = getTimeInfo();

  const r = await generate(
    `You create prediction market events. You are extremely strict about dates.

ABSOLUTE RULES:
- Today is ${day}, ${today}, ${hour}:00 UTC
- ONLY create predictions about things happening TODAY (${today})
- NEVER reference dates other than today in the title
- NEVER create predictions about matches/events on future days
- Every prediction must resolve within a few hours from NOW
- The outcome MUST be verifiable by searching the web TONIGHT
- Frame as a clear YES/NO question with specific names and numbers
- hoursToResolve = hours from NOW until the result is known (2-12 max)
- If a sports match kicks off at 20:00 UTC and it's now ${hour}:00 UTC, hoursToResolve = ${Math.max(2, 20 - hour + 2)}
- For markets: will resolve when market closes today
- For crypto: will resolve in 2-8 hours based on price movement
- Return ONLY a JSON array of 5 objects, nothing else

REJECT these types of predictions:
- Events on other dates (e.g. "on March 10" when today is not March 10)
- Vague future events ("this week", "by Friday")
- Events that already happened today`,

    `Today: ${day}, ${today}, ${hour}:00 UTC. Category: ${category}

VERIFIED NEWS FOR TODAY:
${context || "No specific news. Use current verifiable facts: live prices, current standings, today's weather."}

Create exactly 5 predictions about things happening TODAY (${today}) only.
Each: {"title":"yes/no question max 80 chars, NO dates in title unless today","description":"context max 150 chars","category":"${category}","aiProbability":15-85,"hoursToResolve":2-12}

For SPORTS wording precision:
- If it is a two-leg/tournament tie, title MUST be about this specific match result only.
- Explicitly avoid aggregate ambiguity.
- Good: "Will Barcelona win this match vs Atletico tonight?"
- Bad: "Will Barcelona advance vs Atletico tonight?"
- Bad reasoning basis: aggregate score when title asks match winner.

DO NOT include any dates in the title. Say "today" or "tonight" instead of a specific date.
Good: "Will Real Madrid win tonight?" Bad: "Will Real Madrid win on March 10?"
Good: "Will Bitcoin close above $90k today?" Bad: "Will Bitcoin hit $90k this week?"`
  );

  if (!r) return [];
  try {
    const events = JSON.parse(r);
    if (!Array.isArray(events)) return [];

    // Filter out events with future dates in the title
    const todayShort = today.slice(5); // "03-02"
    const filtered = events.filter(e => {
      const title = String(e.title || "");
      // Check for date patterns like "March 10", "Mar 10", "3/10", "2026-03-10"
      const dateMatch = title.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})/i);
      if (dateMatch) {
        const mentioned = parseInt(dateMatch[1]);
        const todayDate = new Date().getUTCDate();
        if (mentioned !== todayDate) {
          console.log(`[AI] Filtered out future-dated event: "${title}"`);
          return false;
        }
      }
      return true;
    });

    return filtered.map(e => ({
      title: String(e.title || "").slice(0, 100),
      description: String(e.description || "").slice(0, 200),
      category,
      aiProbability: Math.max(15, Math.min(85, parseInt(e.aiProbability) || 50)),
      hoursToResolve: Math.max(2, Math.min(12, parseInt(e.hoursToResolve) || 6)),
    }));
  } catch { return []; }
}

// ═══════════════════════════════════════════════════════════════════════════

export async function generateDailyPredictions() {
  if (config.aiProvider === "mock" || !config.openrouterKey) return generateMock();

  const { today, hour, day } = getTimeInfo();
  console.log(`[AI] Generating for ${day} ${today} ${hour}:00 UTC`);
  console.log("[AI] Searching today's real news in 5 categories...");

  const contexts = await Promise.all(
    CATEGORIES.map(async cat => {
      const ctx = await searchPopularEvents(cat);
      console.log(`[AI]   ${cat}: ${ctx.length} chars`);
      return { cat, ctx };
    })
  );

  console.log("[AI] Generating predictions from today's real news...");
  const batches = await Promise.all(
    contexts.map(({ cat, ctx }) => generateCategoryPredictions(cat, ctx))
  );

  const all = batches.flat();
  const dist = CATEGORIES.map(c => `${c}(${all.filter(e => e.category === c).length})`).join(" ");
  console.log(`[AI] Done: ${all.length} predictions — ${dist}`);
  return all.length > 0 ? all : generateMock();
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
          let judgment = await ask(resolveModel, resolverMessages, 0.1, 500, "resolve");
          if (!judgment && config.openrouterFallback && config.openrouterFallback !== resolveModel) {
            judgment = await ask(config.openrouterFallback, resolverMessages, 0.1, 500, "resolve");
          }
          if (!judgment) throw new Error("Empty resolver response");
          parsed = JSON.parse(judgment);
          if (!parsed || (parsed.verdict !== "YES" && parsed.verdict !== "NO")) {
            throw new Error("Invalid resolver verdict");
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
