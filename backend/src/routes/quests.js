import { Router } from "express";
import Quest from "../models/Quest.js";
import QuestProgress from "../models/QuestProgress.js";
import User from "../models/User.js";

const router = Router();
const ADDRESS_RE = /^0x[a-f0-9]{40}$/i;

function getDayKey() {
  return new Date().toISOString().slice(0, 10); // "2026-03-13"
}

function getWeekKey() {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function getPeriodKey(category) {
  if (category === "daily") return getDayKey();
  if (category === "weekly") return getWeekKey();
  return "once";
}

// Seed default quests if none exist
async function ensureDefaultQuests() {
  const count = await Quest.countDocuments();
  if (count > 0) return;

  const defaults = [
    { questId: "daily-checkin", title: "Daily Check-in", description: "Check in today to earn bonus points", category: "daily", action: "checkin", target: 1, rewardPoints: 50, rewardLabel: "+50 points" },
    { questId: "daily-vote-3", title: "Cast 3 Votes", description: "Vote on 3 different predictions today", category: "daily", action: "vote", target: 3, rewardPoints: 200, rewardLabel: "+200 points" },
    { questId: "daily-share", title: "Share a Prediction", description: "Share any prediction on social media", category: "daily", action: "share", target: 1, rewardPoints: 100, rewardLabel: "+100 points" },
    { questId: "weekly-streak-5", title: "5-Day Streak", description: "Maintain a 5-day check-in streak this week", category: "weekly", action: "streak", target: 5, rewardPoints: 500, rewardLabel: "+500 points" },
    { questId: "weekly-vote-10", title: "Cast 10 Votes", description: "Vote on 10 predictions this week", category: "weekly", action: "vote", target: 10, rewardPoints: 800, rewardLabel: "+800 points" },
    { questId: "weekly-accuracy-70", title: "70% Accuracy", description: "Achieve 70%+ prediction accuracy this week", category: "weekly", action: "accuracy", target: 70, rewardPoints: 1000, rewardLabel: "+1000 points" },
    { questId: "once-first-referral", title: "First Referral", description: "Refer your first friend to OracleAI", category: "onetime", action: "referral", target: 1, rewardPoints: 300, rewardLabel: "+300 points" },
    { questId: "once-streak-7", title: "Perfect Week", description: "Achieve a 7-day check-in streak", category: "onetime", action: "streak", target: 7, rewardPoints: 1500, rewardLabel: "+1500 points" },
  ];

  await Quest.insertMany(defaults);
  console.log(`[Quests] Seeded ${defaults.length} default quests.`);
}

// Get all active quests with user progress
router.get("/:address", async (req, res) => {
  try {
    const address = String(req.params.address).toLowerCase();
    if (!ADDRESS_RE.test(address)) {
      return res.status(400).json({ success: false, error: "Invalid address" });
    }

    await ensureDefaultQuests();

    const now = new Date();
    const quests = await Quest.find({
      active: true,
      $or: [
        { startsAt: null },
        { startsAt: { $lte: now } },
      ],
    }).lean();

    // Get user data for progress calculation
    const user = await User.findOne({ address }).lean();
    const dayKey = getDayKey();
    const weekKey = getWeekKey();

    // Get existing progress records
    const progressDocs = await QuestProgress.find({
      address,
      questId: { $in: quests.map((q) => q.questId) },
      periodKey: { $in: [dayKey, weekKey, "once"] },
    }).lean();
    const progressMap = new Map(progressDocs.map((p) => [`${p.questId}:${p.periodKey}`, p]));

    const result = quests
      .filter((q) => !q.expiresAt || q.expiresAt > now)
      .map((q) => {
        const periodKey = getPeriodKey(q.category);
        const prog = progressMap.get(`${q.questId}:${periodKey}`);

        // Calculate current progress from user data
        let currentProgress = prog?.progress || 0;
        if (!prog?.completed && user) {
          if (q.action === "streak") currentProgress = user.streak || 0;
          if (q.action === "checkin" && q.category === "daily") {
            const lastCheckIn = user.lastCheckIn ? new Date(user.lastCheckIn) : null;
            currentProgress = lastCheckIn && lastCheckIn.toISOString().slice(0, 10) === dayKey ? 1 : 0;
          }
          if (q.action === "accuracy" && user.totalPredictions > 0) {
            currentProgress = Math.round((user.correctPredictions / user.totalPredictions) * 100);
          }
          if (q.action === "referral") {
            const refCount = await User.countDocuments({ referrer: address });
            currentProgress = refCount;
          }
        }

        return {
          questId: q.questId,
          title: q.title,
          description: q.description,
          category: q.category,
          action: q.action,
          target: q.target,
          rewardPoints: q.rewardPoints,
          rewardLabel: q.rewardLabel,
          progress: Math.min(currentProgress, q.target),
          completed: prog?.completed || currentProgress >= q.target,
          claimed: prog?.claimed || false,
          completedAt: prog?.completedAt || null,
        };
      });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update quest progress (called by backend events or frontend actions)
router.post("/:address/progress", async (req, res) => {
  try {
    const address = String(req.params.address).toLowerCase();
    if (!ADDRESS_RE.test(address)) {
      return res.status(400).json({ success: false, error: "Invalid address" });
    }

    const { questId, increment } = req.body;
    if (!questId) {
      return res.status(400).json({ success: false, error: "questId required" });
    }

    const quest = await Quest.findOne({ questId, active: true });
    if (!quest) {
      return res.status(404).json({ success: false, error: "Quest not found" });
    }

    const periodKey = getPeriodKey(quest.category);
    const inc = Math.max(0, Number(increment || 1));

    const prog = await QuestProgress.findOneAndUpdate(
      { address, questId, periodKey },
      {
        $inc: { progress: inc },
        $setOnInsert: { address, questId, periodKey },
      },
      { upsert: true, new: true }
    );

    // Check completion
    if (!prog.completed && prog.progress >= quest.target) {
      prog.completed = true;
      prog.completedAt = new Date();
      await prog.save();
    }

    res.json({
      success: true,
      data: {
        questId,
        progress: prog.progress,
        target: quest.target,
        completed: prog.completed,
        claimed: prog.claimed,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Claim quest reward
router.post("/:address/claim", async (req, res) => {
  try {
    const address = String(req.params.address).toLowerCase();
    if (!ADDRESS_RE.test(address)) {
      return res.status(400).json({ success: false, error: "Invalid address" });
    }

    const { questId } = req.body;
    if (!questId) {
      return res.status(400).json({ success: false, error: "questId required" });
    }

    const quest = await Quest.findOne({ questId });
    if (!quest) {
      return res.status(404).json({ success: false, error: "Quest not found" });
    }

    const periodKey = getPeriodKey(quest.category);
    const prog = await QuestProgress.findOne({ address, questId, periodKey });

    if (!prog?.completed) {
      return res.status(400).json({ success: false, error: "Quest not completed" });
    }
    if (prog.claimed) {
      return res.status(400).json({ success: false, error: "Already claimed" });
    }

    prog.claimed = true;
    await prog.save();

    // Award bonus points in DB (on-chain points come from contract)
    if (quest.rewardPoints > 0) {
      await User.findOneAndUpdate(
        { address },
        { $inc: { totalPoints: quest.rewardPoints, weeklyPoints: quest.rewardPoints } },
        { upsert: true }
      );
    }

    res.json({
      success: true,
      data: {
        questId,
        rewardPoints: quest.rewardPoints,
        claimed: true,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
