import OpenAI from "openai";
import config from "../config/index.js";
import { trackAICall } from "./ai-metrics.service.js";

const LANG_NAMES = {
  zh: "Chinese (Simplified)",
  ru: "Russian",
  es: "Spanish",
  fr: "French",
  ar: "Arabic",
};
export const SUPPORTED_LANGS = Object.keys(LANG_NAMES);

const MATCHUP_RE = /will\s+(.+?)\s+(?:beat|defeat|defeats|defeated|win(?:\s+against)?|lose to|vs\.?|versus)\s+(.+?)(?:\s+on\s+|\s+by\s+|\?|$)/i;

// Cache: key = `${eventId}:${lang}` → { title, description, aiReasoning }
const cache = new Map();
const CACHE_MAX = 2000;
const PRETRANSLATE_CHUNK = 4;
const TRANSLATE_TIMEOUT_MS_PRIMARY = 4000;
const TRANSLATE_TIMEOUT_MS_FALLBACK = 12000;
const ON_DEMAND_CHUNK = 3;
const FAIL_COOLDOWN_MS = 60_000;
const langCooldownUntil = new Map();
const inFlightByLang = new Map();
let translatePauseUntil = 0;
const TRANSLATE_PAUSE_MS_ON_CREDIT_ERROR = 10 * 60 * 1000;

function isInsufficientCreditsError(err) {
  const msg = String(err?.message || err || "");
  return msg.includes("402") || /insufficient credits/i.test(msg);
}

let client = null;

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

function parseTranslations(rawText) {
  if (!rawText) return null;
  const cleaned = rawText
    .trim()
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Some models prepend comments/text before JSON.
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start !== -1 && end > start) {
      const jsonSlice = cleaned.slice(start, end + 1);
      try {
        return JSON.parse(jsonSlice);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function uniqueStrings(arr) {
  return Array.from(new Set((arr || []).map((x) => String(x || "").trim()).filter(Boolean)));
}

function extractProtectedEntities(text) {
  const src = String(text || "");
  const out = [];
  const m = src.match(MATCHUP_RE);
  if (m) {
    out.push(String(m[1] || "").trim());
    out.push(String(m[2] || "").trim());
  }
  const tickers = src.match(/\$[A-Za-z0-9]{2,10}\b/g) || [];
  out.push(...tickers);
  const symbols = src.match(/\b(BTC|ETH|BNB|SOL|XRP|DOGE|SP500|NASDAQ|DOW|WTI|CPI|DXB)\b/g) || [];
  out.push(...symbols);
  return uniqueStrings(out).sort((a, b) => b.length - a.length);
}

function buildMaskedItems(items) {
  const masked = [];
  const byId = new Map();
  for (const it of items || []) {
    const id = String(it?.id ?? "");
    const entities = extractProtectedEntities(`${it?.title || ""} ${it?.description || ""} ${it?.aiReasoning || ""}`);
    const placeholders = entities.map((entity, idx) => ({ entity, token: `[[E${idx}]]` }));
    const maskText = (value) => {
      let out = String(value || "");
      for (const p of placeholders) {
        out = out.split(p.entity).join(p.token);
      }
      return out;
    };
    masked.push({
      id,
      title: maskText(it?.title),
      description: maskText(it?.description),
      aiReasoning: maskText(it?.aiReasoning),
    });
    byId.set(id, { placeholders });
  }
  return { masked, byId };
}

function unmaskRow(row, meta) {
  const placeholders = Array.isArray(meta?.placeholders) ? meta.placeholders : [];
  const restore = (value) => {
    let out = String(value || "");
    for (const p of placeholders) {
      out = out.split(p.token).join(p.entity);
    }
    return out;
  };
  return {
    ...row,
    title: restore(row?.title),
    description: restore(row?.description),
    aiReasoning: restore(row?.aiReasoning),
  };
}

function hasEntityMismatch(srcTitle, localizedTitle) {
  const entities = extractProtectedEntities(srcTitle);
  if (!entities.length) return false;
  const dst = String(localizedTitle || "");
  return entities.some((entity) => !dst.includes(entity));
}

function normalizeLocalized(evt, tr) {
  return {
    title: tr?.title || evt.title,
    description: tr?.description || evt.description || "",
    aiReasoning: tr?.aiReasoning || evt.aiReasoning || "",
  };
}

function hasCompleteLocalized(evt, localized, lang) {
  if (!localized) return false;
  if (hasEntityMismatch(evt?.title, localized?.title)) return false;
  const hasTitle = Boolean(localized.title) && (lang === "en" || localized.title !== evt?.title);
  const hasDescription = !evt?.description || (Boolean(localized.description) && (lang === "en" || localized.description !== evt?.description));
  const hasReasoning = !evt?.aiReasoning || (Boolean(localized.aiReasoning) && (lang === "en" || localized.aiReasoning !== evt?.aiReasoning));
  return hasTitle && hasDescription && hasReasoning;
}

export function isTranslationComplete(evt, localized, lang) {
  return hasCompleteLocalized(evt, localized, lang);
}

function setCache(key, value) {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const keys = [...cache.keys()];
    for (let i = 0; i < keys.length - CACHE_MAX / 2; i++) {
      cache.delete(keys[i]);
    }
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function timeoutMsForModel(model) {
  return model === config.openrouterModel
    ? TRANSLATE_TIMEOUT_MS_PRIMARY
    : TRANSLATE_TIMEOUT_MS_FALLBACK;
}

async function requestBatchTranslation(items, lang, model) {
  if (Date.now() < translatePauseUntil) {
    trackAICall({ operation: "translate", model: model || config.openrouterModel, status: "skipped", error: "paused-after-credit-error" });
    return null;
  }
  const c = getClient();
  if (!c || !items.length) {
    trackAICall({ operation: "translate", model: model || config.openrouterModel, status: "skipped", error: !c ? "client-not-configured" : "empty-items" });
    return null;
  }
  const timeoutMs = timeoutMsForModel(model || config.openrouterModel);
  const { masked, byId } = buildMaskedItems(items);
  for (let attempt = 1; attempt <= 1; attempt++) {
    const started = Date.now();
    try {
      const response = await Promise.race([
        c.chat.completions.create({
          model: model || config.openrouterModel,
          messages: [
            {
              role: "system",
              content: `Translate the following prediction market events to ${LANG_NAMES[lang]}. Keep names, numbers, tickers, team names, and dates unchanged. Translate naturally, not word-by-word. NEVER alter placeholders like [[E0]], [[E1]]. Return ONLY a JSON array.`,
            },
            {
              role: "user",
              content: `Translate to ${LANG_NAMES[lang]}:\n${JSON.stringify(masked)}\n\nReturn: [{"id":"...","title":"translated","description":"translated","aiReasoning":"translated"}]`,
            },
          ],
          temperature: 0.2,
          max_tokens: 2500,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`translate timeout (${timeoutMs}ms)`)), timeoutMs)
        ),
      ]);
      const raw = response.choices?.[0]?.message?.content || "";
      const parsed = parseTranslations(raw);
      if (Array.isArray(parsed)) {
        const unmasked = parsed.map((row) => {
          const id = String(row?.id ?? "");
          return unmaskRow(row, byId.get(id));
        });
        trackAICall({ operation: "translate", model: model || config.openrouterModel, status: "success", latencyMs: Date.now() - started });
        return unmasked;
      }
      trackAICall({ operation: "translate", model: model || config.openrouterModel, status: "error", latencyMs: Date.now() - started, error: "parse-failed" });
    } catch (err) {
      trackAICall({ operation: "translate", model: model || config.openrouterModel, status: "error", latencyMs: Date.now() - started, error: err?.message || err });
      if (isInsufficientCreditsError(err)) {
        translatePauseUntil = Date.now() + TRANSLATE_PAUSE_MS_ON_CREDIT_ERROR;
        langCooldownUntil.set(lang, Date.now() + TRANSLATE_PAUSE_MS_ON_CREDIT_ERROR);
        console.warn("[Translate] OpenRouter credits exhausted, pausing translation calls for 10 minutes");
        return null;
      }
    }
  }
  return null;
}

export function translateEvents(events, lang) {
  if (!lang || lang === "en" || !LANG_NAMES[lang]) return events;
  return events.map((evt) => {
    const id = String(evt.eventId || evt._id);
    const stored = evt.translations?.[lang];
    if (hasCompleteLocalized(evt, stored, lang)) {
      return { ...evt, ...normalizeLocalized(evt, stored) };
    }
    const cached = cache.get(`${id}:${lang}`);
    if (hasCompleteLocalized(evt, cached, lang)) {
      return { ...evt, ...normalizeLocalized(evt, cached) };
    }
    return evt;
  });
}

export async function translateMissingEvents(events, lang) {
  if (!lang || lang === "en" || !LANG_NAMES[lang] || !Array.isArray(events) || !events.length) return {};
  const c = getClient();
  if (!c) return {};
  const now = Date.now();
  const cooldown = langCooldownUntil.get(lang) || 0;
  if (cooldown > now) return {};
  if (inFlightByLang.get(lang)) return inFlightByLang.get(lang);

  const missing = [];
  for (const evt of events) {
    const id = String(evt.eventId || evt._id);
    const stored = evt.translations?.[lang];
    if (hasCompleteLocalized(evt, stored, lang)) continue;
    const cached = cache.get(`${id}:${lang}`);
    if (hasCompleteLocalized(evt, cached, lang)) continue;
    missing.push(evt);
  }
  if (!missing.length) return {};

  const job = (async () => {
    const out = {};
    try {
      const slice = missing.slice(0, 12); // hard cap per request cycle
      const items = slice.map((e, idx) => ({
        id: String(idx),
        title: e.title,
        description: e.description || "",
        aiReasoning: e.aiReasoning || "",
      }));
      const srcById = new Map(items.map((it, idx) => [it.id, slice[idx]]));

      for (let i = 0; i < items.length; i += ON_DEMAND_CHUNK) {
        const part = items.slice(i, i + ON_DEMAND_CHUNK);
        let translated = await requestBatchTranslation(part, lang, config.openrouterModel);
        if (!Array.isArray(translated) && config.openrouterFallback && config.openrouterFallback !== config.openrouterModel) {
          translated = await requestBatchTranslation(part, lang, config.openrouterFallback);
        }
        if (!Array.isArray(translated)) continue;
        const tMap = new Map(translated.map((t) => [String(t.id), t]));
        for (const it of part) {
          const src = srcById.get(it.id);
          if (!src) continue;
          const tr = tMap.get(it.id);
          const normalized = normalizeLocalized(src, tr);
          const keyId = String(src.eventId || src._id || `${i}-${it.id}`);
          setCache(`${keyId}:${lang}`, normalized);
          out[keyId] = normalized;
        }
      }
      return out;
    } catch (err) {
      langCooldownUntil.set(lang, Date.now() + FAIL_COOLDOWN_MS);
      console.warn(`[Translate] ${lang} on-demand failed: ${err.message}`);
      return {};
    } finally {
      inFlightByLang.delete(lang);
    }
  })();

  inFlightByLang.set(lang, job);
  return job;
}

// Pre-translate freshly created events for all languages, so read APIs are instant.
// If translation fails, keep field empty so on-demand translator can retry later.
export async function pretranslateEvents(events, langs = SUPPORTED_LANGS) {
  if (!Array.isArray(events) || !events.length) return [];
  const localized = events.map(() => ({}));
  const c = getClient();

  for (const lang of langs) {
    if (!LANG_NAMES[lang]) continue;
    if (!c) continue;

    const items = events.map((e, idx) => ({
      id: String(idx),
      title: e.title,
      description: e.description || "",
      aiReasoning: e.aiReasoning || "",
    }));

    for (const part of chunk(items, PRETRANSLATE_CHUNK)) {
      try {
        let translated = await requestBatchTranslation(part, lang, config.openrouterModel);
        if (!Array.isArray(translated) && config.openrouterFallback && config.openrouterFallback !== config.openrouterModel) {
          translated = await requestBatchTranslation(part, lang, config.openrouterFallback);
        }
        if (!Array.isArray(translated)) {
          console.warn(`[Translate] ${lang} parse failed; using source text`);
          continue;
        }
        const tMap = new Map(translated.map((t) => [String(t.id), t]));
        for (const it of part) {
          const idx = Number(it.id);
          const tr = tMap.get(it.id);
          const normalized = normalizeLocalized(events[idx], tr);
          localized[idx][lang] = normalized;
          const keyId = String(events[idx].eventId || events[idx]._id || idx);
          setCache(`${keyId}:${lang}`, normalized);
        }
      } catch (err) {
        console.warn(`[Translate] ${lang} pretranslate failed: ${err.message}`);
      }
    }
  }

  return localized;
}
