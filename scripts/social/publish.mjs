#!/usr/bin/env node

import fs from "fs";
import path from "path";

const channels = (process.env.SOCIAL_CHANNELS || "x,telegram,discord,instagram,tiktok")
  .split(",")
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);

const dryRun = String(process.env.SOCIAL_DRY_RUN || "true").toLowerCase() !== "false";
const root = process.cwd();
const templatePath = process.env.SOCIAL_TEMPLATE_FILE || path.join(root, "ops", "social", "post-templates.md");
const campaign = process.env.SOCIAL_CAMPAIGN || "oracleai-weekly";
const locale = process.env.SOCIAL_LOCALE || "en";

function loadTemplate() {
  try {
    return fs.readFileSync(templatePath, "utf8");
  } catch {
    return "OracleAI update: AI-powered prediction markets are live.";
  }
}

function buildPostText(template) {
  const now = new Date().toISOString();
  return `[${campaign}] ${template}\n\nLocale: ${locale}\nPublishedAt: ${now}`;
}

async function postX(text) {
  const endpoint = process.env.X_API_POST_URL;
  const token = process.env.X_API_BEARER_TOKEN;
  if (!endpoint || !token) return { channel: "x", skipped: true, reason: "missing credentials" };
  if (dryRun) return { channel: "x", dryRun: true, preview: text.slice(0, 180) };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text }),
  });
  return { channel: "x", ok: r.ok, status: r.status };
}

async function postTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { channel: "telegram", skipped: true, reason: "missing credentials" };
  const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;
  if (dryRun) return { channel: "telegram", dryRun: true, preview: text.slice(0, 180) };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return { channel: "telegram", ok: r.ok, status: r.status };
}

async function postDiscord(text) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return { channel: "discord", skipped: true, reason: "missing webhook" };
  if (dryRun) return { channel: "discord", dryRun: true, preview: text.slice(0, 180) };
  const r = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text }),
  });
  return { channel: "discord", ok: r.ok, status: r.status };
}

async function postInstagram(text) {
  const endpoint = process.env.INSTAGRAM_GRAPH_POST_URL;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!endpoint || !token) return { channel: "instagram", skipped: true, reason: "missing credentials" };
  if (dryRun) return { channel: "instagram", dryRun: true, preview: text.slice(0, 180) };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ caption: text }),
  });
  return { channel: "instagram", ok: r.ok, status: r.status };
}

async function postTikTok(text) {
  const endpoint = process.env.TIKTOK_POST_URL;
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!endpoint || !token) return { channel: "tiktok", skipped: true, reason: "missing credentials" };
  if (dryRun) return { channel: "tiktok", dryRun: true, preview: text.slice(0, 180) };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text }),
  });
  return { channel: "tiktok", ok: r.ok, status: r.status };
}

const handlers = {
  x: postX,
  telegram: postTelegram,
  discord: postDiscord,
  instagram: postInstagram,
  tiktok: postTikTok,
};

async function main() {
  const template = loadTemplate();
  const text = buildPostText(template);
  const results = [];

  for (const channel of channels) {
    const handler = handlers[channel];
    if (!handler) {
      results.push({ channel, skipped: true, reason: "unknown channel" });
      continue;
    }
    try {
      results.push(await handler(text));
    } catch (err) {
      results.push({ channel, ok: false, error: String(err?.message || err) });
    }
  }

  console.log(JSON.stringify({ dryRun, campaign, locale, channels, results }, null, 2));
}

await main();
