import config from "../config/index.js";

const token = String(config.betterstackSourceToken || "").trim();
const ingestUrl = String(config.betterstackIngestUrl || "").trim();

let enabled = Boolean(token) && Boolean(ingestUrl);
let pending = [];
let flushing = false;
const MAX_BUFFER = 500;
const FLUSH_INTERVAL_MS = 2000;

function nowIso() {
  return new Date().toISOString();
}

function normalizeArg(value) {
  if (value instanceof Error) {
    return {
      errorName: value.name,
      errorMessage: value.message,
      errorStack: value.stack || "",
    };
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildEntry(level, args) {
  const text = args.map(normalizeArg).join(" ");
  return {
    dt: nowIso(),
    level,
    message: text,
    service: "oracleai-backend",
    environment: process.env.NODE_ENV || "production",
  };
}

async function flush() {
  if (!enabled || flushing || pending.length === 0) return;
  flushing = true;
  const batch = pending.splice(0, 100);
  try {
    const body = batch.map((x) => JSON.stringify(x)).join("\n");
    await fetch(ingestUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-ndjson",
      },
      body,
    });
  } catch {
    // Silent failure: never block app behavior on telemetry sink failures.
    pending = batch.concat(pending).slice(-MAX_BUFFER);
  } finally {
    flushing = false;
  }
}

if (enabled) {
  setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS).unref?.();
}

export function betterstackEnabled() {
  return enabled;
}

export function sendLog(level, args) {
  if (!enabled) return;
  pending.push(buildEntry(level, args));
  if (pending.length > MAX_BUFFER) {
    pending = pending.slice(-MAX_BUFFER);
  }
}
