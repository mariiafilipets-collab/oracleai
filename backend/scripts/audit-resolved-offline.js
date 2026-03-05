import mongoose from "mongoose";

const MONGO = process.env.MONGODB_URI || "mongodb://127.0.0.1:27018/oai-local";

function inferOutcomeFromReasoning(title, reasoning) {
  const t = String(title || "").toLowerCase();
  const r = String(reasoning || "").toLowerCase();
  if (!r) return null;
  const has = (re) => re.test(r);

  const m = t.match(/will\s+(.+?)\s+(beat|win against|defeat)\s+(.+?)\s+(tonight|today|\?)/);
  if (m) {
    const teamA = m[1].trim();
    const teamB = m[3].trim();
    if (has(/\b(draw|drew|0-0|1-1|2-2)\b/)) return false;
    if (teamB && has(new RegExp(`\\b${teamB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b\\s+won`))) return false;
    if (teamA && has(new RegExp(`\\b${teamA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b\\s+won`))) return true;
    if (has(/\b(did not beat|failed to beat|lost)\b/)) return false;
    if (has(/\b(beat|defeated)\b/)) return true;
  }

  if (/(above|exceed|reach|>=|more than|at least)/.test(t)) {
    if (has(/\b(less than|below|under|not more than|did not|didn't|not reach|failed to)\b/)) return false;
    if (has(/\b(did not|didn't|below|under|failed to|no evidence|not reach|did not exceed)\b/)) return false;
    if (has(/\b(exceeded|above|reached|surged above|closed above)\b/)) return true;
  }

  if (/\b(any new|new wildfire|new wildfires)\b/.test(t)) {
    if (has(/\b(no new|none reported|not reported)\b/)) return false;
    if (has(/\b(new .* reported|were reported|has been reported)\b/)) return true;
  }
  if (/(>=3 goals|3\+ goals|three goals)/.test(t)) {
    if (has(/\b(0-0|1-0|1-1|2-0|2-1|2 goals|0 goals|1 goal)\b/)) return false;
    if (has(/\b(3-0|3-1|3-2|4-1|4-2|5 goals|4 goals|3 goals)\b/)) return true;
  }

  return null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(MONGO);
  const db = mongoose.connection.db;

  const rows = await db
    .collection("predictionevents")
    .find({
      resolved: true,
      aiReasoning: { $not: /^Archived/i },
    })
    .project({ eventId: 1, title: 1, outcome: 1, aiReasoning: 1, resolvePending: 1, resolveAttempts: 1 })
    .sort({ eventId: 1 })
    .toArray();

  const report = {
    checked: rows.length,
    deterministic: 0,
    corrected: 0,
    noSignal: 0,
    mismatches: [],
    applyMode: apply,
  };

  for (const e of rows) {
    const inferred = inferOutcomeFromReasoning(e.title, e.aiReasoning);
    if (inferred === null) {
      report.noSignal += 1;
      continue;
    }
    report.deterministic += 1;
    const stored = !!e.outcome;
    if (stored !== inferred) {
      report.mismatches.push({
        eventId: e.eventId,
        title: e.title,
        storedOutcome: stored,
        inferredOutcome: inferred,
        reasoning: String(e.aiReasoning || "").slice(0, 220),
      });
      if (apply) {
        await db.collection("predictionevents").updateOne(
          { eventId: e.eventId },
          {
            $set: {
              outcome: inferred,
              resolvePending: false,
              nextResolveRetryAt: null,
              lastResolveError: "",
            },
          }
        );
        report.corrected += 1;
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

