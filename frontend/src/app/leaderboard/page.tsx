"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { motion } from "framer-motion";
import { formatEther } from "viem";
import GlassCard from "@/components/GlassCard";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useContractAddresses } from "@/hooks/useContracts";
import { PrizePoolV2ABI } from "@/lib/contracts";
import toast from "react-hot-toast";
import AppIcon, { type IconName } from "@/components/icons/AppIcon";

const PODIUM_COLORS = [
  "from-yellow-400 to-yellow-600",
  "from-gray-300 to-gray-500",
  "from-amber-600 to-amber-800",
];

const TIER_COLORS: Record<string, string> = {
  WHALE: "text-neon-gold bg-neon-gold/10 border-neon-gold/30",
  PRO: "text-neon-cyan bg-neon-cyan/10 border-neon-cyan/30",
  BASIC: "text-gray-400 bg-gray-600/10 border-gray-600/30",
};

export default function LeaderboardPage() {
  const { address } = useAccount();
  const { t } = useI18n();
  const { addresses } = useContractAddresses();
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [claimData, setClaimData] = useState<any>(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const tr = (key: string, fallback: string, params?: Record<string, string | number>) => {
    const value = t(key, params);
    return value === key ? fallback : value;
  };
  const prizePoolV2Address = addresses?.PrizePoolV2 as `0x${string}` | undefined;
  const { writeContract, data: claimTxHash, isPending: claimPending } = useWriteContract();
  const { isSuccess: claimSuccess } = useWaitForTransactionReceipt({ hash: claimTxHash });

  useEffect(() => {
    Promise.all([
      api.getLeaderboard(1000),
      api.getStats(),
    ]).then(([lb, st]) => {
      if (lb.success) setLeaderboard(lb.data || []);
      if (st.success) setStats(st.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!address) {
      setClaimData(null);
      return;
    }
    setClaimLoading(true);
    api
      .getClaimProof(address)
      .then((res) => {
        if (res?.success) setClaimData(res.data || null);
      })
      .catch(() => {})
      .finally(() => setClaimLoading(false));
  }, [address]);

  useEffect(() => {
    if (claimSuccess) {
      toast.success(tr("leaderboard.weeklyPrizeClaimed", "Weekly prize claimed"));
      if (address) {
        api.getClaimProof(address).then((res) => {
          if (res?.success) setClaimData(res.data || null);
        });
      }
    }
  }, [claimSuccess, address]);

  const handleClaim = () => {
    if (!prizePoolV2Address || !address || !claimData?.proof || !claimData?.amount) return;
    writeContract({
      address: prizePoolV2Address,
      abi: PrizePoolV2ABI,
      functionName: "claim",
      args: [
        BigInt(claimData.epoch),
        BigInt(claimData.index),
        address,
        BigInt(claimData.amount),
        claimData.proof as `0x${string}`[],
      ],
    });
  };

  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);
  const userRank = leaderboard.findIndex(
    (u) => u.address?.toLowerCase() === address?.toLowerCase()
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-bold">
          <span className="gradient-gold">{t("leaderboard.title")}</span>
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          {t("leaderboard.subtitle")}
        </p>
      </div>

      {/* Prize Pool Info */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassCard hover={false} className="p-4 text-center">
          <div className="text-2xl mb-1 flex justify-center"><AppIcon name="pool" className="w-6 h-6 text-neon-gold" /></div>
          <div className="text-lg font-bold font-mono text-neon-gold">
            {stats?.prizePoolBalance
              ? `${(Number(stats.prizePoolBalance) / 1e18).toFixed(3)} BNB`
              : "0 BNB"}
          </div>
          <div className="text-xs text-gray-500">{t("stats.prizePool")}</div>
        </GlassCard>
        <GlassCard hover={false} className="p-4 text-center">
          <div className="text-2xl mb-1 flex justify-center"><AppIcon name="users" className="w-6 h-6 text-neon-cyan" /></div>
          <div className="text-lg font-bold font-mono text-neon-cyan">
            {stats?.totalUsers || 0}
          </div>
          <div className="text-xs text-gray-500">{t("stats.totalUsers")}</div>
        </GlassCard>
        <GlassCard hover={false} className="p-4 text-center">
          <div className="text-2xl mb-1 flex justify-center"><AppIcon name="check" className="w-6 h-6 text-neon-green" /></div>
          <div className="text-lg font-bold font-mono text-neon-green">
            {stats?.totalCheckIns || 0}
          </div>
          <div className="text-xs text-gray-500">{t("stats.totalCheckins")}</div>
        </GlassCard>
        <GlassCard hover={false} className="p-4 text-center">
          <div className="text-2xl mb-1 flex justify-center"><AppIcon name="medal" className="w-6 h-6 text-neon-purple" /></div>
          <div className="text-lg font-bold font-mono text-neon-purple">
            {userRank >= 0 ? `#${userRank + 1}` : "N/A"}
          </div>
          <div className="text-xs text-gray-500">{t("stats.yourRank")}</div>
        </GlassCard>
      </div>

      {/* Weekly claim card (PrizePoolV2) */}
      <GlassCard hover={false} className="p-4">
        {!address ? (
          <p className="text-sm text-gray-500">{tr("leaderboard.connectForWeeklyClaim", "Connect wallet to check weekly claim status.")}</p>
        ) : claimLoading ? (
          <p className="text-sm text-gray-500">{t("common.loading")}</p>
        ) : !claimData ? (
          <p className="text-sm text-gray-500">{tr("leaderboard.noClaimableWeeklyPrize", "No claimable weekly prize for your address in current epoch.")}</p>
        ) : (
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <p className="text-sm text-gray-300">
                {tr("leaderboard.claimableWeeklyReward", "Claimable weekly reward:")}{" "}
                <span className="font-mono text-neon-gold">
                  {claimData.amount ? Number(formatEther(BigInt(claimData.amount))).toFixed(6) : "0.000000"} BNB
                </span>
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Epoch #{claimData.epoch} · Rank #{claimData.rank} · {claimData.claimed ? tr("common.claimed", "Claimed") : tr("common.unclaimed", "Unclaimed")}
              </p>
            </div>
            <button
              onClick={handleClaim}
              disabled={claimPending || claimData.claimed}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-neon-cyan text-dark-900 font-bold text-sm disabled:opacity-50"
            >
              {claimPending
                ? tr("leaderboard.claiming", "Claiming...")
                : claimData.claimed
                  ? tr("leaderboard.alreadyClaimed", "Already Claimed")
                  : tr("leaderboard.claimWeeklyPrize", "Claim Weekly Prize")}
            </button>
          </div>
        )}
      </GlassCard>

      {loading ? (
        <div className="text-center py-20 text-gray-500">{t("common.loading")}</div>
      ) : leaderboard.length === 0 ? (
        <GlassCard hover={false} className="text-center py-16">
          <p className="text-4xl mb-4 flex justify-center"><AppIcon name="leaderboard" className="w-10 h-10 text-neon-gold" /></p>
          <p className="text-gray-400">{t("leaderboard.noParticipants")}</p>
        </GlassCard>
      ) : (
        <>
          {/* Top 3 Podium */}
          {top3.length >= 3 && (
            <div className="flex items-end justify-center gap-4 py-6">
              {[1, 0, 2].map((idx) => {
                const user = top3[idx];
                const heights = ["h-32", "h-24", "h-20"];
                const medals: IconName[] = ["gold", "silver", "bronze"];
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.2 }}
                    className="flex flex-col items-center"
                  >
                    <span className="text-3xl mb-2"><AppIcon name={medals[idx]} className="w-8 h-8 text-neon-gold" /></span>
                    <span className="text-xs font-mono text-gray-400 mb-2">
                      {user.address?.slice(0, 6)}...{user.address?.slice(-4)}
                    </span>
                    <span className="text-sm font-bold text-white mb-2">
                      {user.points?.toLocaleString()} {t("common.pts")}
                    </span>
                    <div
                      className={`w-20 ${heights[idx]} rounded-t-xl bg-gradient-to-t ${PODIUM_COLORS[idx]}`}
                    />
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Table */}
          <GlassCard hover={false} className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-dark-500">
                    <th className="text-left text-xs text-gray-500 font-medium p-4 w-16">{t("leaderboard.rank")}</th>
                    <th className="text-left text-xs text-gray-500 font-medium p-4">{t("leaderboard.address")}</th>
                    <th className="text-center text-xs text-gray-500 font-medium p-4">{t("leaderboard.tier")}</th>
                    <th className="text-center text-xs text-gray-500 font-medium p-4">{t("leaderboard.streak")}</th>
                    <th className="text-right text-xs text-gray-500 font-medium p-4">{t("leaderboard.points")}</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((user, i) => {
                    const isMe = user.address?.toLowerCase() === address?.toLowerCase();
                    return (
                      <motion.tr
                        key={user.address}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.03 }}
                        className={`border-b border-dark-500/50 transition-colors ${
                          isMe
                            ? "bg-neon-cyan/5 border-l-2 border-l-neon-cyan"
                            : "hover:bg-dark-700/50"
                        }`}
                      >
                        <td className="p-4 font-mono text-sm">
                          {i < 3 ? <AppIcon name={(["gold", "silver", "bronze"] as IconName[])[i]} className="w-4.5 h-4.5 inline" /> : `#${i + 1}`}
                        </td>
                        <td className="p-4 font-mono text-sm">
                          {user.address?.slice(0, 6)}...{user.address?.slice(-4)}
                          {isMe && (
                            <span className="ml-2 text-xs text-neon-cyan">{t("leaderboard.you")}</span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          <span
                            className={`text-xs px-2 py-1 rounded-full border ${
                              TIER_COLORS[user.tier || "BASIC"]
                            }`}
                          >
                            {user.tier || "BASIC"}
                          </span>
                        </td>
                        <td className="p-4 text-center text-sm">
                          {user.streak > 0 && <AppIcon name="streak" className="w-3.5 h-3.5 inline text-neon-gold" />} {user.streak || 0}
                        </td>
                        <td className="p-4 text-right font-mono font-bold text-sm">
                          {user.points?.toLocaleString() || 0}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </>
      )}
    </div>
  );
}
