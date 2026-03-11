import dotenv from "dotenv";
dotenv.config();

const deploymentNetwork = process.env.DEPLOYMENT_NETWORK || "localhost";
const isBscTestnet = deploymentNetwork === "bscTestnet";
const boolFromEnv = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
};

export default {
  port: parseInt(process.env.PORT || "3001"),
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  deploymentNetwork,
  centralWallet: (process.env.CENTRAL_WALLET || "").toLowerCase(),
  enableScheduler: boolFromEnv(process.env.ENABLE_SCHEDULER, !isBscTestnet),
  enableEventPolling: boolFromEnv(process.env.ENABLE_EVENT_POLLING, true),
  eventPollIntervalMs: parseInt(process.env.EVENT_POLL_INTERVAL_MS || (isBscTestnet ? "15000" : "3000")),
  eventMaxBlockRange: parseInt(process.env.EVENT_MAX_BLOCK_RANGE || (isBscTestnet ? "20" : "250")),
  eventBackfillBlocks: parseInt(process.env.EVENT_BACKFILL_BLOCKS || (isBscTestnet ? "5000" : "0")),
  eventBackfillBlockRange: parseInt(process.env.EVENT_BACKFILL_BLOCK_RANGE || (isBscTestnet ? "100" : "500")),
  eventBackfillDelayMs: parseInt(process.env.EVENT_BACKFILL_DELAY_MS || (isBscTestnet ? "250" : "50")),
  eventBackfillMaxRetries: parseInt(process.env.EVENT_BACKFILL_MAX_RETRIES || "6"),
  mongoUri: process.env.MONGODB_URI || "",
  aiProvider: process.env.AI_PROVIDER || "mock",
  openrouterKey: process.env.OPENROUTER_API_KEY || "",
  openrouterModel: process.env.OPENROUTER_MODEL || "google/gemma-3n-e4b-it",
  openrouterRetrieverModel: process.env.OPENROUTER_RETRIEVER_MODEL || "",
  openrouterNormalizerModel: process.env.OPENROUTER_NORMALIZER_MODEL || "",
  openrouterArbiterModel: process.env.OPENROUTER_ARBITER_MODEL || "",
  openrouterSearchModel: process.env.OPENROUTER_SEARCH_MODEL || "x-ai/grok-4.1-fast",
  openrouterResolveModel: process.env.OPENROUTER_RESOLVE_MODEL || "x-ai/grok-4.1-fast",
  openrouterFallback: process.env.OPENROUTER_FALLBACK_MODEL || "google/gemini-2.0-flash-001",
  deployerKey: process.env.DEPLOYER_PRIVATE_KEY || "",
  oldPredictionAddress: (process.env.OLD_PREDICTION_ADDRESS || "0x7a6210BD2a3C1233209dC4a2b53BcA267CDE5532").toLowerCase(),
  betterstackSourceToken: process.env.BETTERSTACK_SOURCE_TOKEN || "",
  betterstackIngestUrl: process.env.BETTERSTACK_INGEST_URL || "https://in.logs.betterstack.com",
  tgeStartAt: process.env.TGE_START_AT || "TBA",
  tgeAirdropPoolOai: parseFloat(process.env.TGE_AIRDROP_POOL_OAI || "400000000"),
  tgeForecastMinMultiplier: parseFloat(process.env.TGE_FORECAST_MIN_MULTIPLIER || "1.1"),
  tgeForecastBaseMultiplier: parseFloat(process.env.TGE_FORECAST_BASE_MULTIPLIER || "1.3"),
  tgeForecastMaxMultiplier: parseFloat(process.env.TGE_FORECAST_MAX_MULTIPLIER || "1.6"),
};
