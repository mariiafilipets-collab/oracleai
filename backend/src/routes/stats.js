import { Router } from "express";
import User from "../models/User.js";
import PredictionEvent from "../models/PredictionEvent.js";
import CheckInRecord from "../models/CheckInRecord.js";
import { getContracts } from "../services/blockchain.service.js";
import config from "../config/index.js";

const router = Router();

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
    const { PrizePool, CheckIn } = getContracts();
    if (PrizePool) {
      try {
        prizePoolBalance = (await PrizePool.getBalance()).toString();
      } catch {}
    }
    if (CheckIn) {
      try {
        totalFeesCollected = (await CheckIn.totalFeesCollected()).toString();
      } catch {}
    }

    res.json({
      success: true,
      data: {
        totalUsers,
        totalPredictions,
        totalCheckIns,
        prizePoolBalance,
        totalFeesCollected,
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
    const data = rows.map((r) => ({
      address: String(r.address || "").toLowerCase(),
      amount: String(r.amount || "0"),
      tier: String(r.tier || "BASIC"),
      points: Number(r.points || 0),
      streak: Number(r.streak || 0),
      timestamp: new Date(r.timestamp || Date.now()).getTime(),
    }));
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
