const MAX_RECENT = 200;
const OPERATIONS = ["search", "generate", "resolve", "translate"];

const state = {
  startedAt: new Date().toISOString(),
  totals: {
    requests: 0,
    success: 0,
    errors: 0,
    skipped: 0,
  },
  byOperation: Object.fromEntries(
    OPERATIONS.map((op) => [
      op,
      {
        requests: 0,
        success: 0,
        errors: 0,
        skipped: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0,
        lastCallAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: null,
      },
    ])
  ),
  byModel: {},
  recent: [],
};

function ensureOp(op) {
  if (!state.byOperation[op]) {
    state.byOperation[op] = {
      requests: 0,
      success: 0,
      errors: 0,
      skipped: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 0,
      lastCallAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
    };
  }
  return state.byOperation[op];
}

function ensureModel(model) {
  const key = model || "unknown";
  if (!state.byModel[key]) {
    state.byModel[key] = { requests: 0, success: 0, errors: 0, skipped: 0 };
  }
  return state.byModel[key];
}

export function trackAICall({
  operation,
  model,
  status, // success | error | skipped
  latencyMs = 0,
  error = null,
}) {
  const now = new Date().toISOString();
  const op = ensureOp(operation || "unknown");
  const modelStats = ensureModel(model);

  state.totals.requests++;
  op.requests++;
  modelStats.requests++;
  op.lastCallAt = now;

  if (status === "success") {
    state.totals.success++;
    op.success++;
    modelStats.success++;
    op.lastSuccessAt = now;
  } else if (status === "skipped") {
    state.totals.skipped++;
    op.skipped++;
    modelStats.skipped++;
  } else {
    state.totals.errors++;
    op.errors++;
    modelStats.errors++;
    op.lastErrorAt = now;
    op.lastError = error ? String(error).slice(0, 400) : "unknown error";
  }

  if (latencyMs > 0) {
    op.totalLatencyMs += latencyMs;
    const denom = Math.max(1, op.success + op.errors);
    op.avgLatencyMs = Math.round(op.totalLatencyMs / denom);
  }

  state.recent.unshift({
    at: now,
    operation: operation || "unknown",
    model: model || "unknown",
    status: status || "error",
    latencyMs: Math.round(latencyMs || 0),
    error: error ? String(error).slice(0, 200) : null,
  });
  if (state.recent.length > MAX_RECENT) state.recent.length = MAX_RECENT;
}

export function getAIMetrics() {
  return {
    startedAt: state.startedAt,
    uptimeSec: Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000),
    totals: state.totals,
    byOperation: state.byOperation,
    byModel: state.byModel,
    recent: state.recent.slice(0, 100),
  };
}

