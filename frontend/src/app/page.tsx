"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { parseEther, formatEther } from "viem";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import GlassCard from "@/components/GlassCard";
import WelcomeBanner from "@/components/WelcomeBanner";
import HowItWorks from "@/components/HowItWorks";
import EarnPoints from "@/components/EarnPoints";
import { useContractAddresses } from "@/hooks/useContracts";
import { CheckInABI, PointsABI, PrizePoolABI } from "@/lib/contracts";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import AppIcon from "@/components/icons/AppIcon";

const TIERS = [
  { key: "basic", amount: "0.0015", multiplier: "1x", color: "text-gray-400", pts: "100" },
  { key: "pro", amount: "0.01", multiplier: "3x", color: "text-neon-cyan", pts: "300" },
  { key: "whale", amount: "0.05", multiplier: "10x", color: "text-neon-gold", pts: "1,000" },
];

export default function HomePage() {
  const { address, isConnected } = useAccount();
  const { addresses } = useContractAddresses();
  const { activityFeed, addActivity, setActivityFeed } = useAppStore();
  const { t } = useI18n();
  const [selectedTier, setSelectedTier] = useState(0);
  const [predictions, setPredictions] = useState<any[]>([]);
  const [showGuide, setShowGuide] = useState(false);

  const checkInAddress = addresses?.CheckIn as `0x${string}` | undefined;
  const pointsAddress = addresses?.Points as `0x${string}` | undefined;
  const prizePoolAddress = addresses?.PrizePool as `0x${string}` | undefined;

  const { data: userPoints } = useReadContract({
    address: pointsAddress,
    abi: PointsABI,
    functionName: "getUserPoints",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!pointsAddress },
  });
  const up = userPoints as any;
  const { data: prizeBalance } = useReadContract({
    address: prizePoolAddress,
    abi: PrizePoolABI,
    functionName: "getBalance",
    query: { enabled: !!prizePoolAddress },
  });
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const handleCheckIn = useCallback(() => {
    if (!checkInAddress) {
      toast.error(t("predictions.contractsNotLoaded"));
      return;
    }
    writeContract({
      address: checkInAddress,
      abi: CheckInABI,
      functionName: "checkIn",
      value: parseEther(TIERS[selectedTier].amount),
    });
  }, [checkInAddress, selectedTier, t, writeContract]);

  useEffect(() => {
    if (isSuccess) {
      const tierLabel = t(`tiers.${TIERS[selectedTier].key}`);
      toast.success(`${tierLabel}! +${TIERS[selectedTier].pts} ${t("common.pts")}!`);
      addActivity({
        address: address || "",
        amount: TIERS[selectedTier].amount,
        tier: tierLabel,
        tierKey: TIERS[selectedTier].key,
        points: selectedTier === 0 ? 100 : selectedTier === 1 ? 300 : 1000,
        streak: Number(up?.streak ?? up?.[2] ?? 0) + 1,
        timestamp: Date.now(),
      });
    }
  }, [isSuccess, t, addActivity, address, selectedTier, up?.streak, up]);

  const refreshData = useCallback(() => {
    api
      .getPredictions()
      .then((r) => {
        if (r.success) setPredictions(r.data || []);
      })
      .catch(() => {});
  }, []);

  const refreshActivity = useCallback(() => {
    api.getActivity(50).then((r) => {
      if (!r?.success) return;
      const mapped = (r.data || []).map((x: any) => ({
        address: String(x.address || "").toLowerCase(),
        amount: String(x.amount || "0"),
        tier: String(x.tier || "BASIC"),
        tierKey: String(x.tier || "BASIC").toLowerCase(),
        points: Number(x.points || 0),
        streak: Number(x.streak || 0),
        timestamp: Number(x.timestamp || Date.now()),
      }));
      setActivityFeed(mapped);
    }).catch(() => {});
  }, [setActivityFeed]);

  useEffect(() => {
    refreshData();
    refreshActivity();
    const i = setInterval(refreshData, 20000);
    const a = setInterval(refreshActivity, 15000);
    return () => { clearInterval(i); clearInterval(a); };
  }, [refreshData, refreshActivity]);

  const streak = Number(up?.streak ?? up?.[2] ?? 0);
  const totalPoints = Number(up?.points ?? up?.[0] ?? 0);
  const weeklyPoints = Number(up?.weeklyPoints ?? up?.[1] ?? 0);
  const poolStr = prizeBalance ? `${parseFloat(formatEther(prizeBalance)).toFixed(2)} BNB` : "0 BNB";

  return (
    <div className="space-y-5 sm:space-y-6 relative">
      <WelcomeBanner />

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative rounded-3xl overflow-hidden mb-2 card-animated">
        <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/10 via-dark-800 to-neon-purple/10" />
        <div className="absolute inset-0 overflow-hidden">
          {[...Array(12)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-1 h-1 bg-neon-cyan/30 rounded-full"
              style={{ left: `${(i * 8.3) % 100}%`, top: `${(i * 13.7) % 100}%` }}
              animate={{ y: [0, -20, 0], opacity: [0.2, 0.8, 0.2] }}
              transition={{ duration: 3 + i * 0.5, repeat: Infinity, delay: i * 0.3 }}
            />
          ))}
        </div>
        <div className="relative z-10 text-center py-8 sm:py-10 lg:py-16 px-4 sm:px-6">
          <motion.h1
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-[1.75rem] sm:text-4xl lg:text-6xl font-heading font-bold mb-3 sm:mb-4 leading-tight"
          >
            <span className="bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-gold bg-clip-text text-transparent">
              {t("hero.title1")}
            </span>
            <br />
            <span className="text-white">{t("hero.title2")}</span>
          </motion.h1>
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-gray-400 text-sm sm:text-lg lg:text-xl max-w-2xl mx-auto mb-6 sm:mb-7"
          >
            {t("hero.subtitle")}
          </motion.p>
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="flex flex-wrap justify-center gap-4 sm:gap-8 lg:gap-16 mb-6 sm:mb-8"
          >
            {[
              { label: t("hero.activePredictions"), value: predictions.length.toString() },
              { label: t("hero.prizePool"), value: poolStr },
              { label: t("hero.communityShare"), value: "58%" },
            ].map((s, i) => (
              <div key={i} className="text-center">
                <div className="text-xl sm:text-2xl lg:text-3xl font-bold font-mono text-white">{s.value}</div>
                <div className="text-xs text-gray-500">{s.label}</div>
              </div>
            ))}
          </motion.div>
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="flex flex-col items-center gap-4"
          >
            {!isConnected ? (
              <button
                onClick={() => document.querySelector<HTMLButtonElement>("[data-rk] button")?.click()}
                className="min-h-12 px-8 sm:px-10 py-3.5 sm:py-4 rounded-2xl bg-gradient-to-r from-neon-cyan to-neon-purple text-dark-900 font-bold text-base sm:text-lg hover:opacity-90 transition animate-pulse-glow"
              >
                {t("hero.cta")}
              </button>
            ) : (
              <a
                href="#checkin"
                className="min-h-12 px-8 sm:px-10 py-3.5 sm:py-4 rounded-2xl bg-gradient-to-r from-neon-cyan to-neon-purple text-dark-900 font-bold text-base sm:text-lg hover:opacity-90 transition animate-pulse-glow"
              >
                {t("hero.ctaCheckin")}
              </a>
            )}
            <div className="flex flex-wrap justify-center gap-2 sm:gap-3 text-[11px] sm:text-xs">
              {[t("hero.badges.bnb"), t("hero.badges.ai"), t("hero.badges.community"), t("hero.badges.opensource"), t("hero.badges.nokyc")].map((b, i) => (
                <span key={i} className="px-3 py-1.5 rounded-full bg-dark-700/80 border border-dark-500/50 text-gray-400">
                  {b}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </motion.div>

      <div className="flex justify-end">
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="min-h-10 px-3 py-2 rounded-lg bg-dark-700 border border-dark-500 text-xs text-gray-400 hover:text-neon-cyan hover:border-neon-cyan/30 transition"
        >
          {showGuide ? t("guide.hideGuide") : `📖 ${t("guide.showGuide")}`}
        </button>
      </div>

      <AnimatePresence>
        {showGuide && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="space-y-6 overflow-hidden"
          >
            <HowItWorks />
            <EarnPoints />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: t("stats.totalPoints"), value: totalPoints.toLocaleString(), icon: "points", color: "text-neon-gold" },
          { label: t("stats.weeklyPoints"), value: weeklyPoints.toLocaleString(), icon: "chart", color: "text-neon-cyan" },
          { label: t("stats.streak"), value: `${streak} ${t("common.days")}`, icon: "streak", color: "text-orange-400" },
          {
            label: t("stats.prizePool"),
            value: prizeBalance ? `${parseFloat(formatEther(prizeBalance)).toFixed(3)} BNB` : "0 BNB",
            icon: "pool",
            color: "text-neon-green",
          },
        ].map((stat, i) => (
          <GlassCard key={i} className="p-4 text-center card-animated" hover={false}>
            <div className="text-2xl mb-1 flex justify-center"><AppIcon name={stat.icon as any} className="w-6 h-6" /></div>
            <div className={`text-lg lg:text-xl font-bold font-mono ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-gray-500">{stat.label}</div>
          </GlassCard>
        ))}
      </div>

      <GlassCard id="checkin" className="relative overflow-hidden" hover={false}>
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-neon-cyan/5 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
        <h2 className="text-xl font-heading font-bold mb-1 flex flex-wrap items-center gap-2">
          <span><AppIcon name="target" className="w-5 h-5 text-neon-cyan" /></span> {t("checkin.title")}
          {streak > 0 && (
            <span className="text-sm bg-neon-gold/20 text-neon-gold px-3 py-1 rounded-full">
              🔥 {t("checkin.streak", { count: streak })} · +{Math.min(50, Math.round((streak * 50) / 7))}%
            </span>
          )}
        </h2>
        <p className="text-xs text-gray-500 mb-4">{t("checkin.subtitle")}</p>
        {!isConnected ? (
          <div className="text-center py-8">
            <p className="text-gray-400 mb-2">{t("checkin.connectPrompt")}</p>
            <p className="text-xs text-gray-600">{t("checkin.connectHint")}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3 mb-5 sm:mb-6">
              {TIERS.map((tier, i) => (
                <button
                  key={tier.key}
                  onClick={() => setSelectedTier(i)}
                    className={`relative p-3.5 sm:p-4 rounded-xl border-2 transition-all duration-300 ${
                    selectedTier === i
                      ? "border-neon-cyan bg-neon-cyan/10 shadow-lg shadow-neon-cyan/10"
                      : "border-dark-500 bg-dark-700"
                  }`}
                >
                  <div className={`text-sm font-bold ${tier.color}`}>{t(`tiers.${tier.key}`)}</div>
                  <div className="text-lg font-mono font-bold text-white mt-1">{tier.amount} BNB</div>
                  <div className={`text-xs mt-1 ${tier.color}`}>
                    {tier.multiplier} → {tier.pts} {t("common.pts")}
                  </div>
                  {selectedTier === i && (
                    <motion.div layoutId="tierIndicator" className="absolute -top-1 -right-1 w-4 h-4 bg-neon-cyan rounded-full" />
                  )}
                </button>
              ))}
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleCheckIn}
              disabled={isPending || isConfirming}
              className={`w-full min-h-12 py-4 rounded-xl font-bold text-base sm:text-lg transition-all duration-300 ${
                isPending || isConfirming
                  ? "bg-dark-600 text-gray-500 cursor-wait"
                  : "bg-gradient-to-r from-neon-cyan to-neon-purple text-dark-900 hover:opacity-90 animate-pulse-glow"
              }`}
            >
              {isPending
                ? t("checkin.confirming")
                : isConfirming
                  ? t("checkin.processing")
                  : t("checkin.button", {
                      tier: t(`tiers.${TIERS[selectedTier].key}`),
                      amount: TIERS[selectedTier].amount,
                      pts: TIERS[selectedTier].pts,
                    })}
            </motion.button>
            <div className="flex items-center justify-center gap-3 mt-3 text-[10px] text-gray-600 flex-wrap">
              <span>{t("checkin.fees.prizes")}</span>
              <span>{t("checkin.fees.treasury")}</span>
              <span>{t("checkin.fees.referrals")}</span>
              <span>{t("checkin.fees.burn")}</span>
              <span>{t("checkin.fees.stakers")}</span>
            </div>
          </>
        )}
      </GlassCard>

      <div className="grid lg:grid-cols-2 gap-6">
        <GlassCard hover={false}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-heading font-bold flex items-center gap-2">
              <span><AppIcon name="prediction" className="w-5 h-5 text-neon-cyan" /></span> {t("livePredictions.title")}
            </h2>
            <span className="text-xs text-gray-500">
              {predictions.length} {t("common.active")}
            </span>
          </div>
          <p className="text-xs text-gray-600 mb-3">{t("livePredictions.subtitle")}</p>
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {predictions.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 text-sm mb-1">{t("livePredictions.noPredictions")}</p>
                <p className="text-xs text-gray-600">{t("livePredictions.autoGenerate")}</p>
              </div>
            ) : (
              predictions.slice(0, 5).map((pred: any, i: number) => (
                <motion.div
                  key={pred.eventId || i}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="p-3 rounded-xl bg-dark-700/50 border border-dark-500/50 hover:border-neon-cyan/20 transition"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-dark-600 text-gray-400">
                      {t(`categories.${pred.category}`)}
                    </span>
                    <span className="text-xs text-gray-500 font-mono">AI: {pred.aiProbability}%</span>
                  </div>
                  <p className="text-sm text-gray-200 leading-snug">{pred.title}</p>
                </motion.div>
              ))
            )}
          </div>
          {predictions.length > 0 && (
            <a href="/predictions" className="block text-center mt-3 text-xs text-neon-cyan hover:underline">
              {t("livePredictions.viewAll", { count: predictions.length })} →
            </a>
          )}
        </GlassCard>

        <GlassCard hover={false}>
          <div className="mb-2">
            <h2 className="text-lg font-heading font-bold flex items-center gap-2">
              <span><AppIcon name="activity" className="w-5 h-5 text-neon-purple" /></span> {t("activity.title")}
            </h2>
            <p className="text-xs text-gray-600">{t("activity.subtitle")}</p>
          </div>
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            <AnimatePresence>
              {activityFeed.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 text-sm mb-1">{t("activity.noActivity")}</p>
                  <p className="text-xs text-gray-600">{t("activity.beFirst")}</p>
                </div>
              ) : (
                activityFeed.map((item) => (
                  <motion.div
                    key={`${item.address}-${item.timestamp}`}
                    initial={{ opacity: 0, x: 20, height: 0 }}
                    animate={{ opacity: 1, x: 0, height: "auto" }}
                    exit={{ opacity: 0, x: -20 }}
                    className="p-3 rounded-xl bg-dark-700/50 border border-dark-500/50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-gray-400">
                        {item.address.slice(0, 6)}...{item.address.slice(-4)}
                      </span>
                      <span
                        className={`text-xs font-bold ${
                          item.tierKey === "whale"
                            ? "text-neon-gold"
                            : item.tierKey === "pro"
                              ? "text-neon-cyan"
                              : "text-gray-400"
                        }`}
                      >
                        {item.tier}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      +{item.points} {t("common.pts")} · {item.amount} BNB · <AppIcon name="streak" className="w-3.5 h-3.5 inline text-neon-gold" />{item.streak}
                    </div>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
