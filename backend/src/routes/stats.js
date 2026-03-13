import { Router } from "express";
import { ethers } from "ethers";
import User from "../models/User.js";
import PredictionEvent from "../models/PredictionEvent.js";
import CheckInRecord from "../models/CheckInRecord.js";
import { getContracts } from "../services/blockchain.service.js";
import config from "../config/index.js";

const router = Router();
const TIER_ACTIVITY_DEFAULTS = {
  BASIC: { amount: "0.0015", points: 100 },
  PRO: { amount: "0.01", points: 300 },
  WHALE: { amount: "0.05", points: 1000 },
};
const BPS_DENOMINATOR = 10000n;
const VOTE_FEE_SPLIT_BPS = {
  prizes: 5000n,
  treasury: 1500n,
  referrals: 2000n,
  burn: 1000n,
  stakers: 500n,
};
const CHAIN_READ_TIMEOUT_MS = 8000;

async function withTimeout(promise, timeoutMs = CHAIN_READ_TIMEOUT_MS) {
  return await Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("chain-read-timeout")), timeoutMs)),
  ]);
}

async function readPredictionValueNoArgs(prediction, fragment, methodName, fallback) {
  try {
    if (typeof prediction?.[methodName] === "function") {
      return await prediction[methodName]();
    }
  } catch {}
  try {
    const provider = prediction?.runner?.provider;
    const to = prediction?.target || prediction?.address;
    if (!provider || !to) return fallback;
    const iface = new ethers.Interface([fragment]);
    const data = iface.encodeFunctionData(methodName, []);
    const raw = await provider.call({ to, data });
    const decoded = iface.decodeFunctionResult(methodName, raw);
    return decoded?.[0] ?? fallback;
  } catch {
    return fallback;
  }
}

router.get("/", async (req, res) => {
  try {
    const [totalUsers, totalPredictions, totalCheckInsRecords] = await Promise.all([
      User.countDocuments(),
      PredictionEvent.countDocuments(),
      CheckInRecord.countDocuments(),
    ]);

    let totalCheckIns = totalCheckInsRecords;
    if (totalCheckIns === 0) {
      // Fallback for cases when event log indexing lags but on-chain user points are already synced.
      const agg = await User.aggregate([{ $group: { _id: null, total: { $sum: "$totalCheckIns" } } }]);
      totalCheckIns = Number(agg?.[0]?.total || 0);
    }

    let prizePoolBalance = "0";
    let totalFeesCollected = "0";
    let totalVoteFeesCollected = "0";
    const { PrizePool, CheckIn, Prediction } = getContracts();
    if (PrizePool) {
      try {
        prizePoolBalance = (await withTimeout(PrizePool.getBalance())).toString();
      } catch {}
    }
    if (CheckIn) {
      try {
        totalFeesCollected = (await withTimeout(CheckIn.totalFeesCollected())).toString();
      } catch {}
    }
    if (Prediction) {
      try {
        const voteFeesRaw = await withTimeout(
          readPredictionValueNoArgs(
            Prediction,
            "function totalVoteFeesCollected() view returns (uint256)",
            "totalVoteFeesCollected",
            0n
          )
        );
        totalVoteFeesCollected = String(voteFeesRaw || 0n);
      } catch {}
    }

    const totalVoteFeesWei = BigInt(String(totalVoteFeesCollected || "0"));
    const voteFeesBreakdownWei = {
      prizes: (totalVoteFeesWei * VOTE_FEE_SPLIT_BPS.prizes) / BPS_DENOMINATOR,
      treasury: (totalVoteFeesWei * VOTE_FEE_SPLIT_BPS.treasury) / BPS_DENOMINATOR,
      referrals: (totalVoteFeesWei * VOTE_FEE_SPLIT_BPS.referrals) / BPS_DENOMINATOR,
      burn: (totalVoteFeesWei * VOTE_FEE_SPLIT_BPS.burn) / BPS_DENOMINATOR,
      stakers:
        totalVoteFeesWei
        - ((totalVoteFeesWei * VOTE_FEE_SPLIT_BPS.prizes) / BPS_DENOMINATOR)
        - ((totalVoteFeesWei * VOTE_FEE_SPLIT_BPS.treasury) / BPS_DENOMINATOR)
        - ((totalVoteFeesWei * VOTE_FEE_SPLIT_BPS.referrals) / BPS_DENOMINATOR)
        - ((totalVoteFeesWei * VOTE_FEE_SPLIT_BPS.burn) / BPS_DENOMINATOR),
    };

    res.json({
      success: true,
      data: {
        totalUsers,
        totalPredictions,
        totalCheckIns,
        prizePoolBalance,
        totalFeesCollected,
        totalVoteFeesCollected,
        totalVoteFeesDistributed: totalVoteFeesCollected,
        voteFeeSplitBps: {
          prizes: Number(VOTE_FEE_SPLIT_BPS.prizes),
          treasury: Number(VOTE_FEE_SPLIT_BPS.treasury),
          referrals: Number(VOTE_FEE_SPLIT_BPS.referrals),
          burn: Number(VOTE_FEE_SPLIT_BPS.burn),
          stakers: Number(VOTE_FEE_SPLIT_BPS.stakers),
        },
        voteFeesBreakdownWei: {
          prizes: voteFeesBreakdownWei.prizes.toString(),
          treasury: voteFeesBreakdownWei.treasury.toString(),
          referrals: voteFeesBreakdownWei.referrals.toString(),
          burn: voteFeesBreakdownWei.burn.toString(),
          stakers: voteFeesBreakdownWei.stakers.toString(),
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/contracts", async (req, res) => {
  try {
    const { getAddresses } = await import("../services/blockchain.service.js");
    const addresses = getAddresses();
    res.json({ success: true, data: addresses });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/activity", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1), 200);
    const rows = await CheckInRecord.find()
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    // Preferred source: indexed check-in logs.
    let data = rows.map((r) => ({
      address: String(r.address || "").toLowerCase(),
      amount: String(r.amount || "0"),
      tier: String(r.tier || "BASIC"),
      points: Number(r.points || 0),
      streak: Number(r.streak || 0),
      timestamp: new Date(r.timestamp || Date.now()).getTime(),
    }));

    if (data.length < limit) {
      // Fallback source: user snapshots synchronized from on-chain state.
      let users = await User.find({
        totalCheckIns: { $gt: 0 },
        lastCheckIn: { $ne: null },
      })
        .sort({ lastCheckIn: -1 })
        .limit(limit)
        .lean();

      let seedUsers = [];
      if (users.length === 0) {
        // If `lastCheckIn` is still missing in DB, lazily hydrate a small set from on-chain.
        seedUsers = await User.find({ totalCheckIns: { $gt: 0 } })
          .select("address totalCheckIns streak tier joinedAt")
          .sort({ totalCheckIns: -1 })
          .limit(Math.min(limit, 50))
          .lean();
        const { CheckIn } = getContracts();
        if (CheckIn) {
          for (const u of seedUsers) {
            try {
              const rec = await withTimeout(CheckIn.getRecord(u.address), 5000);
              const lastCheckInRaw = Number(rec.lastCheckIn ?? 0);
              if (lastCheckInRaw <= 0) continue;
              const tier = ["BASIC", "PRO", "WHALE"][Number(rec.lastTier ?? 0)] || (u.tier || "BASIC");
              await User.updateOne(
                { address: u.address },
                {
                  $set: {
                    lastCheckIn: new Date(lastCheckInRaw * 1000),
                    tier,
                  },
                }
              );
            } catch {}
          }
          users = await User.find({
            totalCheckIns: { $gt: 0 },
            lastCheckIn: { $ne: null },
          })
            .sort({ lastCheckIn: -1 })
            .limit(limit)
            .lean();
        }
      }

      const fallbackUsers = users.length > 0 ? users : seedUsers;
      const fallbackData = fallbackUsers.map((u) => {
        const tier = String(u.tier || "BASIC");
        const defaults = TIER_ACTIVITY_DEFAULTS[tier] || TIER_ACTIVITY_DEFAULTS.BASIC;
        const timestamp = u.lastCheckIn || u.joinedAt || Date.now();
        return {
          address: String(u.address || "").toLowerCase(),
          amount: defaults.amount,
          tier,
          points: defaults.points,
          streak: Number(u.streak || 0),
          timestamp: new Date(timestamp).getTime(),
        };
      });

      if (data.length === 0) {
        data = fallbackData.slice(0, limit);
      } else {
        // Partial indexing case: keep real log entries first, then fill gaps from snapshots.
        const seenAddresses = new Set(data.map((x) => x.address));
        for (const item of fallbackData) {
          if (data.length >= limit) break;
          if (seenAddresses.has(item.address)) continue;
          data.push(item);
          seenAddresses.add(item.address);
        }
      }
    }

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/tge-forecast", async (req, res) => {
  try {
    const { Points } = getContracts();
    let totalPointsIssued = 0;
    if (Points) {
      try {
        totalPointsIssued = Number((await Points.totalPointsIssued()).toString());
      } catch {}
    }

    const minPts = Math.max(1, Math.floor(totalPointsIssued * config.tgeForecastMinMultiplier));
    const basePts = Math.max(1, Math.floor(totalPointsIssued * config.tgeForecastBaseMultiplier));
    const maxPts = Math.max(1, Math.floor(totalPointsIssued * config.tgeForecastMaxMultiplier));

    const pool = config.tgeAirdropPoolOai;
    const toRate = (pts) => pool / pts;

    res.json({
      success: true,
      data: {
        snapshotAt: config.tgeStartAt,
        airdropPoolOai: pool,
        totalPointsIssued,
        scenarios: {
          min: { totalPoints: minPts, oaiPerPoint: toRate(minPts) },
          base: { totalPoints: basePts, oaiPerPoint: toRate(basePts) },
          max: { totalPoints: maxPts, oaiPerPoint: toRate(maxPts) },
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
