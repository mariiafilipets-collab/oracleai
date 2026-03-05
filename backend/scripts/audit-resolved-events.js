import dotenv from "dotenv";
import mongoose from "mongoose";
import OpenAI from "openai";

dotenv.config({ path: "./.env" });

const MONGO = process.env.MONGODB_URI || "mongodb://127.0.0.1:27018/oai-local";
const resolveModel = process.env.OPENROUTER_RESOLVE_MODEL || "perplexity/sonar";
const fallbackModel = process.env.OPENROUTER_FALLBACK_MODEL || "deepseek/deepseek-chat-v3-0324";

function getClient() {
  const key = process.env.OPENROUTER_API_KEY || "";
  if (!key) throw new Error("OPENROUTER_API_KEY is missing");
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: key,
    defaultHeaders: {
      "HTTP-Referer": "https://oracleai.predict",
      "X-Title": "OracleAI Predict",
    },
  });
}

function clean(text) {
  return String(text || "")
    .trim()
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

async function ask(client, model, messages, maxTokens = 600) {
  const r = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.1,
    max_tokens: maxTokens,
  });
  const content = r?.choices?.[0]?.message?.content || "";
  if (!content.trim()) throw new Error("Empty model response");
  return clean(content);
}

async function verifyOne(client, evt) {
  const prompt = [
    {
      role: "system",
      content:
        "You have live web search. Return ONLY valid JSON with strict schema: {\"verdict\":\"YES\"|\"NO\",\"reasoning\":\"short factual reason with number/source hint\"}. `YES` means the prediction statement happened. `NO` means it did not happen.",
    },
    {
      role: "user",
      content: `Verify prediction result by factual web evidence.
Title: "${evt.title}"
Category: ${evt.category}
Deadline (UTC): ${new Date(evt.deadline).toISOString()}
Current stored outcome: ${evt.outcome}
Task: determine if the statement in title happened.
Return verdict YES if statement happened, NO otherwise.`,
    },
  ];

  let raw = "";
  try {
    raw = await ask(client, resolveModel, prompt);
  } catch {
    raw = await ask(client, fallbackModel, prompt);
  }
  const j = JSON.parse(raw);
  const verdict = String(j.verdict || "").toUpperCase();
  if (verdict !== "YES" && verdict !== "NO") {
    throw new Error("Invalid verdict from model");
  }
  return {
    outcome: verdict === "YES",
    reasoning: String(j.reasoning || "").slice(0, 300),
  };
}

async function main() {
  const client = getClient();
  await mongoose.connect(MONGO);
  const db = mongoose.connection.db;
  const apply = process.argv.includes("--apply");

  const rows = await db
    .collection("predictionevents")
    .find({
      resolved: true,
      aiReasoning: { $not: /^Archived/i },
    })
    .project({ eventId: 1, title: 1, category: 1, deadline: 1, outcome: 1, aiReasoning: 1 })
    .sort({ eventId: 1 })
    .toArray();

  const report = {
    checked: rows.length,
    matched: 0,
    mismatched: 0,
    errors: 0,
    mismatches: [],
    errorSamples: [],
    model: resolveModel,
  };

  for (const evt of rows) {
    try {
      const v = await verifyOne(client, evt);
      const same = v.outcome === !!evt.outcome;
      if (same) {
        report.matched += 1;
      } else {
        report.mismatched += 1;
        const row = {
          eventId: evt.eventId,
          title: evt.title,
          storedOutcome: !!evt.outcome,
          modelOutcome: v.outcome,
          storedReasoning: String(evt.aiReasoning || "").slice(0, 180),
          modelReasoning: v.reasoning,
        };
        report.mismatches.push(row);
        if (apply) {
          await db.collection("predictionevents").updateOne(
            { eventId: evt.eventId },
            {
              $set: {
                outcome: v.outcome,
                aiReasoning: v.reasoning || "Verified by internet model audit.",
              },
            }
          );
        }
      }
    } catch (e) {
      report.errors += 1;
      if (report.errorSamples.length < 20) {
        report.errorSamples.push({
          eventId: evt.eventId,
          title: evt.title,
          error: String(e?.message || e).slice(0, 200),
        });
      }
    }
  }

  report.applyMode = apply;
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

