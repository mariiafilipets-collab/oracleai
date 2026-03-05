"use client";

import { motion } from "framer-motion";
import GlassCard from "@/components/GlassCard";
import { useI18n } from "@/lib/i18n";
import AppIcon from "@/components/icons/AppIcon";

const S = ({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) => (
  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
    {children}
  </motion.div>
);

export default function LitepaperPage() {
  const { t } = useI18n();
  const tr = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };
  return (
    <div className="max-w-4xl mx-auto space-y-10 pb-20">
      {/* Title */}
      <S>
        <div className="text-center py-10">
          <h1 className="text-4xl lg:text-5xl font-heading font-bold mb-4">
            <span className="bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-gold bg-clip-text text-transparent">
              OracleAI Predict
            </span>
          </h1>
          <p className="text-xl text-gray-400">{t("litepaperPage.subtitle")}</p>
          <p className="text-sm text-gray-600 mt-2">{t("litepaperPage.chainDesc")}</p>
        </div>
      </S>

      {/* Vision */}
      <S delay={0.1}>
        <GlassCard hover={false}>
          <h2 className="text-2xl font-heading font-bold mb-4 gradient-cyan inline-block">1. {t("litepaperPage.vision")}</h2>
          <p className="text-gray-300 leading-relaxed mb-4">
            {t("litepaperPage.visionP1")}
          </p>
          <p className="text-gray-300 leading-relaxed">
            {t("litepaperPage.visionP2")}
          </p>
        </GlassCard>
      </S>

      {/* Problem */}
      <S delay={0.15}>
        <GlassCard hover={false}>
          <h2 className="text-2xl font-heading font-bold mb-4 gradient-cyan inline-block">2. {t("litepaperPage.problem")}</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {[1, 2, 3].map((p, i) => (
              <div key={i} className="p-4 rounded-xl bg-dark-700/50 border border-neon-red/20">
                <h3 className="text-sm font-bold text-neon-red mb-2">{t(`litepaperPage.problemItems.${p}.title`)}</h3>
                <p className="text-xs text-gray-400">{t(`litepaperPage.problemItems.${p}.desc`)}</p>
              </div>
            ))}
          </div>
        </GlassCard>
      </S>

      {/* Solution */}
      <S delay={0.2}>
        <GlassCard hover={false}>
          <h2 className="text-2xl font-heading font-bold mb-4 gradient-cyan inline-block">3. {t("litepaperPage.solution")}</h2>
          <p className="text-gray-300 leading-relaxed mb-6">
            {t("litepaperPage.solutionIntro")}
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { icon: "brain", key: "aiGeneration" },
              { icon: "search", key: "aiVerification" },
              { icon: "gamepad", key: "gamification" },
              { icon: "chain", key: "onchain" },
            ].map((s, i) => (
              <div key={i} className="p-4 rounded-xl bg-dark-700/50 border border-dark-500/50">
                <div className="text-2xl mb-2"><AppIcon name={s.icon as any} className="w-6 h-6 text-neon-cyan" /></div>
                <h3 className="text-sm font-bold text-white mb-1">{t(`litepaperPage.solutionItems.${s.key}.title`)}</h3>
                <p className="text-xs text-gray-400">{t(`litepaperPage.solutionItems.${s.key}.desc`)}</p>
              </div>
            ))}
          </div>
        </GlassCard>
      </S>

      {/* How It Works */}
      <S delay={0.25}>
        <GlassCard hover={false}>
          <h2 className="text-2xl font-heading font-bold mb-6 gradient-cyan inline-block">4. {t("litepaperPage.howItWorks")}</h2>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((s, i) => (
              <div key={i} className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-neon-cyan to-neon-purple flex items-center justify-center text-dark-900 font-bold shrink-0">
                  {s}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{t(`litepaperPage.howItems.${s}.title`)}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{t(`litepaperPage.howItems.${s}.desc`)}</p>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </S>

      {/* Tokenomics */}
      <S delay={0.3}>
        <GlassCard hover={false}>
          <h2 className="text-2xl font-heading font-bold mb-4 gradient-gold inline-block">5. {t("litepaperPage.tokenomics")}</h2>
          <p className="text-gray-400 text-sm mb-6">{t("litepaperPage.tokenSupply")}</p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-bold text-white mb-3">{t("litepaperPage.tokenAllocation")}</h3>
              <div className="space-y-2">
                {[
                  { key: "airdrop", pct: "40%" },
                  { key: "liquidity", pct: "15%" },
                  { key: "team", pct: "12%" },
                  { key: "treasury", pct: "10%" },
                  { key: "stakingRewards", pct: "10%" },
                  { key: "prizePool", pct: "5%" },
                  { key: "referral", pct: "3%" },
                  { key: "marketing", pct: "3%" },
                  { key: "ecosystem", pct: "2%" },
                ].map((row, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-dark-700/50">
                    <span className="text-gray-300">{t(`tokenomicsPage.alloc.${row.key}.name`)}</span>
                    <div className="text-right">
                      <span className="font-mono font-bold text-neon-cyan">{row.pct}</span>
                      <span className="text-gray-600 ml-2">{t(`litepaperPage.allocDetail.${row.key}`)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-white mb-3">{t("litepaperPage.feeDistribution")}</h3>
              <div className="space-y-2 mb-6">
                {[
                  { key: "prizes", pct: "50%", icon: "leaderboard" },
                  { key: "treasury", pct: "15%", icon: "bank" },
                  { key: "referrals", pct: "20%", icon: "globe" },
                  { key: "burn", pct: "10%", icon: "fire" },
                  { key: "stakers", pct: "5%", icon: "diamond" },
                ].map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-dark-700/50">
                    <span className="text-gray-300 inline-flex items-center gap-1"><AppIcon name={f.icon as any} className="w-3.5 h-3.5" /> {t(`checkin.fees.${f.key}`)}</span>
                    <span className="font-mono font-bold text-neon-gold">{f.pct}</span>
                  </div>
                ))}
              </div>

              <h3 className="text-sm font-bold text-white mb-3">{t("litepaperPage.deflation")}</h3>
              <ul className="text-xs text-gray-400 space-y-1">
                {[1, 2, 3, 4].map((i) => (
                  <li key={i}>- {t(`litepaperPage.deflationItems.${i}`)}</li>
                ))}
              </ul>
            </div>
          </div>
        </GlassCard>
      </S>

      {/* Staking Tiers */}
      <S delay={0.35}>
        <GlassCard hover={false}>
          <h2 className="text-2xl font-heading font-bold mb-4 gradient-cyan inline-block">6. {t("litepaperPage.stakingTiers")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-500">
                  <th className="p-3 text-left text-gray-500">{t("leaderboard.tier")}</th>
                  <th className="p-3 text-center text-gray-500">{t("litepaperPage.oaiRequired")}</th>
                  <th className="p-3 text-center text-gray-500">{t("staking.pointsBoost")}</th>
                  <th className="p-3 text-center text-gray-500">{t("staking.referralBoost")}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { key: "bronze", icon: "bronze", req: "100 - 999", pts: "+10%", ref: "+5%" },
                  { key: "silver", icon: "silver", req: "1,000 - 9,999", pts: "+20%", ref: "+10%" },
                  { key: "gold", icon: "gold", req: "10,000 - 99,999", pts: "+35%", ref: "+15%" },
                  { key: "diamond", icon: "diamond", req: "100,000+", pts: "+50%", ref: "+20%" },
                ].map((tier, i) => (
                  <tr key={i} className="border-b border-dark-500/50">
                    <td className="p-3 font-bold text-white inline-flex items-center gap-2"><AppIcon name={tier.icon as any} className="w-4.5 h-4.5" /> {t(`tokenomicsPage.tiers.${tier.key}`)}</td>
                    <td className="p-3 text-center font-mono text-gray-300">{tier.req}</td>
                    <td className="p-3 text-center font-bold text-neon-green">{tier.pts}</td>
                    <td className="p-3 text-center font-bold text-neon-cyan">{tier.ref}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </S>

      {/* Roadmap */}
      <S delay={0.4}>
        <GlassCard hover={false}>
          <h2 className="text-2xl font-heading font-bold mb-6 gradient-gold inline-block">7. {t("litepaperPage.roadmap")}</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { q: "Q1", key: "q1", count: 4 },
              { q: "Q2", key: "q2", count: 5 },
              { q: "Q3", key: "q3", count: 5 },
              { q: "Q4", key: "q4", count: 5 },
            ].map((r, i) => (
              <div key={i} className="p-5 rounded-xl bg-dark-700/50 border border-dark-500/50">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-1 rounded-lg bg-neon-cyan/20 text-neon-cyan text-xs font-bold">{r.q}</span>
                  <h3 className="text-sm font-bold text-white">{t(`litepaperPage.roadmapItems.${r.key}.title`)}</h3>
                </div>
                <ul className="space-y-1.5">
                  {Array.from({ length: r.count }, (_, j) => j + 1).map((j) => (
                    <li key={j} className="text-xs text-gray-400 flex items-start gap-2">
                      <span className="text-neon-cyan mt-0.5">-</span> {t(`litepaperPage.roadmapItems.${r.key}.items.${j}`)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </GlassCard>
      </S>

      {/* TGE Conversion */}
      <S delay={0.43}>
        <GlassCard hover={false}>
          <h2 className="text-2xl font-heading font-bold mb-4 gradient-cyan inline-block">
            8. {tr("litepaperPage.tgeUtilityTitle", "TGE Conversion & Post-TGE Utility")}
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-dark-700/50 border border-dark-500/50">
              <h3 className="text-sm font-bold text-white mb-2">{tr("litepaperPage.pointsToOaiTitle", "Points to OAI conversion")}</h3>
              <p className="text-xs text-gray-400">
                {tr("litepaperPage.pointsToOaiDesc", "During TGE week, conversion is calculated from a transparent snapshot formula:")}
                <span className="block mt-2 font-mono text-gray-300">
                  {tr("litepaperPage.pointsToOaiFormula", "Your OAI = (YourPoints / TotalPoints) x AirdropPool")}
                </span>
              </p>
            </div>
            <div className="p-4 rounded-xl bg-dark-700/50 border border-dark-500/50">
              <h3 className="text-sm font-bold text-white mb-2">{tr("litepaperPage.pointsAfterTgeTitle", "Points after TGE")}</h3>
              <p className="text-xs text-gray-400">
                {tr(
                  "litepaperPage.pointsAfterTgeDesc",
                  "Points remain as a seasonal reputation layer for leaderboards, quests, campaign eligibility, and partner incentives."
                )}
              </p>
            </div>
          </div>
        </GlassCard>
      </S>

      {/* Creator Economy */}
      <S delay={0.44}>
        <GlassCard hover={false}>
          <h2 className="text-2xl font-heading font-bold mb-4 gradient-cyan inline-block">
            9. {tr("litepaperPage.creatorEconomyTitle", "Creator Economy (Variant C)")}
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-dark-700/50 border border-dark-500/50">
              <h3 className="text-sm font-bold text-white mb-2">{tr("litepaperPage.creatorEconomyFlowTitle", "How the flow works")}</h3>
              <ul className="text-xs text-gray-400 space-y-1">
                <li>- {tr("litepaperPage.creatorEconomyFlow1", "User event creation keeps fixed listing fee for anti-spam.")}</li>
                <li>- {tr("litepaperPage.creatorEconomyFlow2", "Each vote on user events pays a small vote fee.")}</li>
                <li>- {tr("litepaperPage.creatorEconomyFlow3", "Vote fee splits into creator side and protocol side.")}</li>
                <li>- {tr("litepaperPage.creatorEconomyFlow4", "Protocol side follows the same treasury/prize/referral/burn/staking logic.")}</li>
                <li>- {tr("litepaperPage.creatorEconomyFlow5", "Protocol-side fee distribution is executed in 12-hour batches to reduce gas overhead per vote.")}</li>
              </ul>
            </div>
            <div className="p-4 rounded-xl bg-dark-700/50 border border-dark-500/50">
              <h3 className="text-sm font-bold text-white mb-2">{tr("litepaperPage.creatorEconomyQualityTitle", "Quality and anti-abuse gates")}</h3>
              <ul className="text-xs text-gray-400 space-y-1">
                <li>- {tr("litepaperPage.creatorEconomyQuality1", "Creator payout is claimable only after event is resolved.")}</li>
                <li>- {tr("litepaperPage.creatorEconomyQuality2", "Minimum voter threshold must be reached.")}</li>
                <li>- {tr("litepaperPage.creatorEconomyQuality3", "Creator must hold verified creator status at payout time.")}</li>
                <li>- {tr("litepaperPage.creatorEconomyQuality4", "If conditions fail, creator-side fee is redirected to protocol safety treasury.")}</li>
              </ul>
            </div>
          </div>
        </GlassCard>
      </S>

      {/* Links */}
      <S delay={0.45}>
        <div className="text-center py-8">
          <p className="text-gray-500 text-sm mb-4">
            {t("litepaperPage.footerTagline")}
          </p>
          <div className="flex justify-center gap-4 text-xs">
            <a href="/tokenomics" className="text-neon-cyan hover:underline">{t("litepaperPage.fullTokenomics")}</a>
            <span className="text-dark-500">|</span>
            <a href="/predictions" className="text-neon-cyan hover:underline">{t("litepaperPage.startPredicting")}</a>
            <span className="text-dark-500">|</span>
            <a href="/" className="text-neon-cyan hover:underline">{t("nav.home")}</a>
          </div>
        </div>
      </S>
    </div>
  );
}
