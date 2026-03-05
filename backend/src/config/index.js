import dotenv from "dotenv";
dotenv.config();

const deploymentNetwork = process.env.DEPLOYMENT_NETWORK || "localhost";
const isBscTestnet = deploymentNetwork === "bscTestnet";

export default {
  port: parseInt(process.env.PORT || "3001"),
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  deploymentNetwork,
  centralWallet: (process.env.CENTRAL_WALLET || "").toLowerCase(),
  enableScheduler: process.env.ENABLE_SCHEDULER
    ? String(process.env.ENABLE_SCHEDULER).toLowerCase() === "true"
    : !isBscTestnet,
  enableEventPolling: process.env.ENABLE_EVENT_POLLING
    ? String(process.env.ENABLE_EVENT_POLLING).toLowerCase() === "true"
    : true,
  eventPollIntervalMs: parseInt(process.env.EVENT_POLL_INTERVAL_MS || (isBscTestnet ? "15000" : "3000")),
  eventMaxBlockRange: parseInt(process.env.EVENT_MAX_BLOCK_RANGE || (isBscTestnet ? "20" : "250")),
  eventBackfillBlocks: parseInt(process.env.EVENT_BACKFILL_BLOCKS || (isBscTestnet ? "5000" : "0")),
  mongoUri: process.env.MONGODB_URI || "",
  aiProvider: process.env.AI_PROVIDER || "mock",
  openrouterKey: process.env.OPENROUTER_API_KEY || "",
  openrouterModel: process.env.OPENROUTER_MODEL || "google/gemma-3n-e4b-it",
  openrouterSearchModel: process.env.OPENROUTER_SEARCH_MODEL || "perplexity/sonar",
  openrouterResolveModel: process.env.OPENROUTER_RESOLVE_MODEL || "perplexity/sonar",
  openrouterFallback: process.env.OPENROUTER_FALLBACK_MODEL || "google/gemini-2.0-flash-001",
  deployerKey: process.env.DEPLOYER_PRIVATE_KEY || "",
  tgeStartAt: process.env.TGE_START_AT || "TBA",
  tgeAirdropPoolOai: parseFloat(process.env.TGE_AIRDROP_POOL_OAI || "400000000"),
  tgeForecastMinMultiplier: parseFloat(process.env.TGE_FORECAST_MIN_MULTIPLIER || "1.1"),
  tgeForecastBaseMultiplier: parseFloat(process.env.TGE_FORECAST_BASE_MULTIPLIER || "1.3"),
  tgeForecastMaxMultiplier: parseFloat(process.env.TGE_FORECAST_MAX_MULTIPLIER || "1.6"),
};
