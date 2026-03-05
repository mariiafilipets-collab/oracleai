import User from "../models/User.js";
import { getContracts } from "./blockchain.service.js";

const leaderboardCache = { data: [], updatedAt: 0 };
const CACHE_TTL = 1_500;

export async function getLeaderboard(limit = 1000) {
  if (Date.now() - leaderboardCache.updatedAt < CACHE_TTL && leaderboardCache.data.length > 0) {
    return leaderboardCache.data.slice(0, limit);
  }

  const { Points } = getContracts();
  if (Points && typeof Points.getTopUsers === "function") {
    try {
      const [topAddrs, topPts] = await Points.getTopUsers(limit);
      const addresses = [];
      const chainRows = [];
      for (let i = 0; i < topAddrs.length; i++) {
        const address = String(topAddrs[i] || "").toLowerCase();
        const points = Number(topPts[i] || 0n);
        if (!/^0x[a-f0-9]{40}$/.test(address) || points <= 0) continue;
        addresses.push(address);
        chainRows.push({ address, points });
      }
      if (chainRows.length > 0) {
        const users = await User.find({ address: { $in: addresses } })
          .select("address totalPoints streak tier totalCheckIns")
          .lean();
        const byAddress = new Map(users.map((u) => [String(u.address).toLowerCase(), u]));
        const result = chainRows.map((row, i) => {
          const user = byAddress.get(row.address);
          return {
            rank: i + 1,
            address: row.address,
            points: row.points,
            totalPoints: Number(user?.totalPoints || row.points),
            streak: Number(user?.streak || 0),
            tier: String(user?.tier || "BASIC"),
            checkIns: Number(user?.totalCheckIns || 0),
          };
        });
        leaderboardCache.data = result;
        leaderboardCache.updatedAt = Date.now();
        return result;
      }
    } catch {}
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
  const target = String(address || "").toLowerCase();
  const board = await getLeaderboard(1000);
  const idx = board.findIndex((u) => String(u.address || "").toLowerCase() === target);
  if (idx >= 0) {
    return {
      rank: idx + 1,
      address: board[idx].address,
      weeklyPoints: board[idx].points,
      totalPoints: board[idx].totalPoints,
      streak: board[idx].streak,
      tier: board[idx].tier,
      totalCheckIns: board[idx].checkIns,
    };
  }

  const user = await User.findOne({ address: target });
  if (!user) return null;

  const rank = await User.countDocuments({ weeklyPoints: { $gt: user.weeklyPoints } }) + 1;
  return { rank, ...user.toObject() };
}

export function invalidateCache() {
  leaderboardCache.updatedAt = 0;
}
