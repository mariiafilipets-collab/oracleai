import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config({ path: "./.env" });

const API = "http://localhost:3001";
const TITLE = "Will ETH daily transactions exceed 3 million today?";

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

async function ask(client, model, messages, temperature = 0.1, maxTokens = 800) {
  const r = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  });
  const content = r?.choices?.[0]?.message?.content || "";
  return clean(content);
}

async function main() {
  const client = getClient();
  const searchModel = process.env.OPENROUTER_SEARCH_MODEL || "perplexity/sonar";
  const mainModel = process.env.OPENROUTER_MODEL || "google/gemini-2.0-flash-001";
  const fallback = process.env.OPENROUTER_FALLBACK_MODEL || "deepseek/deepseek-chat-v3-0324";

  const all = await fetch(`${API}/api/predictions/all?limit=200&lang=en`).then((r) => r.json());
  const ev = (all.data || []).find((x) => x.eventId === 19 || x.title === TITLE);
  if (!ev) throw new Error("Event not found in API");

  const evidence = await ask(
    client,
    searchModel,
    [
      {
        role: "system",
        content:
          "You have live web search. Return only verified facts relevant to this exact event. Include concrete numbers.",
      },
      {
        role: "user",
        content: `What is the factual result for this event: "${ev.title}"?
Give exact Ethereum daily transactions numbers for that day and whether it exceeded 3,000,000.`,
      },
    ],
    0.1,
    1200
  );

  let judgment = await ask(
    client,
    mainModel,
    [
      {
        role: "system",
        content:
          "Return ONLY valid JSON. Decide outcome from evidence: true if statement happened, false otherwise. Format: {\"outcome\":true/false,\"reasoning\":\"short factual reason\"}",
      },
      {
        role: "user",
        content: `Event: "${ev.title}"
Evidence:
${evidence}`,
      },
    ],
    0.1,
    500
  );

  let parsed = null;
  try {
    parsed = JSON.parse(judgment);
  } catch {
    judgment = await ask(
      client,
      fallback,
      [
        {
          role: "system",
          content:
            "Return ONLY valid JSON. Decide outcome from evidence: true if statement happened, false otherwise. Format: {\"outcome\":true/false,\"reasoning\":\"short factual reason\"}",
        },
        {
          role: "user",
          content: `Event: "${ev.title}"
Evidence:
${evidence}`,
        },
      ],
      0.1,
      500
    );
    parsed = JSON.parse(judgment);
  }

  const modelOutcome = !!parsed?.outcome;
  const storedOutcome = !!ev.outcome;

  console.log(
    JSON.stringify(
      {
        eventId: ev.eventId,
        title: ev.title,
        stored: {
          outcome: storedOutcome,
          aiReasoning: ev.aiReasoning,
        },
        model: {
          modelUsed: mainModel,
          outcome: modelOutcome,
          reasoning: String(parsed?.reasoning || ""),
        },
        comparison: {
          outcomeMatches: storedOutcome === modelOutcome,
        },
        evidence: evidence.slice(0, 1000),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

