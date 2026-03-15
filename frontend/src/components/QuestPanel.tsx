"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import toast from "react-hot-toast";
import { trackEvent } from "@/lib/analytics";

interface Quest {
  questId: string;
  title: string;
  description: string;
  category: "daily" | "weekly" | "onetime";
  action: string;
  target: number;
  rewardPoints: number;
  rewardLabel: string;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

const categoryColors: Record<string, string> = {
  daily: "text-neon-cyan",
  weekly: "text-neon-purple",
  onetime: "text-neon-gold",
};

const categoryLabels: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  onetime: "One-time",
};

export default function QuestPanel() {
  const { address } = useAccount();
  const [quests, setQuests] = useState<Quest[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);

  const fetchQuests = useCallback(async () => {
    if (!address) return;
    try {
      const res = await api.getQuests(address);
      if (res.success) setQuests(res.data);
    } catch {}
    setLoading(false);
  }, [address]);

  useEffect(() => {
    fetchQuests();
    const iv = setInterval(fetchQuests, 30000);
    return () => clearInterval(iv);
  }, [fetchQuests]);

  const handleClaim = async (questId: string) => {
    if (!address || claiming) return;
    setClaiming(questId);
    try {
      const res = await api.claimQuestReward(address, questId);
      if (res.success && res.data) {
        toast.success(`Claimed ${res.data.rewardPoints ?? 0} points!`);
        trackEvent("quest_claimed", { questId, points: res.data.rewardPoints ?? 0 });
        fetchQuests();
      } else {
        toast.error(res.error || "Claim failed");
      }
    } catch {
      toast.error("Claim failed");
    }
    setClaiming(null);
  };

  if (!address) return null;
  if (loading) {
    return (
      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-heading font-bold text-white mb-4">Quests</h2>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-dark-700/50 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const dailyQuests = quests.filter((q) => q.category === "daily");
  const weeklyQuests = quests.filter((q) => q.category === "weekly");
  const onetimeQuests = quests.filter((q) => q.category === "onetime");

  const completedCount = quests.filter((q) => q.completed).length;
  const totalCount = quests.length;

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-heading font-bold text-white">Quests</h2>
        <span className="text-xs text-gray-400">
          {completedCount}/{totalCount} completed
        </span>
      </div>

      {[
        { label: "Daily", items: dailyQuests },
        { label: "Weekly", items: weeklyQuests },
        { label: "Milestones", items: onetimeQuests },
      ].map(({ label, items }) =>
        items.length > 0 ? (
          <div key={label} className="mb-4">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
              {label}
            </h3>
            <AnimatePresence>
              {items.map((q) => (
                <motion.div
                  key={q.questId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex items-center gap-3 p-3 rounded-xl mb-2 transition-colors ${
                    q.completed ? "bg-dark-700/30" : "bg-dark-700/50 hover:bg-dark-700/70"
                  }`}
                >
                  {/* Progress ring */}
                  <div className="relative w-10 h-10 flex-shrink-0">
                    <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90">
                      <circle
                        cx="18"
                        cy="18"
                        r="15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        className="text-dark-600"
                      />
                      <circle
                        cx="18"
                        cy="18"
                        r="15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeDasharray={`${(Math.min(q.progress / q.target, 1) * 94.2).toFixed(1)} 94.2`}
                        className={q.completed ? "text-neon-green" : "text-neon-cyan"}
                        strokeLinecap="round"
                      />
                    </svg>
                    {q.completed && (
                      <span className="absolute inset-0 flex items-center justify-center text-neon-green text-xs">
                        ✓
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-medium uppercase ${categoryColors[q.category]}`}>
                        {categoryLabels[q.category]}
                      </span>
                    </div>
                    <p className={`text-sm font-medium ${q.completed ? "text-gray-500 line-through" : "text-white"}`}>
                      {q.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {q.progress}/{q.target} — {q.rewardLabel}
                    </p>
                  </div>

                  {/* Claim button */}
                  {q.completed && !q.claimed && (
                    <button
                      onClick={() => handleClaim(q.questId)}
                      disabled={claiming === q.questId}
                      className="px-3 py-1.5 text-xs font-medium bg-neon-cyan/10 border border-neon-cyan/30 rounded-lg text-neon-cyan hover:bg-neon-cyan/20 transition-colors disabled:opacity-50"
                    >
                      {claiming === q.questId ? "..." : "Claim"}
                    </button>
                  )}
                  {q.claimed && (
                    <span className="text-xs text-gray-600">Claimed</span>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ) : null
      )}

      {quests.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-4">No quests available</p>
      )}
    </div>
  );
}
