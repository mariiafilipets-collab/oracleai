#!/usr/bin/env node

const campaign = process.env.SOCIAL_CAMPAIGN || "oracleai-weekly";
const tone = process.env.SOCIAL_TONE || "bold";
const locales = (process.env.SOCIAL_LOCALES || "en,ru,es,fr,zh,ar")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const prompt = `
Create social creative prompts for campaign "${campaign}".
Tone: ${tone}.
Return JSON:
{
  "x": {"copy":"", "imagePrompt":""},
  "telegram": {"copy":"", "imagePrompt":""},
  "discord": {"copy":"", "imagePrompt":""},
  "instagram": {"copy":"", "imagePrompt":""},
  "tiktok": {"copy":"", "imagePrompt":""}
}
Constraints:
- Clear CTA to join OracleAI Predict.
- Avoid financial promises.
- Keep copy channel-native and concise.
- Provide locale variants for: ${locales.join(", ")}.
`;

console.log(prompt.trim());
