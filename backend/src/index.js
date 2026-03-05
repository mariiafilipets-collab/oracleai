import express from "express";
import cors from "cors";
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

import User from "./models/User.js";
import CheckInRecord from "./models/CheckInRecord.js";

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(cors());
app.use(express.json());

app.use("/api/predictions", predictionsRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/user", usersRouter);
app.use("/api/stats", statsRouter);
app.use("/api/ai", aiRouter);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
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
      if (CheckIn) {
        try {
          const rec = await CheckIn.getRecord(address);
          tier = ["BASIC", "PRO", "WHALE"][Number(rec.lastTier ?? 0)] || "BASIC";
        } catch {}
      }

      const update = {
        totalPoints,
        weeklyPoints,
        streak,
        totalCheckIns,
      };
      if (tier) update.tier = tier;

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
  };

  let lastProcessedBlock = await provider.getBlockNumber();
  const backfillBlocks = Math.max(0, Number(config.eventBackfillBlocks || 0));
  if (backfillBlocks > 0) {
    const fromBlock = Math.max(0, lastProcessedBlock - backfillBlocks);
    console.log(`[Events] Backfill enabled: scanning blocks ${fromBlock}..${lastProcessedBlock}`);
    const step = Math.max(1, Number(config.eventBackfillBlockRange || config.eventMaxBlockRange || 1));
    const backfillDelayMs = Math.max(0, Number(config.eventBackfillDelayMs || 0));
    const maxRetries = Math.max(0, Number(config.eventBackfillMaxRetries || 0));
    for (let cursor = fromBlock; cursor <= lastProcessedBlock; cursor += step) {
      const toBlock = Math.min(lastProcessedBlock, cursor + step - 1);
      let attempt = 0;
      while (true) {
        try {
          await processRange(cursor, toBlock);
          break;
        } catch (err) {
          if (!isRateLimitError(err) || attempt >= maxRetries) {
            console.error(`[Events] Backfill range failed ${cursor}..${toBlock}:`, err?.message || err);
            break;
          }
          const waitMs = Math.min(30_000, backfillDelayMs * Math.max(1, 2 ** attempt));
          attempt += 1;
          console.warn(`[Events] Backfill rate-limited ${cursor}..${toBlock}, retry ${attempt}/${maxRetries} in ${waitMs}ms`);
          await sleep(waitMs);
        }
      }
      if (backfillDelayMs > 0) await sleep(backfillDelayMs);
    }
    console.log("[Events] Backfill completed.");
  }

  const pollEvents = async () => {
    try {
      const latestBlock = await provider.getBlockNumber();
      if (latestBlock < lastProcessedBlock) {
        // Chain likely reset (Hardhat restart); restart cursor safely.
        lastProcessedBlock = latestBlock;
        return;
      }
      if (latestBlock === lastProcessedBlock) return;

      const fromBlock = lastProcessedBlock + 1;
      const toBlock = Math.min(latestBlock, lastProcessedBlock + Math.max(1, config.eventMaxBlockRange));
      await processRange(fromBlock, toBlock);
      lastProcessedBlock = toBlock;
    } catch (err) {
      console.error("[Events] Poll error:", err?.message || err);
    }
  };

  setInterval(pollEvents, Math.max(1000, config.eventPollIntervalMs));
  console.log(`Event listeners active (polling mode): interval=${config.eventPollIntervalMs}ms range=${config.eventMaxBlockRange} blocks`);
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
  await syncUsersFromOnChainSnapshot();
  await setupEventListeners();

  // Auto-scheduler: generates predictions + resolves expired ones automatically
  if (config.enableScheduler) {
    initScheduler(io);
  } else {
    console.log("[Scheduler] Disabled by config.");
  }
}

start().catch((err) => {
  console.error("[Start] Fatal:", err?.message || err);
  process.exit(1);
});
