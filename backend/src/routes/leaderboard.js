import { Router } from "express";
import { getLeaderboard, getUserRank } from "../services/leaderboard.service.js";
import WeeklyPrizeEpoch from "../models/WeeklyPrizeEpoch.js";
import User from "../models/User.js";
import { getContracts } from "../services/blockchain.service.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 1000, 1000);
    const data = await getLeaderboard(limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/user/:address", async (req, res) => {
  try {
    const result = await getUserRank(req.params.address);
    if (!result) return res.status(404).json({ success: false, error: "User not found" });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/epoch/current", async (req, res) => {
  try {
    const epoch = await WeeklyPrizeEpoch.findOne().sort({ epoch: -1 }).lean();
    if (!epoch) return res.json({ success: true, data: null });
    res.json({
      success: true,
      data: {
        epoch: epoch.epoch,
        merkleRoot: epoch.merkleRoot,
        winnerCount: epoch.winnerCount,
        totalAllocation: epoch.totalAllocation,
        createdAt: epoch.createdAt,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/claim-proof/:address", async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const epoch = await WeeklyPrizeEpoch.findOne().sort({ epoch: -1 }).lean();
    if (!epoch) return res.json({ success: true, data: null });
    const winner = (epoch.winners || []).find((w) => w.address === address);
    if (!winner) return res.json({ success: true, data: null });

    let claimed = false;
    const { PrizePoolV2 } = getContracts();
    if (PrizePoolV2) {
      try {
        claimed = await PrizePoolV2.isClaimed(BigInt(epoch.epoch), BigInt(winner.index));
      } catch {}
    }

    res.json({
      success: true,
      data: {
        epoch: epoch.epoch,
        merkleRoot: epoch.merkleRoot,
        index: winner.index,
        address: winner.address,
        amount: winner.amount,
        rank: winner.rank,
        points: winner.points,
        proof: winner.proof || [],
        claimed,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Prediction accuracy ranking — top predictors by correct/total ratio
router.get("/accuracy", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const minPredictions = Math.max(parseInt(req.query.min) || 5, 1);

    const users = await User.find({
      totalPredictions: { $gte: minPredictions },
    })
      .select("address totalPoints correctPredictions totalPredictions streak tier")
      .sort({ correctPredictions: -1 })
      .limit(limit * 2) // fetch extra to filter/sort by accuracy
      .lean();

    const ranked = users
      .map((u) => ({
        address: u.address,
        correctPredictions: u.correctPredictions || 0,
        totalPredictions: u.totalPredictions || 0,
        accuracy: u.totalPredictions > 0
          ? Math.round(((u.correctPredictions || 0) / u.totalPredictions) * 10000) / 100
          : 0,
        totalPoints: u.totalPoints || 0,
        streak: u.streak || 0,
        tier: u.tier || "BASIC",
      }))
      .sort((a, b) => b.accuracy - a.accuracy || b.correctPredictions - a.correctPredictions)
      .slice(0, limit)
      .map((u, i) => ({ rank: i + 1, ...u }));

    res.json({ success: true, data: ranked });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
