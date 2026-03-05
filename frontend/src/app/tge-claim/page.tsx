"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import GlassCard from "@/components/GlassCard";
import AppIcon from "@/components/icons/AppIcon";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useContractAddresses } from "@/hooks/useContracts";
import { PointsABI } from "@/lib/contracts";

const AIRDROP_POOL_OAI = 400_000_000;

export default function TgeClaimPage() {
  const { t } = useI18n();
  const tr = (key: string, fallback: string, params?: Record<string, string | number>) => {
    const value = t(key, params);
    return value === key ? fallback : value;
  };

  const { address } = useAccount();
  const { addresses } = useContractAddresses();
  const pointsAddress = addresses?.Points as `0x${string}` | undefined;

  const [stats, setStats] = useState({ totalUsers: 0, totalCheckIns: 0, totalPredictions: 0 });
  const [forecast, setForecast] = useState<{
    snapshotAt: string;
    airdropPoolOai: number;
    scenarios: {
      min: { totalPoints: number; oaiPerPoint: number };
      base: { totalPoints: number; oaiPerPoint: number };
      max: { totalPoints: number; oaiPerPoint: number };
    };
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [statsRes, forecastRes] = await Promise.all([api.getStats(), api.getTgeForecast()]);
        if (mounted && statsRes?.success && statsRes?.data) {
          setStats({
            totalUsers: Number(statsRes.data.totalUsers || 0),
            totalCheckIns: Number(statsRes.data.totalCheckIns || 0),
            totalPredictions: Number(statsRes.data.totalPredictions || 0),
          });
        }
        if (mounted && forecastRes?.success && forecastRes?.data) {
          setForecast(forecastRes.data);
        }
      } catch {}
    };
    load();
    const id = setInterval(load, 20_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const { data: totalIssuedRaw } = useReadContract({
    address: pointsAddress,
    abi: PointsABI,
    functionName: "totalPointsIssued",
    query: { enabled: !!pointsAddress },
  });

  const { data: userPointsRaw } = useReadContract({
    address: pointsAddress,
    abi: PointsABI,
    functionName: "getUserPoints",
    args: address ? [address] : undefined,
    query: { enabled: !!pointsAddress && !!address },
  });

  const totalPoints = useMemo(() => Number(totalIssuedRaw ?? BigInt(0)), [totalIssuedRaw]);
  const userPoints = useMemo(() => {
    if (!userPointsRaw) return 0;
    const p = (userPointsRaw as any)?.points ?? (userPointsRaw as any)?.[0] ?? BigInt(0);
    return Number(p);
  }, [userPointsRaw]);

  const airdropPool = forecast?.airdropPoolOai || AIRDROP_POOL_OAI;
  const projectedOai = totalPoints > 0 ? (userPoints / totalPoints) * airdropPool : 0;
  const projectedRate = totalPoints > 0 ? airdropPool / totalPoints : 0;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-bold">
          <span className="gradient-cyan">TGE</span>{" "}
          <span className="text-white">{tr("tgeClaim.title", "Claim & Points Conversion")}</span>
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          {tr("tgeClaim.subtitle", "Transparent projection before TGE. Final conversion is fixed at snapshot time.")}
        </p>
      </div>

      <GlassCard hover={false} className="border border-neon-gold/30 bg-neon-gold/5">
        <p className="text-sm text-neon-gold font-bold">
          {tr("tgeClaim.warningTitle", "Projection only")}
        </p>
        <p className="text-xs text-gray-300 mt-1">
          {tr("tgeClaim.warningDesc", "Live numbers are indicative. Final claim uses snapshot totals during TGE week.")}
        </p>
      </GlassCard>

      <GlassCard hover={false}>
        <h3 className="font-bold text-white mb-4">{tr("tgeClaim.timelineTitle", "TGE timeline")}</h3>
        <div className="grid md:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-dark-700/50 border border-dark-500/50">
            <p className="text-xs text-gray-500">{tr("tgeClaim.timelineStep1", "1. Pre-TGE")}</p>
            <p className="text-sm text-white mt-1">{tr("tgeClaim.timelinePre", "Earn points via check-ins, predictions, referrals, and streaks.")}</p>
          </div>
          <div className="p-3 rounded-xl bg-dark-700/50 border border-dark-500/50">
            <p className="text-xs text-gray-500">{tr("tgeClaim.timelineStep2", "2. Snapshot")}</p>
            <p className="text-sm text-white mt-1">{tr("tgeClaim.timelineDateTba", "TBA")}</p>
            <p className="text-xs text-gray-500 mt-1">{tr("tgeClaim.timelineSnapshot", "Final points are fixed for conversion.")}</p>
          </div>
          <div className="p-3 rounded-xl bg-dark-700/50 border border-dark-500/50">
            <p className="text-xs text-gray-500">{tr("tgeClaim.timelineStep3", "3. Claim Window")}</p>
            <p className="text-sm text-white mt-1">{tr("tgeClaim.timelineWindowTba", "TBA (planned 7 days after snapshot)")}</p>
            <p className="text-xs text-gray-500 mt-1">{tr("tgeClaim.timelineClaim", "Claim converted OAI and move to token staking.")}</p>
          </div>
        </div>
      </GlassCard>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassCard hover={false} className="text-center p-4">
          <p className="text-xs text-gray-500">{tr("tgeClaim.yourPoints", "Your points")}</p>
          <p className="text-2xl font-mono font-bold text-neon-cyan">{userPoints.toLocaleString()}</p>
        </GlassCard>
        <GlassCard hover={false} className="text-center p-4">
          <p className="text-xs text-gray-500">{tr("tgeClaim.platformPoints", "Platform total points")}</p>
          <p className="text-2xl font-mono font-bold text-neon-purple">{totalPoints.toLocaleString()}</p>
        </GlassCard>
        <GlassCard hover={false} className="text-center p-4">
          <p className="text-xs text-gray-500">{tr("tgeClaim.projectedOai", "Projected OAI")}</p>
          <p className="text-2xl font-mono font-bold text-neon-green">{projectedOai.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
        </GlassCard>
        <GlassCard hover={false} className="text-center p-4">
          <p className="text-xs text-gray-500">{tr("tgeClaim.liveRate", "Current projected rate")}</p>
          <p className="text-2xl font-mono font-bold text-neon-gold">
            {projectedRate > 0 ? projectedRate.toFixed(6) : "0.000000"}
          </p>
          <p className="text-[10px] text-gray-500">{tr("tgeClaim.oaiPerPoint", "OAI / 1 point")}</p>
        </GlassCard>
      </div>

      {forecast && (
        <GlassCard hover={false}>
          <h3 className="font-bold text-white mb-4">{tr("tgeClaim.rangeTitle", "Projected conversion range (min/base/max)")}</h3>
          <div className="grid md:grid-cols-3 gap-3">
            {[
              { key: "min", label: tr("tgeClaim.rangeMin", "Min"), data: forecast.scenarios.min },
              { key: "base", label: tr("tgeClaim.rangeBase", "Base"), data: forecast.scenarios.base },
              { key: "max", label: tr("tgeClaim.rangeMax", "Max"), data: forecast.scenarios.max },
            ].map((row) => (
              <div key={row.key} className="p-3 rounded-xl bg-dark-700/50 border border-dark-500/50">
                <p className="text-xs text-gray-500">{row.label}</p>
                <p className="text-sm text-white mt-1">
                  {tr("tgeClaim.totalPoints", "Total points")}: {row.data.totalPoints.toLocaleString()}
                </p>
                <p className="text-sm text-neon-cyan mt-1">
                  {row.data.oaiPerPoint.toFixed(6)} OAI / 1 point
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {tr("tgeClaim.estimatedOai", "~{amount} OAI", {
                    amount: (userPoints * row.data.oaiPerPoint).toLocaleString(undefined, { maximumFractionDigits: 2 }),
                  })}
                </p>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      <GlassCard hover={false}>
        <h3 className="font-bold text-white mb-2">{tr("tgeClaim.formulaTitle", "Conversion formula")}</h3>
        <p className="text-sm text-gray-300 font-mono break-words">
          {tr("tgeClaim.formulaText", "Your OAI = (YourPoints / TotalPlatformPoints) x {pool} OAI", {
            pool: airdropPool.toLocaleString(),
          })}
        </p>
      </GlassCard>

      <div className="grid md:grid-cols-3 gap-4">
        <GlassCard hover={false}>
          <p className="text-xs text-gray-500">{tr("tgeClaim.totalUsers", "Users")}</p>
          <p className="text-xl font-mono font-bold text-white">{stats.totalUsers.toLocaleString()}</p>
        </GlassCard>
        <GlassCard hover={false}>
          <p className="text-xs text-gray-500">{tr("tgeClaim.totalCheckins", "Check-ins")}</p>
          <p className="text-xl font-mono font-bold text-white">{stats.totalCheckIns.toLocaleString()}</p>
        </GlassCard>
        <GlassCard hover={false}>
          <p className="text-xs text-gray-500">{tr("tgeClaim.totalPredictions", "Predictions")}</p>
          <p className="text-xl font-mono font-bold text-white">{stats.totalPredictions.toLocaleString()}</p>
        </GlassCard>
      </div>

      <GlassCard hover={false}>
        <h3 className="font-bold text-white mb-4">{tr("tgeClaim.pointsAfterTitle", "Points after TGE")}</h3>
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          {[
            tr("tgeClaim.pointsAfter1", "Season leaderboard ranking and reputation level"),
            tr("tgeClaim.pointsAfter2", "Quest access and campaign eligibility"),
            tr("tgeClaim.pointsAfter3", "Non-monetary multipliers for platform progression"),
            tr("tgeClaim.pointsAfter4", "Proof-of-participation for partner rewards"),
          ].map((item) => (
            <div key={item} className="p-3 rounded-xl bg-dark-700/50 border border-dark-500/50 text-gray-300">
              {item}
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard hover={false}>
        <h3 className="font-bold text-white mb-4">{tr("tgeClaim.tokenUtilityTitle", "OAI utility expansion")}</h3>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { icon: "staking", text: tr("tgeClaim.utility1", "Locked staking tiers with higher protocol benefits") },
            { icon: "prediction", text: tr("tgeClaim.utility2", "Premium prediction pools with OAI-based boosts") },
            { icon: "tokenomics", text: tr("tgeClaim.utility3", "Fee discounts and advanced analytics unlocks") },
            { icon: "leaderboard", text: tr("tgeClaim.utility4", "Season reward eligibility gated by OAI activity") },
            { icon: "globe", text: tr("tgeClaim.utility5", "Referral level upgrades for active OAI holders") },
            { icon: "fire", text: tr("tgeClaim.utility6", "Ongoing burn sinks from premium actions and penalties") },
          ].map((x) => (
            <div key={x.text} className="p-3 rounded-xl bg-dark-700/50 border border-dark-500/50 text-sm text-gray-300">
              <div className="mb-2"><AppIcon name={x.icon as any} className="w-5 h-5 text-neon-cyan" /></div>
              {x.text}
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
