"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { formatEther } from "viem";
import GlassCard from "@/components/GlassCard";
import { useI18n } from "@/lib/i18n";
import AppIcon from "@/components/icons/AppIcon";
import { api } from "@/lib/api";

const TOKEN_ALLOC = [
  { key: "airdrop", pct: 40, amount: "400M", color: "bg-neon-cyan" },
  { key: "liquidity", pct: 15, amount: "150M", color: "bg-blue-500" },
  { key: "team", pct: 12, amount: "120M", color: "bg-neon-purple" },
  { key: "treasury", pct: 10, amount: "100M", color: "bg-emerald-500" },
  { key: "stakingRewards", pct: 10, amount: "100M", color: "bg-neon-gold" },
  { key: "prizePool", pct: 5, amount: "50M", color: "bg-orange-500" },
  { key: "referral", pct: 3, amount: "30M", color: "bg-green-500" },
  { key: "marketing", pct: 3, amount: "30M", color: "bg-pink-500" },
  { key: "ecosystem", pct: 2, amount: "20M", color: "bg-indigo-500" },
];

const FEE_SPLIT = [
  { icon: "leaderboard", pct: 50 }, { icon: "bank", pct: 15 }, { icon: "globe", pct: 20 },
  { icon: "fire", pct: 10 }, { icon: "diamond", pct: 5 },
];
const FEE_KEYS = ["prizes", "treasury", "referrals", "burn", "stakers"];

const STAKING_TIERS = [
  { icon: "bronze", min: "100", max: "999", pts: "+10%", ref: "+5%", color: "from-amber-700 to-amber-900" },
  { icon: "silver", min: "1,000", max: "9,999", pts: "+20%", ref: "+10%", color: "from-gray-300 to-gray-500" },
  { icon: "gold", min: "10,000", max: "99,999", pts: "+35%", ref: "+15%", color: "from-yellow-400 to-yellow-600" },
  { icon: "diamond", min: "100,000", max: "∞", pts: "+50%", ref: "+20%", color: "from-cyan-300 to-blue-500" },
];
const TIER_KEYS = ["bronze", "silver", "gold", "diamond"];

export default function TokenomicsPage() {
  const { t } = useI18n();
  const [voteFeesBnb, setVoteFeesBnb] = useState(0);
  const tr = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  useEffect(() => {
    api.getStats()
      .then((res) => {
        if (!res?.success) return;
        const raw = BigInt(String(res?.data?.totalVoteFeesCollected || "0"));
        setVoteFeesBnb(Number(formatEther(raw)));
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl lg:text-4xl font-heading font-bold mb-2">
          <span className="gradient-gold">$OAI</span>{" "}
          <span className="text-white">{t("tokenomicsPage.title")}</span>
        </h1>
        <p className="text-gray-400">{t("tokenomicsPage.supply")}</p>
      </motion.div>

      {/* Token Allocation */}
      <GlassCard hover={false}>
        <h2 className="text-xl font-heading font-bold mb-6">{t("tokenomicsPage.allocation")}</h2>
        <div className="flex h-8 rounded-full overflow-hidden mb-6">
          {TOKEN_ALLOC.map((tok, i) => (
            <motion.div key={i} initial={{ width: 0 }} animate={{ width: `${tok.pct}%` }} transition={{ duration: 0.8, delay: i * 0.1 }} className={`${tok.color} relative group cursor-pointer`}>
              {tok.pct >= 5 && <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-dark-900">{tok.pct}%</span>}
            </motion.div>
          ))}
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {TOKEN_ALLOC.map((tok, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-dark-700/50 border border-dark-500/50">
              <div className={`w-3 h-3 rounded-full ${tok.color} mt-1 shrink-0`} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{t(`tokenomicsPage.alloc.${tok.key}.name`)}</span>
                  <span className="text-xs font-mono text-gray-500">{tok.pct}% · {tok.amount}</span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{t(`tokenomicsPage.alloc.${tok.key}.desc`)}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Fee Distribution */}
      <GlassCard hover={false}>
        <h2 className="text-xl font-heading font-bold mb-2">{t("tokenomicsPage.feeDistribution")}</h2>
        <p className="text-sm text-gray-500 mb-6">{t("tokenomicsPage.feeDesc")}</p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {FEE_SPLIT.map((f, i) => (
            <div key={i} className="text-center p-4 rounded-xl bg-dark-700/50 border border-dark-500/50">
              <div className="text-3xl mb-2 flex justify-center"><AppIcon name={f.icon as any} className="w-7 h-7 text-neon-cyan" /></div>
              <div className="text-2xl font-bold font-mono text-neon-cyan">{f.pct}%</div>
              <div className="text-sm font-bold text-white mt-1">{t(`checkin.fees.${FEE_KEYS[i]}`)}</div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Voting Fees and Points */}
      <GlassCard hover={false}>
        <h2 className="text-xl font-heading font-bold mb-2">
          {tr("tokenomicsPage.votingFees.title", "Voting Fees and Points")}
        </h2>
        <p className="text-sm text-gray-500 mb-6">
          {tr("tokenomicsPage.votingFees.desc", "Voting uses tiered BNB fees and dynamic point multipliers.")}
        </p>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="p-4 rounded-xl bg-dark-700/50 border border-dark-500/50">
            <h3 className="text-sm font-bold text-white mb-2">{tr("tokenomicsPage.votingFees.tiersTitle", "Vote tiers")}</h3>
            <ul className="text-xs text-gray-400 space-y-1">
              <li>- Basic: 0.00015 BNB (x1)</li>
              <li>- Pro: 0.005 BNB (x3)</li>
              <li>- Whale: 0.05+ BNB (no limit)</li>
            </ul>
          </div>
          <div className="p-4 rounded-xl bg-dark-700/50 border border-dark-500/50">
            <h3 className="text-sm font-bold text-white mb-2">{tr("tokenomicsPage.votingFees.formulaTitle", "Formula")}</h3>
            <ul className="text-xs text-gray-400 space-y-1">
              <li>- Whale multiplier = 10 * sqrt(amount / 0.05)</li>
              <li>- Base vote points scale by tier multiplier</li>
              <li>- Correct prediction bonus: +100% (x2)</li>
            </ul>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-4">
          {tr("tokenomicsPage.votingFees.distribution", "All vote fees follow check-in distribution: 50% prizes, 15% treasury, 20% referrals, 10% burn reserve, 5% staking rewards.")}
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <div className="p-4 rounded-xl bg-dark-700/50 border border-dark-500/50">
            <div className="text-xs text-gray-500 mb-1">{tr("tokenomicsPage.votingFees.collected", "Vote fees collected (on-chain)")}</div>
            <div className="text-lg font-mono text-neon-cyan">{voteFeesBnb.toFixed(6)} BNB</div>
          </div>
          <div className="p-4 rounded-xl bg-dark-700/50 border border-dark-500/50">
            <div className="text-xs text-gray-500 mb-1">{tr("tokenomicsPage.votingFees.distributed", "Vote fees distributed (on-chain)")}</div>
            <div className="text-lg font-mono text-neon-gold">{voteFeesBnb.toFixed(6)} BNB</div>
            <div className="text-[11px] text-gray-500 mt-1">
              {tr("tokenomicsPage.votingFees.distributedHint", "Distribution is applied immediately on each vote transaction.")}
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Creator Economy */}
      <GlassCard hover={false}>
        <h2 className="text-xl font-heading font-bold mb-2">
          {tr("tokenomicsPage.creatorEconomy.title", "Creator Economy")}
        </h2>
        <p className="text-sm text-gray-500 mb-6">
          {tr(
            "tokenomicsPage.creatorEconomy.desc",
            "User-created events use a hybrid model: small vote fee, quality gating, and delayed creator payout."
          )}
        </p>
        <div className="grid md:grid-cols-2 gap-3">
          {[
            {
              icon: "prediction",
              title: tr("tokenomicsPage.creatorEconomy.voteFeeTitle", "Vote fee on user events"),
              desc: tr("tokenomicsPage.creatorEconomy.voteFeeDesc", "Each vote on a user event pays a small BNB fee."),
            },
            {
              icon: "pool",
              title: tr("tokenomicsPage.creatorEconomy.splitTitle", "50/50 split"),
              desc: tr("tokenomicsPage.creatorEconomy.splitDesc", "50% accrues for creator rewards, 50% goes to protocol distribution."),
            },
            {
              icon: "check",
              title: tr("tokenomicsPage.creatorEconomy.unlockTitle", "Quality unlock"),
              desc: tr(
                "tokenomicsPage.creatorEconomy.unlockDesc",
                "Creator payout unlocks only after valid resolution, minimum unique voter threshold, and verified creator status."
              ),
            },
            {
              icon: "bank",
              title: tr("tokenomicsPage.creatorEconomy.protocolTitle", "Protocol side mirrors check-in"),
              desc: tr(
                "tokenomicsPage.creatorEconomy.protocolDesc",
                "Protocol share keeps the same allocation logic: prizes, treasury, referrals, burn reserve, and staking rewards."
              ),
            },
            {
              icon: "clock",
              title: tr("tokenomicsPage.creatorEconomy.batchTitle", "12h batched distribution"),
              desc: tr(
                "tokenomicsPage.creatorEconomy.batchDesc",
                "Protocol-side fees from user-event votes are distributed in 12-hour batches to reduce per-vote gas overhead."
              ),
            },
          ].map((item, idx) => (
            <div key={idx} className="flex items-start gap-3 p-4 rounded-xl bg-dark-700/50 border border-dark-500/50">
              <div className="text-neon-cyan"><AppIcon name={item.icon as any} className="w-5 h-5" /></div>
              <div>
                <h3 className="text-sm font-bold text-white">{item.title}</h3>
                <p className="text-xs text-gray-400 mt-1">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Staking Tiers */}
      <GlassCard hover={false}>
        <h2 className="text-xl font-heading font-bold mb-2">{t("tokenomicsPage.stakingTiers")}</h2>
        <p className="text-sm text-gray-500 mb-6">{t("tokenomicsPage.stakingDesc")}</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {STAKING_TIERS.map((tier, i) => (
            <div key={i} className="relative overflow-hidden rounded-2xl border border-dark-500">
              <div className={`h-2 bg-gradient-to-r ${tier.color}`} />
              <div className="p-5 text-center">
                <div className="text-4xl mb-2 flex justify-center"><AppIcon name={tier.icon as any} className="w-9 h-9 text-neon-cyan" /></div>
                <h3 className="text-lg font-bold text-white">{t(`tokenomicsPage.tiers.${TIER_KEYS[i]}`)}</h3>
                <p className="text-xs text-gray-500 mt-1 font-mono">{tier.min} - {tier.max} OAI</p>
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">{t("staking.pointsBoost")}</span>
                    <span className="font-bold text-neon-green">{tier.pts}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">{t("staking.referralBoost")}</span>
                    <span className="font-bold text-neon-cyan">{tier.ref}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Deflation */}
      <GlassCard hover={false}>
        <h2 className="text-xl font-heading font-bold mb-2">{t("tokenomicsPage.deflation")}</h2>
        <p className="text-sm text-gray-500 mb-6">{t("tokenomicsPage.deflationDesc")}</p>
        <div className="grid md:grid-cols-2 gap-3">
          {[
            { icon: "fire", key: "buyback" },
            { icon: "downtrend", key: "quarterly" },
            { icon: "lock", key: "stakingLocks" },
            { icon: "hourglass", key: "vestingLocks" },
          ].map((d, i) => (
            <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-dark-700/50 border border-dark-500/50">
              <span className="text-2xl"><AppIcon name={d.icon as any} className="w-6 h-6 text-neon-cyan" /></span>
              <div>
                <h3 className="text-sm font-bold text-white">{t(`tokenomicsPage.deflationItems.${d.key}.title`)}</h3>
                <p className="text-xs text-gray-400 mt-1">{t(`tokenomicsPage.deflationItems.${d.key}.desc`)}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Utility Expansion */}
      <GlassCard hover={false}>
        <h2 className="text-xl font-heading font-bold mb-2">{tr("tokenomicsPage.utilityTitle", "Token Utility Expansion")}</h2>
        <p className="text-sm text-gray-500 mb-6">{tr("tokenomicsPage.utilityDesc", "OAI should stay useful after TGE through access, boosts, discounts, and sink mechanics.")}</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { icon: "staking", title: tr("tokenomicsPage.utility.stakingLocks.title", "Locked Staking"), desc: tr("tokenomicsPage.utility.stakingLocks.desc", "30/90/180/365 day locks with stronger multipliers and benefits.") },
            { icon: "prediction", title: tr("tokenomicsPage.utility.premiumPools.title", "Premium Prediction Pools"), desc: tr("tokenomicsPage.utility.premiumPools.desc", "Higher-stake pools and advanced mechanics unlocked by OAI activity.") },
            { icon: "tokenomics", title: tr("tokenomicsPage.utility.feeDiscounts.title", "Fee Discounts"), desc: tr("tokenomicsPage.utility.feeDiscounts.desc", "Protocol fee discounts for users staking and holding OAI.") },
            { icon: "leaderboard", title: tr("tokenomicsPage.utility.seasonAccess.title", "Season Reward Access"), desc: tr("tokenomicsPage.utility.seasonAccess.desc", "Season campaigns and payouts can require OAI engagement thresholds.") },
            { icon: "globe", title: tr("tokenomicsPage.utility.referralTiers.title", "Referral Tier Upgrades"), desc: tr("tokenomicsPage.utility.referralTiers.desc", "Expanded referral capabilities for committed OAI users.") },
            { icon: "fire", title: tr("tokenomicsPage.utility.burnSinks.title", "Burn Sinks"), desc: tr("tokenomicsPage.utility.burnSinks.desc", "Premium actions and penalties feed recurring buyback/burn pressure.") },
          ].map((u, i) => (
            <div key={i} className="p-4 rounded-xl bg-dark-700/50 border border-dark-500/50">
              <div className="mb-2"><AppIcon name={u.icon as any} className="w-5 h-5 text-neon-cyan" /></div>
              <h3 className="text-sm font-bold text-white">{u.title}</h3>
              <p className="text-xs text-gray-400 mt-1">{u.desc}</p>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Key Metrics */}
      <GlassCard hover={false}>
        <h2 className="text-xl font-heading font-bold mb-4">{t("tokenomicsPage.keyMetrics")}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { key: "maxSupply", value: "1B OAI" },
            { key: "tgeCirculating", value: "~150M" },
            { key: "preTgeGoal", value: "$4-15M" },
            { key: "teamVesting", value: "2 years" },
          ].map((m, i) => (
            <div key={i} className="text-center p-4 rounded-xl bg-dark-700/50 border border-dark-500/50">
              <div className="text-lg font-bold font-mono text-neon-gold">{m.value}</div>
              <div className="text-sm font-bold text-white mt-1">{t(`tokenomicsPage.metrics.${m.key}`)}</div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
