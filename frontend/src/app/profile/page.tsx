"use client";

import { useState, useEffect } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { formatEther } from "viem";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import GlassCard from "@/components/GlassCard";
import { useContractAddresses } from "@/hooks/useContracts";
import { PointsABI, PredictionABI, ReferralABI } from "@/lib/contracts";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import AppIcon from "@/components/icons/AppIcon";

const BADGES = [
  { id: "firstCheckin", icon: "target", threshold: (d: any) => d.totalCheckIns >= 1 },
  { id: "streak3", icon: "streak", threshold: (d: any) => d.streak >= 3 },
  { id: "streak7", icon: "activity", threshold: (d: any) => d.streak >= 7 },
  { id: "predictor", icon: "prediction", threshold: (d: any) => d.totalPredictions >= 5 },
  { id: "accurate", icon: "brain", threshold: (d: any) => d.totalPredictions > 0 && (d.correctPredictions / d.totalPredictions) >= 0.9 },
  { id: "referrer", icon: "globe", threshold: (d: any) => d.directReferrals >= 5 },
  { id: "whale", icon: "whale", threshold: (d: any) => d.tier === "WHALE" },
  { id: "top10", icon: "leaderboard", threshold: () => false },
];

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const { t } = useI18n();
  const tr = (key: string, fallback: string, params?: Record<string, string | number>) => {
    const val = t(key, params);
    return val === key ? fallback : val;
  };
  const { addresses } = useContractAddresses();
  const [referralCode, setReferralCode] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [userData, setUserData] = useState<any>(null);
  const [referralStats, setReferralStats] = useState<any>(null);
  const [creatorStats, setCreatorStats] = useState<any>(null);
  const { writeContract, data: withdrawHash, isPending: withdrawing } = useWriteContract();
  const { isSuccess: withdrawSuccess } = useWaitForTransactionReceipt({ hash: withdrawHash });
  const { writeContract: writeCreatorClaim, data: creatorClaimHash, isPending: creatorClaiming } = useWriteContract();
  const { isSuccess: creatorClaimSuccess } = useWaitForTransactionReceipt({ hash: creatorClaimHash });

  const pointsAddress = addresses?.Points as `0x${string}` | undefined;
  const referralAddress = addresses?.Referral as `0x${string}` | undefined;
  const predictionAddress = addresses?.Prediction as `0x${string}` | undefined;

  const { data: userPoints } = useReadContract({
    address: pointsAddress,
    abi: PointsABI,
    functionName: "getUserPoints",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!pointsAddress },
  });

  const { data: directReferrals } = useReadContract({
    address: referralAddress,
    abi: ReferralABI,
    functionName: "getDirectReferrals",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!referralAddress },
  });

  const { data: refEarnings } = useReadContract({
    address: referralAddress,
    abi: ReferralABI,
    functionName: "totalEarnings",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!referralAddress },
  });

  const { data: pendingRefEarnings } = useReadContract({
    address: referralAddress,
    abi: ReferralABI,
    functionName: "pendingEarnings",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!referralAddress },
  });
  const { data: creatorClaimableRaw } = useReadContract({
    address: predictionAddress,
    abi: PredictionABI,
    functionName: "creatorClaimableWei",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!predictionAddress },
  });

  useEffect(() => {
    if (!address) return;

    api.getReferralCode(address).then((res) => {
      if (res.success) setReferralCode(res.data.code);
    }).catch(() => {});

    api.getUserHistory(address).then((res) => {
      if (res.success) setHistory(res.data || []);
    }).catch(() => {});

    api.getUser(address).then((res) => {
      if (res.success) setUserData(res.data);
    }).catch(() => {});

    api.getReferralStats(address).then((res) => {
      if (res.success) setReferralStats(res.data);
    }).catch(() => {});

    api.getCreatorStats(address).then((res) => {
      if (res.success) setCreatorStats(res.data);
    }).catch(() => {});
  }, [address]);

  useEffect(() => {
    if (withdrawSuccess) {
      toast.success(tr("profile.refWithdrawSuccess", "Referral earnings withdrawn"));
    }
  }, [withdrawSuccess, tr]);
  useEffect(() => {
    if (creatorClaimSuccess) {
      toast.success(tr("profile.creatorClaimSuccess", "Creator rewards withdrawn"));
    }
  }, [creatorClaimSuccess, tr]);

  if (!isConnected) {
    return (
      <div className="text-center py-32">
        <p className="text-4xl mb-4 flex justify-center"><AppIcon name="profile" className="w-10 h-10 text-neon-cyan" /></p>
        <p className="text-gray-400 text-lg">{t("profile.connectPrompt")}</p>
      </div>
    );
  }

  const up = userPoints as any;
  const totalPoints = Number(up?.points ?? up?.[0] ?? 0);
  const weeklyPoints = Number(up?.weeklyPoints ?? up?.[1] ?? 0);
  const streak = Number(up?.streak ?? up?.[2] ?? 0);
  const totalCheckIns = Number(up?.totalCheckIns ?? up?.[4] ?? 0);
  const correctPredictions = Number(up?.correctPredictions ?? up?.[5] ?? 0);
  const totalPredictions = Number(up?.totalPredictions ?? up?.[6] ?? 0);
  const refCount = directReferrals ? (directReferrals as any[]).length : 0;
  const pendingBnb = pendingRefEarnings ? parseFloat(formatEther(pendingRefEarnings as bigint)) : 0;
  const creatorClaimableBnb = creatorClaimableRaw ? parseFloat(formatEther(creatorClaimableRaw as bigint)) : 0;

  const badgeData = {
    totalCheckIns,
    streak,
    totalPredictions,
    correctPredictions,
    directReferrals: refCount,
    tier: userData?.onChain?.lastTier || "BASIC",
  };

  const accuracy = totalPredictions > 0 ? Math.round((correctPredictions / totalPredictions) * 100) : 0;
  const oracleScore = Math.min(100, Math.round(
    (Math.min(streak, 7) / 7) * 30 +
    accuracy * 0.4 +
    Math.min(refCount, 10) * 2 +
    (totalCheckIns > 0 ? 10 : 0)
  ));

  const buildTrackedLink = (source: string) => {
    if (!referralCode || typeof window === "undefined") return "";
    const params = new URLSearchParams({
      ref: referralCode,
      utm_source: source,
      utm_medium: "social",
      utm_campaign: "referral_profile",
    });
    return `${window.location.origin}/?${params.toString()}`;
  };

  const copyReferralLink = () => {
    navigator.clipboard.writeText(buildTrackedLink("direct"));
    toast.success(t("common.copied"));
  };

  const creativePresets = [
    {
      id: "x",
      platform: "X",
      icon: "x",
      source: "x",
      title: tr("profile.creativeCards.x.title", "Post for X"),
      text: tr("profile.creatives.x1", "I am earning with AI predictions on BNB Chain. Join with my referral link:"),
    },
    {
      id: "telegram",
      platform: "Telegram",
      icon: "send",
      source: "telegram",
      title: tr("profile.creativeCards.telegram.title", "Post for Telegram"),
      text: tr("profile.creatives.telegram", "Friends, I'm farming points in OracleAI Predict. Connect wallet and join my team:"),
    },
    {
      id: "instagram",
      platform: "Instagram",
      icon: "camera",
      source: "instagram",
      title: tr("profile.creativeCards.instagram.title", "Story for Instagram"),
      text: tr("profile.creatives.story", "Predict. Earn. Win. Join OracleAI Predict with my invite:"),
    },
  ];

  const copyCreative = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t("common.copied"));
  };

  const shareCreative = (platform: string, text: string, link: string) => {
    if (typeof window === "undefined") return;
    const payload = `${text} ${link}`.trim();
    if (platform === "x") {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(payload)}`, "_blank", "noopener,noreferrer");
      return;
    }
    if (platform === "telegram") {
      window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
      return;
    }
    copyCreative(payload);
    window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
  };

  const shortAddress = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

  const handleWithdrawRefEarnings = () => {
    if (!referralAddress) return;
    writeContract({
      address: referralAddress,
      abi: ReferralABI,
      functionName: "withdrawReferralEarnings",
      args: [],
    });
  };
  const handleClaimCreatorRewards = () => {
    if (!predictionAddress) return;
    writeCreatorClaim({
      address: predictionAddress,
      abi: PredictionABI,
      functionName: "claimCreatorFees",
      args: [],
    });
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <h1 className="text-2xl sm:text-3xl font-heading font-bold">
        <span className="gradient-cyan">{t("profile.title")}</span>
      </h1>

      {/* Oracle Score + Stats */}
      <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Oracle Score */}
        <GlassCard hover={false} className="flex flex-col items-center justify-center py-6 sm:py-8">
          <div className="relative w-28 h-28 sm:w-32 sm:h-32 mb-3 sm:mb-4">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#1e2438" strokeWidth="8" />
              <motion.circle
                cx="50" cy="50" r="42" fill="none"
                stroke="url(#scoreGradient)" strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${oracleScore * 2.64} 264`}
                initial={{ strokeDasharray: "0 264" }}
                animate={{ strokeDasharray: `${oracleScore * 2.64} 264` }}
                transition={{ duration: 1.5, ease: "easeOut" }}
              />
              <defs>
                <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#00f0ff" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl sm:text-2xl font-bold font-mono text-white">{oracleScore}</span>
              <span className="text-xs text-gray-500">{t("profile.score")}</span>
            </div>
          </div>
          <h3 className="font-heading font-bold text-lg">{t("profile.oracleScore")}</h3>
          <p className="text-xs text-gray-500 text-center mt-1">
            {t("profile.scoreDesc")}
          </p>
        </GlassCard>

        {/* Stats Grid */}
        <div className="lg:col-span-2 grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {[
            { label: t("stats.totalPoints"), value: totalPoints.toLocaleString(), icon: "points", color: "text-neon-gold" },
            { label: t("stats.weeklyPoints"), value: weeklyPoints.toLocaleString(), icon: "chart", color: "text-neon-cyan" },
            { label: t("stats.streak"), value: `${streak} ${t("common.days")}`, icon: "streak", color: "text-orange-400" },
            { label: t("profile.checkins"), value: totalCheckIns.toString(), icon: "check", color: "text-neon-green" },
            { label: t("profile.accuracy"), value: `${accuracy}%`, icon: "target", color: "text-neon-purple" },
            {
              label: tr("profile.refEarnings", "Ref Earnings"),
              value: refEarnings ? `${parseFloat(formatEther(refEarnings)).toFixed(4)} BNB` : "0 BNB",
              icon: "pool",
              color: "text-neon-gold",
            },
          ].map((stat, i) => (
            <GlassCard key={i} hover={false} className="p-3.5 sm:p-4 text-center">
              <div className="text-xl mb-1 flex justify-center"><AppIcon name={stat.icon as any} className="w-5 h-5" /></div>
              <div className={`text-lg font-bold font-mono ${stat.color}`}>{stat.value}</div>
              <div className="text-xs text-gray-500">{stat.label}</div>
            </GlassCard>
          ))}
        </div>
      </div>

      {/* Referral Section */}
      <GlassCard hover={false} className="p-4 sm:p-6">
        <h2 className="text-lg font-heading font-bold flex items-center gap-2 mb-4">
          <AppIcon name="globe" className="w-5 h-5 text-neon-cyan" /> {t("profile.referralProgram")}
          <span className="text-xs text-gray-500 font-normal">{t("profile.sixLevels")}</span>
        </h2>
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1">
            <label className="text-xs text-gray-500 mb-2 block">{t("profile.yourCode")}</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                readOnly
                value={referralCode}
                className="flex-1 px-4 py-3 rounded-xl bg-dark-700 border border-dark-500 font-mono text-neon-cyan"
              />
              <button
                onClick={copyReferralLink}
                className="min-h-11 px-6 py-3 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan font-bold text-sm hover:bg-neon-cyan/20 transition w-full sm:w-auto"
              >
                {t("common.copyLink")}
              </button>
            </div>
          </div>
          <div className="flex gap-6 items-center justify-between sm:justify-start">
            <div className="text-center">
              <div className="text-2xl font-bold font-mono text-neon-cyan">{refCount}</div>
              <div className="text-xs text-gray-500">{t("profile.directRefs")}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold font-mono text-neon-gold">
                {refEarnings ? parseFloat(formatEther(refEarnings)).toFixed(4) : "0"}
              </div>
              <div className="text-xs text-gray-500">{t("profile.bnbEarned")}</div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-xl bg-dark-700/40 border border-dark-500/50">
          <div>
            <div className="text-xs text-gray-500">{tr("profile.availableToWithdraw", "Available to withdraw")}</div>
            <div className="text-sm font-mono text-neon-green">{pendingBnb.toFixed(6)} BNB</div>
          </div>
          <button
            onClick={handleWithdrawRefEarnings}
            disabled={withdrawing || pendingBnb <= 0}
            className="min-h-11 px-4 py-2 rounded-lg bg-neon-green/15 border border-neon-green/30 text-neon-green text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neon-green/25 transition w-full sm:w-auto"
          >
            {withdrawing
              ? tr("profile.withdrawing", "Withdrawing...")
              : tr("profile.withdrawEarnings", "Withdraw Earnings")}
          </button>
        </div>
        <div className="mt-4 text-xs text-gray-500">
          {t("profile.levelRewards")}
        </div>
      </GlassCard>

      {/* Referral Analytics */}
      <GlassCard hover={false} className="p-4 sm:p-6">
        <h2 className="text-lg font-heading font-bold flex items-center gap-2 mb-4">
          <AppIcon name="chart" className="w-5 h-5 text-neon-cyan" /> {tr("profile.referralAnalytics", "Referral Analytics")}
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {[
            { label: t("profile.directRefs"), value: referralStats?.directCount ?? refCount, icon: "users" },
            { label: tr("profile.totalDownline", "Total Downline"), value: referralStats?.totalDownline ?? 0, icon: "tree" },
            { label: tr("profile.newRefs7d", "New Referrals (7d)"), value: referralStats?.recentDirect7d ?? 0, icon: "new" },
            { label: tr("profile.activeRefs7d", "Active Referrals (7d)"), value: referralStats?.activeDirect7d ?? 0, icon: "activity" },
          ].map((m, i) => (
            <div key={i} className="p-4 rounded-xl bg-dark-700/50 border border-dark-500/50 text-center">
              <div className="text-lg mb-1 flex justify-center"><AppIcon name={m.icon as any} className="w-5 h-5" /></div>
              <div className="text-xl font-bold font-mono text-neon-cyan">{m.value}</div>
              <div className="text-xs text-gray-500">{m.label}</div>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-5">
          <div>
            <h3 className="text-sm font-bold text-gray-200 mb-3">{tr("profile.levelBreakdown", "6-Level Structure Breakdown")}</h3>
            <div className="space-y-2">
              {(referralStats?.levels || []).map((lvl: any) => (
                <div key={lvl.level} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>{tr("profile.levelN", `Level ${lvl.level}`, { n: lvl.level })}</span>
                    <span className="font-mono">{lvl.count}</span>
                  </div>
                  <div className="h-2 bg-dark-600 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-neon-purple to-neon-cyan"
                      style={{ width: `${Math.min(100, (lvl.count / Math.max(1, referralStats?.totalDownline || 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-200 mb-3">{tr("profile.latestReferrals", "Latest Direct Referrals")}</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {referralStats?.directRefs?.length ? referralStats.directRefs.map((u: any) => (
                <div key={u.address} className="p-3 rounded-xl bg-dark-700/50 border border-dark-500/50 flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-200 font-mono">{shortAddress(u.address)}</div>
                    <div className="text-xs text-gray-500">{new Date(u.joinedAt).toLocaleDateString()}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-neon-cyan font-mono">{(u.totalPoints || 0).toLocaleString()} {t("common.pts")}</div>
                    <div className="text-xs text-gray-500">{u.tier || "BASIC"}</div>
                  </div>
                </div>
              )) : (
                <p className="text-xs text-gray-500">{tr("profile.noReferralsYet", "No referrals yet")}</p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 grid lg:grid-cols-3 gap-4">
          <div className="p-3 rounded-xl bg-dark-700/40 border border-dark-500/50">
            <h4 className="text-xs text-gray-400 mb-2">{tr("profile.shareBySource", "Registrations by source")}</h4>
            <div className="space-y-1">
              {(referralStats?.shareAttribution?.bySource || []).length ? (referralStats.shareAttribution.bySource as any[]).map((row, idx) => (
                <div key={`${row.key}-${idx}`} className="flex items-center justify-between text-xs">
                  <span className="text-gray-300">{String(row.key || "").toUpperCase()}</span>
                  <span className="font-mono text-neon-cyan">{Number(row.count || 0)}</span>
                </div>
              )) : <p className="text-xs text-gray-500">{tr("profile.noShareStats", "No share attribution data yet")}</p>}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-dark-700/40 border border-dark-500/50">
            <h4 className="text-xs text-gray-400 mb-2">{tr("profile.shareByCampaign", "Registrations by campaign")}</h4>
            <div className="space-y-1">
              {(referralStats?.shareAttribution?.byCampaign || []).length ? (referralStats.shareAttribution.byCampaign as any[]).map((row, idx) => (
                <div key={`${row.key}-${idx}`} className="flex items-center justify-between text-xs gap-2">
                  <span className="text-gray-300 truncate">{String(row.key || "")}</span>
                  <span className="font-mono text-neon-purple shrink-0">{Number(row.count || 0)}</span>
                </div>
              )) : <p className="text-xs text-gray-500">{tr("profile.noShareStats", "No share attribution data yet")}</p>}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-dark-700/40 border border-dark-500/50">
            <h4 className="text-xs text-gray-400 mb-2">{tr("profile.shareByEvent", "Registrations by event")}</h4>
            <div className="space-y-1">
              {(referralStats?.shareAttribution?.byEvent || []).length ? (referralStats.shareAttribution.byEvent as any[]).map((row, idx) => (
                <div key={`${row.key}-${idx}`} className="flex items-center justify-between text-xs">
                  <span className="text-gray-300">#{String(row.key || "")}</span>
                  <span className="font-mono text-neon-gold">{Number(row.count || 0)}</span>
                </div>
              )) : <p className="text-xs text-gray-500">{tr("profile.noShareStats", "No share attribution data yet")}</p>}
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Social Creatives */}
      <GlassCard hover={false} className="p-4 sm:p-6">
        <h2 className="text-lg font-heading font-bold flex items-center gap-2 mb-4">
          <AppIcon name="megaphone" className="w-5 h-5 text-neon-cyan" /> {tr("profile.socialCreatives", "Social Media Creatives")}
        </h2>
        <p className="text-xs text-gray-500 mb-4">{tr("profile.socialCreativesDesc", "Use ready-made posts to share your referral link quickly.")}</p>
        <div className="space-y-3">
          {creativePresets.map((preset) => {
            const trackedLink = buildTrackedLink(preset.source);
            const fullText = `${preset.text} ${trackedLink}`.trim();
            return (
            <div key={preset.id} className="p-3 rounded-xl bg-dark-700/50 border border-dark-500/50">
              <div className="rounded-xl p-4 bg-gradient-to-r from-neon-purple/20 via-neon-cyan/10 to-neon-gold/10 border border-neon-cyan/20">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-white inline-flex items-center gap-2"><AppIcon name={preset.icon as any} className="w-4 h-4" /> {preset.title}</span>
                  <span className="text-[10px] px-2 py-1 rounded-full bg-dark-900/70 text-gray-400">
                    {preset.platform}
                  </span>
                </div>
                <p className="mt-3 text-sm text-gray-100 break-words">{preset.text}</p>
                <p className="mt-2 text-xs text-neon-cyan break-all">{trackedLink}</p>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 justify-start sm:justify-end">
                <button
                  onClick={() => copyCreative(fullText)}
                  className="min-h-10 px-4 py-2 rounded-lg bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan text-xs font-bold hover:bg-neon-cyan/20 transition w-full sm:w-auto"
                >
                  {tr("profile.copyCreative", "Copy Creative")}
                </button>
                <button
                  onClick={() => copyCreative(trackedLink)}
                  className="min-h-10 px-4 py-2 rounded-lg bg-neon-purple/10 border border-neon-purple/30 text-neon-purple text-xs font-bold hover:bg-neon-purple/20 transition w-full sm:w-auto"
                >
                  {tr("profile.copyTrackedLink", "Copy UTM Link")}
                </button>
                <button
                  onClick={() => shareCreative(preset.source, preset.text, trackedLink)}
                  className="min-h-10 px-4 py-2 rounded-lg bg-neon-gold/10 border border-neon-gold/30 text-neon-gold text-xs font-bold hover:bg-neon-gold/20 transition w-full sm:w-auto"
                >
                  {tr("profile.shareNow", "Share Now")}
                </button>
              </div>
            </div>
          );
          })}
        </div>
      </GlassCard>

      {/* Creator Dashboard */}
      <GlassCard hover={false} className="p-4 sm:p-6">
        <h2 className="text-lg font-heading font-bold flex items-center gap-2 mb-4">
          <AppIcon name="prediction" className="w-5 h-5 text-neon-cyan" /> {tr("profile.creatorDashboard", "Creator Dashboard")}
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          {tr("profile.creatorDashboardDesc", "Performance of your user-created prediction events.")}
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
          {[
            { label: tr("profile.creatorCreated", "Created"), value: creatorStats?.createdCount ?? 0, color: "text-neon-cyan", icon: "new" },
            { label: tr("profile.creatorActive", "Active"), value: creatorStats?.activeCount ?? 0, color: "text-neon-green", icon: "activity" },
            { label: tr("profile.creatorResolved", "Resolved"), value: creatorStats?.resolvedCount ?? 0, color: "text-neon-purple", icon: "check" },
            { label: tr("profile.creatorConversion", "Vote Conversion"), value: `${creatorStats?.conversionPct ?? 0}%`, color: "text-neon-gold", icon: "chart" },
            { label: tr("profile.creatorAvgVotes", "Avg Votes/Event"), value: (creatorStats?.avgVotesPerEvent ?? 0).toFixed?.(1) ?? "0.0", color: "text-orange-300", icon: "users" },
          ].map((m, i) => (
            <div key={i} className="p-4 rounded-xl bg-dark-700/50 border border-dark-500/50 text-center">
              <div className="text-lg mb-1 flex justify-center"><AppIcon name={m.icon as any} className="w-5 h-5" /></div>
              <div className={`text-xl font-bold font-mono ${m.color}`}>{m.value}</div>
              <div className="text-xs text-gray-500">{m.label}</div>
            </div>
          ))}
        </div>
        <div className="mb-4 text-xs text-gray-500">
          {tr("profile.creatorDisputeRate", "Disputed/archived")}:
          <span className="ml-1 text-neon-red font-mono">
            {creatorStats?.createdCount > 0
              ? `${Math.round(((creatorStats?.disputedCount || 0) / creatorStats.createdCount) * 100)}%`
              : "0%"}
          </span>
          {" · "}
          {tr("profile.creatorTotalVotes", "Total votes")}:
          <span className="ml-1 text-neon-cyan font-mono">{creatorStats?.totalVotes ?? 0}</span>
          {" · "}
          {tr("profile.creatorVoteFee", "Vote fee")}:
          <span className="ml-1 text-neon-cyan font-mono">
            {creatorStats?.voteFeeWei ? `${parseFloat(formatEther(BigInt(creatorStats.voteFeeWei))).toFixed(4)} BNB` : "-"}
          </span>
          {" · "}
          {tr("profile.creatorShare", "Creator share")}:
          <span className="ml-1 text-neon-gold font-mono">{Number(creatorStats?.creatorShareBps || 5000) / 100}%</span>
        </div>
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-xl bg-dark-700/40 border border-dark-500/50">
          <div>
            <div className="text-xs text-gray-500">{tr("profile.creatorAvailableToWithdraw", "Creator rewards available")}</div>
            <div className="text-sm font-mono text-neon-gold">{creatorClaimableBnb.toFixed(6)} BNB</div>
            <div className="text-[11px] text-gray-500 mt-1">
              {tr("profile.creatorRulesHint", "Rewards unlock after valid resolution, minimum voter threshold, and verified creator status.")}
            </div>
          </div>
          <button
            onClick={handleClaimCreatorRewards}
            disabled={creatorClaiming || creatorClaimableBnb <= 0}
            className="min-h-11 px-4 py-2 rounded-lg bg-neon-gold/15 border border-neon-gold/30 text-neon-gold text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neon-gold/25 transition w-full sm:w-auto"
          >
            {creatorClaiming
              ? tr("profile.creatorWithdrawing", "Withdrawing...")
              : tr("profile.creatorWithdraw", "Withdraw Creator Rewards")}
          </button>
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {creatorStats?.latestEvents?.length ? creatorStats.latestEvents.map((evt: any) => {
            const totalVotes = Number(evt.totalVotesYes || 0) + Number(evt.totalVotesNo || 0);
            return (
              <div key={evt.eventId} className="p-3 rounded-xl bg-dark-700/50 border border-dark-500/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-gray-200 truncate">#{evt.eventId} · {evt.title}</p>
                  <p className="text-xs text-gray-500">{evt.category} · {new Date(evt.deadline).toLocaleString()}</p>
                </div>
                <div className="text-left sm:text-right shrink-0">
                  <div className={`text-xs font-bold ${evt.resolved ? "text-neon-purple" : "text-neon-green"}`}>
                    {evt.resolved ? tr("common.resolved", "Resolved") : tr("common.active", "active")}
                  </div>
                  <div className="text-xs text-neon-cyan font-mono">{totalVotes} {tr("profile.creatorVotes", "votes")}</div>
                </div>
              </div>
            );
          }) : (
            <p className="text-xs text-gray-500">{tr("profile.creatorNoEvents", "No user-created events yet")}</p>
          )}
        </div>
      </GlassCard>

      {/* Badges */}
      <GlassCard hover={false} className="p-4 sm:p-6">
        <h2 className="text-lg font-heading font-bold flex items-center gap-2 mb-4">
          <AppIcon name="medal" className="w-5 h-5 text-neon-gold" /> {t("profile.badges")}
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {BADGES.map((badge) => {
            const unlocked = badge.threshold(badgeData);
            return (
              <div
                key={badge.id}
                className={`p-4 rounded-xl border text-center transition-all ${
                  unlocked
                    ? "border-neon-gold/30 bg-neon-gold/5"
                    : "border-dark-500 bg-dark-700/50 opacity-50"
                }`}
              >
                <div className="text-3xl mb-2 flex justify-center"><AppIcon name={badge.icon as any} className="w-7 h-7" /></div>
                <div className="text-sm font-bold">{t(`profile.badgeItems.${badge.id}.name`)}</div>
                <div className="text-xs text-gray-500 mt-1">{t(`profile.badgeItems.${badge.id}.desc`)}</div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      {/* Check-in History */}
      <GlassCard hover={false} className="p-4 sm:p-6">
        <h2 className="text-lg font-heading font-bold flex items-center gap-2 mb-4">
          <AppIcon name="history" className="w-5 h-5 text-neon-cyan" /> {t("profile.history")}
        </h2>
        {history.length === 0 ? (
          <p className="text-gray-500 text-center py-8 text-sm">{t("profile.noCheckins")}</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {history.map((item: any, i: number) => (
              <div
                key={i}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-xl bg-dark-700/50 border border-dark-500/50"
              >
                <div>
                  <span
                    className={`text-xs font-bold mr-2 ${
                      item.tier === "WHALE"
                        ? "text-neon-gold"
                        : item.tier === "PRO"
                        ? "text-neon-cyan"
                        : "text-gray-400"
                    }`}
                  >
                    {item.tier}
                  </span>
                  <span className="text-sm text-gray-300">{item.amount} BNB</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-mono text-neon-green">+{item.points} {t("common.pts")}</span>
                  <span className="text-xs text-gray-500 ml-2">
                    <AppIcon name="streak" className="w-3.5 h-3.5 inline text-neon-gold" />{item.streak}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
