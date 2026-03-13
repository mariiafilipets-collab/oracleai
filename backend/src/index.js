import "./bootstrap-logging.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import fs from "fs";
import path from "path";

import config from "./config/index.js";
import { initBlockchain, getContracts } from "./services/blockchain.service.js";
import { invalidateCache } from "./services/leaderboard.service.js";
import { initScheduler } from "./jobs/prediction-scheduler.js";

import predictionsRouter from "./routes/predictions.js";
import leaderboardRouter from "./routes/leaderboard.js";
import usersRouter from "./routes/users.js";
import statsRouter from "./routes/stats.js";
import aiRouter from "./routes/ai.js";
import questsRouter from "./routes/quests.js";

import User from "./models/User.js";
import CheckInRecord from "./models/CheckInRecord.js";
import PredictionEvent from "./models/PredictionEvent.js";
import EventSyncState from "./models/EventSyncState.js";

const app = express();
const server = createServer(app);

// --- CORS configuration ---
const allowedOrigins = config.corsOrigins
  ? config.corsOrigins.split(",").map((o) => o.trim()).filter(Boolean)
  : [];
const corsOptions = allowedOrigins.length > 0
  ? { origin: allowedOrigins, methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] }
  : { origin: true }; // dev: mirror request origin

const io = new Server(server, { cors: corsOptions });

// --- Security middleware ---
app.use(helmet({ contentSecurityPolicy: false })); // CSP managed by frontend
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

// --- Rate limiting ---
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,            // 120 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests, please try again later." },
});
app.use("/api/", apiLimiter);

// Stricter limit for admin and write endpoints
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many admin requests." },
});
app.use("/api/predictions/admin", adminLimiter);
app.use("/api/predictions/generate", adminLimiter);
app.use("/api/predictions/user/validate", rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many validation requests." },
}));

app.use("/api/predictions", predictionsRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/user", usersRouter);
app.use("/api/stats", statsRouter);
app.use("/api/ai", aiRouter);
app.use("/api/quests", questsRouter);

// --- Deep health check ---
app.get("/api/health", async (req, res) => {
  const checks = { status: "ok", timestamp: Date.now() };

  // MongoDB
  try {
    const mongoState = mongoose.connection.readyState;
    checks.mongodb = mongoState === 1 ? "connected" : `state:${mongoState}`;
    if (mongoState !== 1) checks.status = "degraded";
  } catch {
    checks.mongodb = "error";
    checks.status = "degraded";
  }

  // RPC / blockchain
  try {
    const contracts = getContracts();
    const provider = contracts.CheckIn?.runner?.provider;
    if (provider) {
      const blockNumber = await provider.getBlockNumber();
      checks.rpc = { connected: true, blockNumber };
    } else {
      checks.rpc = { connected: false };
      checks.status = "degraded";
    }
  } catch {
    checks.rpc = { connected: false };
    checks.status = "degraded";
  }

  res.json(checks);
});

io.on("connection", (socket) => {
  console.log("WS client connected:", socket.id);
  socket.on("disconnect", () => console.log("WS client disconnected:", socket.id));
});

process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled rejection:", reason?.message || reason);
});

process.on("uncaughtException", (err) => {
  console.error("[Process] Uncaught exception:", err?.message || err);
  if (err?.code === "EADDRINUSE") {
    // Prevent zombie schedulers if another backend instance already owns the port.
    process.exit(1);
  }
});

let mongodInstance = null;

async function connectMongo() {
  if (config.mongoUri) {
    await mongoose.connect(config.mongoUri);
    console.log(`MongoDB connected (${config.mongoUri})`);
    return;
  }

  const dbPath = path.join(process.cwd(), ".data", "mongodb");
  const persistentUri = "mongodb://127.0.0.1:27018/oai-local";

  try {
    // Persistent local instance survives backend restarts and keeps events stable.
    fs.mkdirSync(dbPath, { recursive: true });
    mongodInstance = await MongoMemoryServer.create({
      instance: { dbPath, port: 27018, dbName: "oai-local" },
    });
    await mongoose.connect(mongodInstance.getUri("oai-local"));
    console.log(`MongoDB connected (local persistent at ${dbPath})`);
    return;
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("DBPathInUse") || msg.includes("EADDRINUSE")) {
      try {
        await mongoose.connect(persistentUri);
        console.log(`MongoDB connected (reused persistent ${persistentUri})`);
        return;
      } catch (reuseErr) {
        console.warn("[Mongo] Persistent instance is locked but unreachable:", reuseErr?.message || reuseErr);
      }
    } else {
      console.warn("[Mongo] Persistent startup failed:", msg);
    }
  }

  // Last-resort fallback to keep backend alive in dev.
  mongodInstance = await MongoMemoryServer.create();
  await mongoose.connect(mongodInstance.getUri());
  console.log("MongoDB connected (in-memory fallback)");
}

let shuttingDown = false;
async function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await mongoose.disconnect();
  } catch {}
  try {
    if (mongodInstance) await mongodInstance.stop();
  } catch {}
}

process.on("SIGINT", () => {
  gracefulShutdown().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  gracefulShutdown().finally(() => process.exit(0));
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isRateLimitError = (err) => {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("-32005");
};
const isNetworkError = (err) => {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("failed to detect network") || msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("network") && msg.includes("cannot");
};
const isPrunedHistoryError = (err) => {
  if (isNetworkError(err)) return false;
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("history has been pruned") || msg.includes("code\": -32701") || msg.includes("pruned for this block");
};
const EVENT_CURSOR_KEY = "event-poller";

async function syncUsersFromOnChainSnapshot() {
  const { Points, CheckIn } = getContracts();
  if (!Points) {
    console.warn("[Sync] Points contract unavailable; skipping on-chain user sync.");
    return;
  }

  const users = await User.find({}).select("address").lean();
  if (!users.length) return;

  let updated = 0;
  for (const u of users) {
    const address = String(u.address || "").toLowerCase();
    if (!address) continue;
    try {
      const pts = await Points.getUserPoints(address);
      const totalPoints = Number(pts.points ?? pts[0] ?? 0);
      const weeklyPoints = Number(pts.weeklyPoints ?? pts[1] ?? 0);
      const streak = Number(pts.streak ?? pts[2] ?? 0);
      const totalCheckIns = Number(pts.totalCheckIns ?? pts[4] ?? 0);

      let tier = undefined;
      let lastCheckInAt = undefined;
      if (CheckIn) {
        try {
          const rec = await CheckIn.getRecord(address);
          tier = ["BASIC", "PRO", "WHALE"][Number(rec.lastTier ?? 0)] || "BASIC";
          const lastCheckInRaw = Number(rec.lastCheckIn ?? 0);
          if (lastCheckInRaw > 0) {
            lastCheckInAt = new Date(lastCheckInRaw * 1000);
          }
        } catch {}
      }

      const update = {
        totalPoints,
        weeklyPoints,
        streak,
        totalCheckIns,
      };
      if (tier) update.tier = tier;
      if (lastCheckInAt) update.lastCheckIn = lastCheckInAt;

      await User.findOneAndUpdate({ address }, { $set: update }, { upsert: true });
      updated += 1;
      // Small delay to avoid RPC bursts on shared public endpoints.
      await sleep(80);
    } catch (err) {
      console.warn(`[Sync] Failed to refresh user ${address}:`, err?.message || err);
    }
  }

  if (updated > 0) {
    invalidateCache();
    console.log(`[Sync] Refreshed ${updated} users from on-chain points snapshot.`);
  }
}

async function setupEventListeners() {
  if (!config.enableEventPolling) {
    console.log("[Events] Polling disabled by config.");
    return;
  }
  const contracts = getContracts();
  const checkIn = contracts.CheckIn;
  const referral = contracts.Referral;
  const prediction = contracts.Prediction;
  if (!checkIn) return;

  const provider = checkIn.runner?.provider;
  if (!provider) {
    console.warn("[Events] Provider not available; skipping event polling.");
    return;
  }

  const processRange = async (fromBlock, toBlock) => {
    if (toBlock < fromBlock) return;
    const checkInLogs = await checkIn.queryFilter(checkIn.filters.CheckedIn(), fromBlock, toBlock);
    for (const log of checkInLogs) {
      const txHash = log.transactionHash || "";
      if (txHash) {
        const alreadyIndexed = await CheckInRecord.exists({ txHash });
        if (alreadyIndexed) continue;
      }

      const args = log.args || [];
      const user = (args.user ?? args[0])?.toLowerCase?.();
      const amount = args.amount ?? args[1] ?? 0n;
      const tier = Number(args.tier ?? args[2] ?? 0);
      const points = Number(args.points ?? args[3] ?? 0);
      const streak = Number(args.streak ?? args[4] ?? 0);
      if (!user) continue;

      const tierName = ["BASIC", "PRO", "WHALE"][tier] || "BASIC";
      const bnbAmount = (Number(amount) / 1e18).toFixed(4);

      await User.findOneAndUpdate(
        { address: user },
        {
          $set: { streak, tier: tierName, lastCheckIn: new Date() },
          $inc: { totalPoints: points, weeklyPoints: points, totalCheckIns: 1 },
          $setOnInsert: { address: user, joinedAt: new Date() },
        },
        { upsert: true }
      );

      await CheckInRecord.create({
        address: user,
        amount: bnbAmount,
        tier: tierName,
        points,
        streak,
        txHash,
      });

      invalidateCache();
      io.emit("user:checkin", {
        address: user,
        amount: bnbAmount,
        tier: tierName,
        points,
        streak,
        timestamp: Date.now(),
      });

      // Whale alert — broadcast notable check-ins
      if (tierName === "WHALE") {
        io.emit("notification:whale", {
          type: "whale_checkin",
          message: `Whale check-in: ${user.slice(0, 6)}...${user.slice(-4)} deposited ${bnbAmount} BNB`,
          address: user,
          amount: bnbAmount,
          timestamp: Date.now(),
        });
      }
    }

    if (referral) {
      const refLogs = await referral.queryFilter(referral.filters.ReferralRegistered(), fromBlock, toBlock);
      for (const log of refLogs) {
        const args = log.args || [];
        const user = (args.user ?? args[0])?.toLowerCase?.();
        const referrer = (args.referrer ?? args[1])?.toLowerCase?.();
        if (!user || !referrer) continue;
        await User.findOneAndUpdate(
          { address: user },
          { $set: { referrer } },
          { upsert: true }
        );
      }
    }

    if (prediction) {
      const voteLogs = await prediction.queryFilter(prediction.filters.VoteSubmitted(), fromBlock, toBlock);
      for (const log of voteLogs) {
        const args = log.args || [];
        const eventId = Number(args.eventId ?? args[0] ?? 0);
        if (!Number.isFinite(eventId) || eventId <= 0) continue;
        try {
          // Keep vote counters in DB strictly aligned with chain state.
          const on = await prediction["getEvent(uint256)"](BigInt(eventId));
          if (!on || Number(on.id || 0n) === 0) continue;
          await PredictionEvent.updateOne(
            { eventId },
            {
              $set: {
                totalVotesYes: Number(on.totalVotesYes || 0n),
                totalVotesNo: Number(on.totalVotesNo || 0n),
                deadline: new Date(Number(on.deadline || 0n) * 1000),
                resolved: Boolean(on.resolved),
                outcome: Boolean(on.resolved) ? Boolean(on.outcome) : null,
                creator: String(on.creator || "").toLowerCase(),
                isUserEvent: Boolean(on.isUserEvent),
                listingFeeWei: String(on.listingFee || 0n),
                sourcePolicy: String(on.sourcePolicy || ""),
              },
              $setOnInsert: {
                title: String(on.title || `Event #${eventId}`),
                category: ["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"][Number(on.category || 3)] || "CRYPTO",
                aiProbability: Number(on.aiProbability || 50n),
              },
            },
            { upsert: true }
          );
          // Emit live vote event for real-time UI updates
          const voter = (args.user ?? args[1])?.toLowerCase?.();
          const userPrediction = args.prediction ?? args[2];
          io.emit("prediction:vote", {
            eventId,
            voter,
            prediction: Boolean(userPrediction),
            totalVotesYes: Number(on.totalVotesYes || 0n),
            totalVotesNo: Number(on.totalVotesNo || 0n),
            timestamp: Date.now(),
          });
        } catch (e) {
          console.warn(`[Events] Vote sync failed for event ${eventId}:`, e?.message || e);
        }
      }
    }
  };

  const saveCursor = async (blockNumber) => {
    await EventSyncState.updateOne(
      { key: EVENT_CURSOR_KEY },
      { $set: { lastProcessedBlock: Number(blockNumber), updatedAt: new Date() } },
      { upsert: true }
    );
  };

  const latestAtStartup = await provider.getBlockNumber();
  const storedCursorDoc = await EventSyncState.findOne({ key: EVENT_CURSOR_KEY }).lean();
  const backfillBlocks = Math.max(0, Number(config.eventBackfillBlocks || 0));
  let lastProcessedBlock = latestAtStartup;
  let catchUpInProgress = false;

  if (storedCursorDoc && Number.isFinite(Number(storedCursorDoc.lastProcessedBlock))) {
    lastProcessedBlock = Math.max(0, Math.min(latestAtStartup, Number(storedCursorDoc.lastProcessedBlock)));
    console.log(`[Events] Resuming from stored cursor block ${lastProcessedBlock}.`);
  } else {
    lastProcessedBlock = Math.max(0, latestAtStartup - backfillBlocks);
    await saveCursor(lastProcessedBlock);
    if (lastProcessedBlock < latestAtStartup) {
      console.log(`[Events] Initial backfill: scanning blocks ${lastProcessedBlock + 1}..${latestAtStartup}`);
    }
  }

  const runInitialCatchUp = async () => {
    if (latestAtStartup <= lastProcessedBlock) return;
    const gap = latestAtStartup - lastProcessedBlock;
    const maxGap = Math.max(0, Number(config.eventCatchupMaxGap || 0));
    if (maxGap > 0 && gap > maxGap) {
      console.warn(`[Events] Catch-up gap too large (${gap} blocks), resuming from latest ${latestAtStartup}`);
      lastProcessedBlock = latestAtStartup;
      await saveCursor(lastProcessedBlock);
      return;
    }
    catchUpInProgress = true;
    let prunedSkipCount = 0;
    let lastPrunedLogAt = 0;
    const PRUNED_LOG_INTERVAL_MS = 30_000;
    const PRUNED_LOG_EVERY_N = 50;
    try {
      const step = Math.max(1, Number(config.eventBackfillBlockRange || config.eventMaxBlockRange || 1));
      const backfillDelayMs = Math.max(0, Number(config.eventBackfillDelayMs || 0));
      const maxRetries = Math.max(0, Number(config.eventBackfillMaxRetries || 0));
      catchUp: for (let cursor = lastProcessedBlock + 1; cursor <= latestAtStartup; cursor += step) {
        const toBlock = Math.min(latestAtStartup, cursor + step - 1);
        let attempt = 0;
        while (true) {
          try {
            await processRange(cursor, toBlock);
            lastProcessedBlock = toBlock;
            await saveCursor(lastProcessedBlock);
            break;
          } catch (err) {
            if (isNetworkError(err)) {
              console.error("[Events] RPC unreachable; stopping catch-up.", err?.message || err);
              break catchUp;
            }
            if (isPrunedHistoryError(err)) {
              lastProcessedBlock = toBlock;
              await saveCursor(lastProcessedBlock);
              prunedSkipCount += 1;
              const now = Date.now();
              if (prunedSkipCount % PRUNED_LOG_EVERY_N === 0 || now - lastPrunedLogAt >= PRUNED_LOG_INTERVAL_MS) {
                console.warn(`[Events] Catch-up: skipped ${prunedSkipCount} pruned ranges (now at block ${toBlock})`);
                lastPrunedLogAt = now;
              }
              break;
            }
            if (!isRateLimitError(err) || attempt >= maxRetries) {
              console.error(`[Events] Catch-up range failed ${cursor}..${toBlock}:`, err?.message || err);
              break;
            }
            const waitMs = Math.min(30_000, backfillDelayMs * Math.max(1, 2 ** attempt));
            attempt += 1;
            console.warn(`[Events] Catch-up rate-limited ${cursor}..${toBlock}, retry ${attempt}/${maxRetries} in ${waitMs}ms`);
            await sleep(waitMs);
          }
        }
        if (backfillDelayMs > 0) await sleep(backfillDelayMs);
      }
      if (prunedSkipCount > 0) {
        console.log(`[Events] Catch-up finished: ${prunedSkipCount} pruned ranges skipped, cursor at ${lastProcessedBlock}`);
      }
    } finally {
      catchUpInProgress = false;
    }
  };

  const pollEvents = async () => {
    let fromBlock = null;
    let toBlock = null;
    try {
      if (catchUpInProgress) return;
      const latestBlock = await provider.getBlockNumber();
      if (latestBlock < lastProcessedBlock) {
        // Chain likely reset (Hardhat restart); restart cursor safely.
        lastProcessedBlock = latestBlock;
        await saveCursor(lastProcessedBlock);
        return;
      }
      if (latestBlock === lastProcessedBlock) return;

      fromBlock = lastProcessedBlock + 1;
      toBlock = Math.min(latestBlock, lastProcessedBlock + Math.max(1, config.eventMaxBlockRange));
      await processRange(fromBlock, toBlock);
      lastProcessedBlock = toBlock;
      await saveCursor(lastProcessedBlock);
    } catch (err) {
      if (isPrunedHistoryError(err) && Number.isFinite(toBlock)) {
        // Shared/public nodes can prune old log history.
        // Advance cursor so polling does not loop forever on the same pruned interval.
        lastProcessedBlock = toBlock;
        await saveCursor(lastProcessedBlock);
        console.warn(`[Events] Poll skipped pruned range ${fromBlock}..${toBlock}`);
        return;
      }
      console.error("[Events] Poll error:", err?.message || err);
    }
  };

  setInterval(pollEvents, Math.max(1000, config.eventPollIntervalMs));
  console.log(`Event listeners active (polling mode): interval=${config.eventPollIntervalMs}ms range=${config.eventMaxBlockRange} blocks`);
  // Run catch-up in background so scheduler startup is not blocked by slow RPC.
  void runInitialCatchUp();
}

async function start() {
  // Reserve port first; if it is busy, do not start DB/blockchain/scheduler side effects.
  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port);
  });
  console.log(`Backend running on http://localhost:${config.port}`);

  await connectMongo();

  await initBlockchain();
  // Start scheduler immediately after blockchain init so it isn't blocked by
  // potentially slow startup sync/backfill tasks.
  if (config.enableScheduler) {
    initScheduler(io);
  } else {
    console.log("[Scheduler] Disabled by config.");
  }

  await syncUsersFromOnChainSnapshot();
  await setupEventListeners();
}

start().catch((err) => {
  console.error("[Start] Fatal:", err?.message || err);
  process.exit(1);
});
