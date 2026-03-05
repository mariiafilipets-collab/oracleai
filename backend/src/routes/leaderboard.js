import { Router } from "express";
import { getLeaderboard, getUserRank } from "../services/leaderboard.service.js";
import WeeklyPrizeEpoch from "../models/WeeklyPrizeEpoch.js";
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

export default router;
