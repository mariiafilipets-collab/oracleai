import { Router } from "express";
import PredictionEvent from "../models/PredictionEvent.js";

const router = Router();

/**
 * AI Insights Marketplace — premium AI analysis endpoints.
 *
 * Free tier:  basic predictions list (already exists at /api/predictions)
 * Premium:    confidence-ranked insights, category deep-dives, accuracy stats
 *
 * Future: gated behind OAI token staking or one-time OAI burn.
 */

// GET /api/insights/top — Top confidence AI predictions
router.get("/top", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const minConfidence = parseFloat(req.query.minConfidence) || 0.7;

    const events = await PredictionEvent.find({
      resolved: false,
      creator: "AI",
      confidence: { $gte: minConfidence },
      deadline: { $gt: new Date() },
    })
      .sort({ confidence: -1, popularityScore: -1 })
      .limit(limit)
      .select("eventId title description category aiProbability confidence popularityScore deadline sources totalVotesYes totalVotesNo createdAt")
      .lean();

    const insights = events.map((e) => ({
      ...e,
      communityAgreement: _communityAgreement(e),
      edgeScore: _edgeScore(e),
    }));

    res.json({ success: true, data: insights });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch insights" });
  }
});

// GET /api/insights/category/:category — Deep dive by category
router.get("/category/:category", async (req, res) => {
  try {
    const category = req.params.category.toUpperCase();
    const validCategories = ["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ success: false, error: "Invalid category" });
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const includeResolved = req.query.includeResolved === "true";

    const filter = {
      category,
      creator: "AI",
      ...(includeResolved ? {} : { resolved: false, deadline: { $gt: new Date() } }),
    };

    const events = await PredictionEvent.find(filter)
      .sort({ confidence: -1, createdAt: -1 })
      .limit(limit)
      .select("eventId title description aiProbability confidence popularityScore deadline resolved outcome totalVotesYes totalVotesNo sources createdAt")
      .lean();

    // Category stats
    const totalInCategory = await PredictionEvent.countDocuments({ category, creator: "AI" });
    const resolvedInCategory = await PredictionEvent.countDocuments({ category, creator: "AI", resolved: true });
    const correctInCategory = await PredictionEvent.countDocuments({
      category,
      creator: "AI",
      resolved: true,
      $expr: {
        $eq: [
          { $gte: ["$aiProbability", 50] },
          "$outcome",
        ],
      },
    });

    const accuracy = resolvedInCategory > 0
      ? ((correctInCategory / resolvedInCategory) * 100).toFixed(1)
      : null;

    res.json({
      success: true,
      data: {
        category,
        events,
        stats: {
          total: totalInCategory,
          resolved: resolvedInCategory,
          correct: correctInCategory,
          accuracy: accuracy ? parseFloat(accuracy) : null,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch category insights" });
  }
});

// GET /api/insights/accuracy — AI model accuracy breakdown
router.get("/accuracy", async (req, res) => {
  try {
    const categories = ["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"];
    const results = [];

    for (const cat of categories) {
      const resolved = await PredictionEvent.countDocuments({ category: cat, creator: "AI", resolved: true });
      if (resolved === 0) {
        results.push({ category: cat, resolved: 0, correct: 0, accuracy: null });
        continue;
      }

      // AI was right if (aiProbability >= 50 && outcome == true) || (aiProbability < 50 && outcome == false)
      const correct = await PredictionEvent.countDocuments({
        category: cat,
        creator: "AI",
        resolved: true,
        $or: [
          { aiProbability: { $gte: 50 }, outcome: true },
          { aiProbability: { $lt: 50 }, outcome: false },
        ],
      });

      results.push({
        category: cat,
        resolved,
        correct,
        accuracy: parseFloat(((correct / resolved) * 100).toFixed(1)),
      });
    }

    const totalResolved = results.reduce((s, r) => s + r.resolved, 0);
    const totalCorrect = results.reduce((s, r) => s + r.correct, 0);

    res.json({
      success: true,
      data: {
        overall: {
          resolved: totalResolved,
          correct: totalCorrect,
          accuracy: totalResolved > 0 ? parseFloat(((totalCorrect / totalResolved) * 100).toFixed(1)) : null,
        },
        byCategory: results,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to compute accuracy" });
  }
});

// GET /api/insights/trending — Highest community engagement
router.get("/trending", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const events = await PredictionEvent.find({
      resolved: false,
      deadline: { $gt: new Date() },
    })
      .sort({ totalVotesYes: -1, totalVotesNo: -1, popularityScore: -1 })
      .limit(limit)
      .select("eventId title category aiProbability confidence popularityScore deadline totalVotesYes totalVotesNo creator isUserEvent createdAt")
      .lean();

    const trending = events.map((e) => ({
      ...e,
      totalVotes: (e.totalVotesYes || 0) + (e.totalVotesNo || 0),
      communityAgreement: _communityAgreement(e),
      sentiment: _sentiment(e),
    }));

    res.json({ success: true, data: trending });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch trending" });
  }
});

// GET /api/insights/contrarian — Events where AI and community disagree
router.get("/contrarian", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const minVotes = parseInt(req.query.minVotes) || 5;

    const events = await PredictionEvent.find({
      resolved: false,
      deadline: { $gt: new Date() },
      $expr: {
        $gte: [{ $add: ["$totalVotesYes", "$totalVotesNo"] }, minVotes],
      },
    })
      .select("eventId title category aiProbability confidence popularityScore deadline totalVotesYes totalVotesNo createdAt")
      .lean();

    // Filter for disagreement: AI says >60% YES but community says mostly NO (or vice versa)
    const contrarian = events
      .map((e) => {
        const totalVotes = (e.totalVotesYes || 0) + (e.totalVotesNo || 0);
        if (totalVotes === 0) return null;
        const communityYesPct = ((e.totalVotesYes || 0) / totalVotes) * 100;
        const aiYesPct = e.aiProbability || 50;
        const disagreement = Math.abs(aiYesPct - communityYesPct);
        return { ...e, totalVotes, communityYesPct, disagreement };
      })
      .filter((e) => e && e.disagreement >= 20)
      .sort((a, b) => b.disagreement - a.disagreement)
      .slice(0, limit);

    res.json({ success: true, data: contrarian });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch contrarian insights" });
  }
});

// ─── Helpers ────────────────────────────────────────────────

function _communityAgreement(e) {
  const total = (e.totalVotesYes || 0) + (e.totalVotesNo || 0);
  if (total === 0) return null;
  const yesPct = ((e.totalVotesYes || 0) / total) * 100;
  const aiYes = (e.aiProbability || 50) >= 50;
  const communityYes = yesPct >= 50;
  return aiYes === communityYes ? "agree" : "disagree";
}

function _edgeScore(e) {
  // Higher when confidence is high and community hasn't converged yet
  const total = (e.totalVotesYes || 0) + (e.totalVotesNo || 0);
  const confidence = e.confidence || 0.5;
  const freshness = total < 5 ? 1.0 : total < 20 ? 0.7 : 0.3;
  return parseFloat((confidence * freshness * 100).toFixed(1));
}

function _sentiment(e) {
  const total = (e.totalVotesYes || 0) + (e.totalVotesNo || 0);
  if (total === 0) return "neutral";
  const yesPct = (e.totalVotesYes || 0) / total;
  if (yesPct > 0.7) return "bullish";
  if (yesPct < 0.3) return "bearish";
  return "split";
}

export default router;
