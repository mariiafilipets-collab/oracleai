import User from "../models/User.js";

const leaderboardCache = { data: [], updatedAt: 0 };
const CACHE_TTL = 10_000;

export async function getLeaderboard(limit = 1000) {
  if (Date.now() - leaderboardCache.updatedAt < CACHE_TTL && leaderboardCache.data.length > 0) {
    return leaderboardCache.data.slice(0, limit);
  }

  const users = await User.find({ totalPoints: { $gt: 0 } })
    .sort({ weeklyPoints: -1 })
    .limit(limit)
    .lean();

  const result = users.map((u, i) => ({
    rank: i + 1,
    address: u.address,
    points: u.weeklyPoints,
    totalPoints: u.totalPoints,
    streak: u.streak,
    tier: u.tier,
    checkIns: u.totalCheckIns,
  }));

  leaderboardCache.data = result;
  leaderboardCache.updatedAt = Date.now();
  return result;
}

export async function getUserRank(address) {
  const user = await User.findOne({ address: address.toLowerCase() });
  if (!user) return null;

  const rank = await User.countDocuments({ weeklyPoints: { $gt: user.weeklyPoints } }) + 1;
  return { rank, ...user.toObject() };
}

export function invalidateCache() {
  leaderboardCache.updatedAt = 0;
}
