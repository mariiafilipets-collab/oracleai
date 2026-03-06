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
    { role: "system", content: "You have live web search. Return only verified, factual, current information. Be specific: names, numbers, times, scores. Focus on mainstream/high-interest topics with reliable sources. Include both currently running events and upcoming events in the next 30 days, prioritizing the next 1-7 days." },
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
    category,
  }));
  const sys = `You are a strict prediction-market QA checker with live web search.
Validate each candidate for:
1) mainstream relevance (massively discussed topic),
2) temporal correctness (event still pending, not already decided),
3) resolvability timing consistency.
Return ONLY JSON array:
[{"idx":number,"accepted":true|false,"reason":"short","adjustedHoursToResolve":number|null}]
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
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
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
      out.push({
        ...events[i],
        hoursToResolve: Number.isFinite(adjusted)
          ? Math.max(6, Math.min(720, adjusted))
          : events[i].hoursToResolve,
      });
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

async function generateCategoryPredictions(category, context) {
  const { today, hour, day } = getTimeInfo();

  const r = await generate(
    `You create prediction market events. You are strict about timing and verifiability.

ABSOLUTE RULES:
- Today is ${day}, ${today}, ${hour}:00 UTC
- Create predictions for events from now up to the next 30 days.
- Prefer the next 1-7 days for most events.
- At least 3 of 5 predictions should resolve in 1-7 days.
- You may include explicit dates if they are within the next 30 days.
- The outcome MUST be verifiable by trusted sources at or shortly after deadline.
- Prefer HIGH-POPULARITY topics only (major teams, major assets, major political/economic headlines).
- Avoid niche/local/low-volume topics unless they are globally trending today.
- Frame as a clear YES/NO question with specific names and numbers
- hoursToResolve = hours from NOW until result is known (6-720 max)
- Most hoursToResolve should be 24-168 (1-7 days)
- If hoursToResolve > 24, include explicit UTC date context in title (e.g., "on March 9", "by Mar 10 18:00 UTC")
- Do NOT use "today/tonight/now" unless hoursToResolve <= 6
- hoursToResolve must reflect real result availability (e.g., match end, market close, official statement window)
- For markets: will resolve when market closes today
- For crypto: usually 6-48h, unless event is a scheduled date item
- Return ONLY a JSON array of 5 objects, nothing else

REJECT these types of predictions:
- Events with deadlines beyond 30 days
- Vague timing ("sometime soon") or unverifiable outcomes
- Events that already happened
- Events that are not sufficiently popular/visible`,

    `Today: ${day}, ${today}, ${hour}:00 UTC. Category: ${category}

VERIFIED NEWS FOR TODAY:
${context || "No specific news. Use current verifiable facts: live prices, current standings, today's weather."}

Create exactly 5 predictions about events in the next 30 days.
Each: {"title":"yes/no question max 80 chars","description":"context max 150 chars","category":"${category}","aiProbability":15-85,"hoursToResolve":6-720}
Required horizon mix per 5 events:
- at least 1 event resolving within 6-24h
- at least 3 events resolving within 24-168h (1-7 days)
- at least 1 event resolving within 168-720h (8-30 days)

For SPORTS wording precision:
- If it is a two-leg/tournament tie, title MUST be about this specific match result only.
- Explicitly avoid aggregate ambiguity.
- Good: "Will Barcelona win this match vs Atletico tonight?"
- Bad: "Will Barcelona advance vs Atletico tonight?"
- Bad reasoning basis: aggregate score when title asks match winner.

If helpful, include concrete date/time context in title for future events within 30 days.
Good: "Will Real Madrid win on March 10?"
Good: "Will Bitcoin close above $90k this week?"
Bad: "Will Bitcoin rise soon?"`
  );

  if (!r) return [];
  try {
    const events = JSON.parse(r);
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
    const isWithinNext30Days = (ts) => {
      const diffDays = Math.floor((ts - todayUtcMs) / DAY_MS);
      return diffDays >= 0 && diffDays <= 30;
    };

    const filtered = events.filter(e => {
      const title = String(e.title || "");
      const description = String(e.description || "");
      const rawHours = Math.max(6, Math.min(720, parseInt(e.hoursToResolve) || 72));
      const parsedTs = parseDateFromTitle(title);
      if (parsedTs !== null && !isWithinNext30Days(parsedTs)) {
        console.log(`[AI] Filtered out out-of-window event (outside next 30d): "${title}"`);
        return false;
      }
      if (/\b(yesterday|last week|last month|already happened)\b/i.test(title)) {
        console.log(`[AI] Filtered out stale timing event: "${title}"`);
        return false;
      }
      if (!isPopularEvent(category, title, description)) {
        console.log(`[AI] Filtered out low-popularity event: "${title}"`);
        return false;
      }
      if (/\b(today|tonight|now)\b/i.test(title) && rawHours > 6) {
        console.log(`[AI] Filtered out ambiguous timing event (>6h with today/tonight): "${title}"`);
        return false;
      }
      if (rawHours > 24 && parsedTs === null) {
        console.log(`[AI] Filtered out future-window event without explicit date: "${title}"`);
        return false;
      }
      return true;
    });

    const normalized = filtered.map(e => ({
      title: String(e.title || "").slice(0, 100),
      description: String(e.description || "").slice(0, 200),
      category,
      aiProbability: Math.max(15, Math.min(85, parseInt(e.aiProbability) || 50)),
      hoursToResolve: Math.max(6, Math.min(720, parseInt(e.hoursToResolve) || 72)),
    }));

    const fmtUtc = (ts) => {
      const d = new Date(ts);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    };

    // Keep semantic consistency: "today/tonight/now" should stay very near-term.
    for (const e of normalized) {
      if (/\b(today|tonight|now)\b/i.test(e.title) && e.hoursToResolve > 6) {
        e.hoursToResolve = 6;
      }
      if (e.hoursToResolve > 24 && parseDateFromTitle(e.title) === null) {
        const targetTs = Date.now() + e.hoursToResolve * 3600000;
        const safeTitle = e.title.replace(/\?+$/, "").trim();
        e.title = `${safeTitle} by ${fmtUtc(targetTs)} UTC?`.slice(0, 100);
      }
      // If title includes explicit date, align hours to that date window.
      const parsedTs = parseDateFromTitle(e.title);
      if (parsedTs !== null) {
        const diffH = Math.round((parsedTs - Date.now()) / 3600000);
        if (diffH > 6) {
          e.hoursToResolve = Math.max(6, Math.min(720, diffH));
        }
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
          if (e.hoursToResolve <= 24 && !/\b(today|tonight|now)\b/i.test(e.title)) {
            e.hoursToResolve = 72;
            ({ withinWeek } = recalc());
            need -= 1;
          } else if (e.hoursToResolve > 168) {
            e.hoursToResolve = 120;
            ({ withinWeek, withinMonth } = recalc());
            need -= 1;
          }
        }
      }
    }
    const vetted = await vetPredictionsWithWeb(category, normalized, { today, hour, day });
    return vetted;
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
