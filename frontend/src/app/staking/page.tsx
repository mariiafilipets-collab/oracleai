"use client";

import { useState, useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, formatEther } from "viem";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import GlassCard from "@/components/GlassCard";
import { useContractAddresses } from "@/hooks/useContracts";
import { StakingABI, OAITokenABI } from "@/lib/contracts";
import { useI18n } from "@/lib/i18n";
import AppIcon from "@/components/icons/AppIcon";

const TGE_IS_LIVE = process.env.NEXT_PUBLIC_TGE_IS_LIVE === "true";
const LOCK_PLANS = [
  { days: 30, multiplier: "1.1x", bonus: "+5%" },
  { days: 90, multiplier: "1.25x", bonus: "+10%" },
  { days: 180, multiplier: "1.5x", bonus: "+20%" },
  { days: 365, multiplier: "2.0x", bonus: "+35%" },
];

export default function StakingPage() {
  const { address, isConnected } = useAccount();
  const { t } = useI18n();
  const tr = (key: string, fallback: string, params?: Record<string, string | number>) => {
    const value = t(key, params);
    return value === key ? fallback : value;
  };
  const { addresses } = useContractAddresses();
  const [stakeAmount, setStakeAmount] = useState("");
  const [unstakeAmount, setUnstakeAmount] = useState("");
  const [activeTab, setActiveTab] = useState<"stake" | "unstake">("stake");

  const stakingAddress = addresses?.Staking as `0x${string}` | undefined;
  const tokenAddress = addresses?.OAIToken as `0x${string}` | undefined;

  const { data: stakeInfo } = useReadContract({
    address: stakingAddress,
    abi: StakingABI,
    functionName: "getStakeInfo",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!stakingAddress },
  });

  const { data: totalStaked } = useReadContract({
    address: stakingAddress,
    abi: StakingABI,
    functionName: "totalStaked",
    query: { enabled: !!stakingAddress },
  });

  const { data: tokenBalance } = useReadContract({
    address: tokenAddress,
    abi: OAITokenABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!tokenAddress },
  });

  const { data: allowance } = useReadContract({
    address: tokenAddress,
    abi: OAITokenABI,
    functionName: "allowance",
    args: address && stakingAddress ? [address, stakingAddress] : undefined,
    query: { enabled: !!address && !!tokenAddress && !!stakingAddress },
  });

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isSuccess, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isSuccess) toast.success(t("staking.txConfirmed"));
  }, [isSuccess, t]);

  const handleApprove = () => {
    if (!tokenAddress || !stakingAddress) return;
    writeContract({
      address: tokenAddress,
      abi: OAITokenABI,
      functionName: "approve",
      args: [stakingAddress, parseEther("999999999")],
    });
  };

  const handleStake = () => {
    if (!stakingAddress || !stakeAmount) return;
    writeContract({
      address: stakingAddress,
      abi: StakingABI,
      functionName: "stake",
      args: [parseEther(stakeAmount)],
    });
  };

  const handleRequestUnstake = () => {
    if (!stakingAddress || !unstakeAmount) return;
    writeContract({
      address: stakingAddress,
      abi: StakingABI,
      functionName: "requestUnstake",
      args: [parseEther(unstakeAmount)],
    });
  };

  const handleUnstake = () => {
    if (!stakingAddress) return;
    writeContract({
      address: stakingAddress,
      abi: StakingABI,
      functionName: "unstake",
    });
  };

  const si = stakeInfo as any;
  const stakedAmount = si ? Number(formatEther(BigInt(si.amount ?? si[0] ?? 0))) : 0;
  const unstakeRequestTime = si ? Number(si.unstakeRequestedAt ?? si[2] ?? 0) : 0;
  const pendingUnstake = si ? Number(formatEther(BigInt(si.unstakeAmount ?? si[3] ?? 0))) : 0;
  const totalStakedAmount = totalStaked ? Number(formatEther(BigInt(totalStaked as any))) : 0;
  const balance = tokenBalance ? Number(formatEther(BigInt(tokenBalance as any))) : 0;
  const hasAllowance = allowance ? BigInt(allowance as any) > BigInt(0) : false;
  const cooldownEnd = unstakeRequestTime > 0 ? unstakeRequestTime + 7 * 86400 : 0;
  const canUnstake = cooldownEnd > 0 && Date.now() / 1000 >= cooldownEnd;
  const isTgeLive = TGE_IS_LIVE;
  const getTier = () => {
    if (stakedAmount >= 100000) return { name: t("tokenomicsPage.tiers.diamond"), icon: "diamond", pointsBoost: "+50%", refBoost: "+20%", color: "text-cyan-300" };
    if (stakedAmount >= 10000)  return { name: t("tokenomicsPage.tiers.gold"), icon: "gold", pointsBoost: "+35%", refBoost: "+15%", color: "text-yellow-400" };
    if (stakedAmount >= 1000)   return { name: t("tokenomicsPage.tiers.silver"), icon: "silver", pointsBoost: "+20%", refBoost: "+10%", color: "text-gray-300" };
    if (stakedAmount >= 100)    return { name: t("tokenomicsPage.tiers.bronze"), icon: "bronze", pointsBoost: "+10%", refBoost: "+5%", color: "text-amber-600" };
    return { name: "", icon: "staking", pointsBoost: "0%", refBoost: "0%", color: "text-gray-500" };
  };
  const tier = getTier();
  const hasBoost = stakedAmount >= 100;

  if (!isConnected) {
    return (
      <div className="text-center py-32">
        <p className="text-4xl mb-4 flex justify-center"><AppIcon name="staking" className="w-10 h-10 text-neon-cyan" /></p>
        <p className="text-gray-400 text-lg">{t("staking.connectPrompt")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-bold">
          <span className="gradient-purple">OAI</span>{" "}
          <span className="text-white">{t("nav.staking")}</span>
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          {t("staking.subtitle")}
        </p>
      </div>

      {!isTgeLive && (
        <GlassCard hover={false} className="border border-neon-gold/30 bg-neon-gold/5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-neon-gold text-lg">
                {tr("staking.preTgeTitle", "Staking opens after TGE")}
              </h3>
              <p className="text-sm text-gray-300 mt-1">
                {tr("staking.preTgeDesc", "Collect points now. Convert points to OAI on TGE week, then unlock token staking with lock periods.")}
              </p>
              <p className="text-xs text-gray-500 mt-2">{tr("staking.preTgeEtaTba", "Launch date: TBA")}</p>
            </div>
            <button
              type="button"
              disabled
              className="px-4 py-2 rounded-xl bg-dark-600 text-gray-400 border border-dark-500 text-sm font-bold cursor-not-allowed"
            >
              {tr("staking.availableAfterTge", "Soon after TGE")}
            </button>
          </div>
        </GlassCard>
      )}

      {/* Staking Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassCard hover={false} className="p-4 text-center">
          <div className="text-2xl mb-1 flex justify-center"><AppIcon name={tier.icon as any} className="w-6 h-6" /></div>
          <div className="text-lg font-bold font-mono text-neon-purple">
            {stakedAmount.toLocaleString()} OAI
          </div>
          <div className="text-xs text-gray-500">{t("staking.yourStake")}</div>
        </GlassCard>
        <GlassCard hover={false} className="p-4 text-center">
          <div className="text-2xl mb-1 flex justify-center"><AppIcon name="bank" className="w-6 h-6 text-neon-cyan" /></div>
          <div className="text-lg font-bold font-mono text-neon-cyan">
            {totalStakedAmount.toLocaleString()} OAI
          </div>
          <div className="text-xs text-gray-500">{t("staking.totalStaked")}</div>
        </GlassCard>
        <GlassCard hover={false} className="p-4 text-center">
          <div className="text-2xl mb-1 flex justify-center"><AppIcon name="activity" className="w-6 h-6 text-neon-green" /></div>
          <div className={`text-lg font-bold font-mono ${hasBoost ? "text-neon-green" : "text-gray-500"}`}>
            {tier.pointsBoost}
          </div>
          <div className="text-xs text-gray-500">{t("staking.pointsBoost")}</div>
        </GlassCard>
        <GlassCard hover={false} className="p-4 text-center">
          <div className="text-2xl mb-1 flex justify-center"><AppIcon name="globe" className="w-6 h-6 text-neon-green" /></div>
          <div className={`text-lg font-bold font-mono ${hasBoost ? "text-neon-green" : "text-gray-500"}`}>
            {tier.refBoost}
          </div>
          <div className="text-xs text-gray-500">{t("staking.referralBoost")}</div>
        </GlassCard>
      </div>

      {/* Current Tier */}
      <GlassCard hover={false} glow={hasBoost ? "green" : undefined}>
        <div className="flex items-center gap-4">
          <div className="text-4xl"><AppIcon name={tier.icon as any} className="w-9 h-9" /></div>
          <div>
            <h3 className={`font-bold text-lg ${tier.color}`}>
              {hasBoost ? t("staking.tierActive", { tier: tier.name }) : t("staking.noTier")}
            </h3>
            <p className="text-sm text-gray-400">
              {hasBoost
                ? t("staking.currentBoosts", { points: tier.pointsBoost, referral: tier.refBoost })
                : t("staking.tierHint")}
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Tier Table */}
      <GlassCard hover={false} className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-500">
              <th className="p-3 text-left text-gray-500 text-xs">{t("leaderboard.tier")}</th>
              <th className="p-3 text-center text-gray-500 text-xs">{t("staking.stakeRequired")}</th>
              <th className="p-3 text-center text-gray-500 text-xs">{t("staking.pointsBoost")}</th>
              <th className="p-3 text-center text-gray-500 text-xs">{t("staking.referralBoost")}</th>
            </tr>
          </thead>
          <tbody>
            {[
              { icon: "bronze", n: t("tokenomicsPage.tiers.bronze"), s: tr("staking.rangeBronze", "100 - 999"), p: "+10%", r: "+5%" },
              { icon: "silver", n: t("tokenomicsPage.tiers.silver"), s: tr("staking.rangeSilver", "1,000 - 9,999"), p: "+20%", r: "+10%" },
              { icon: "gold", n: t("tokenomicsPage.tiers.gold"), s: tr("staking.rangeGold", "10,000 - 99,999"), p: "+35%", r: "+15%" },
              { icon: "diamond", n: t("tokenomicsPage.tiers.diamond"), s: tr("staking.rangeDiamond", "100,000+"), p: "+50%", r: "+20%" },
            ].map((t, i) => (
              <tr key={i} className="border-b border-dark-500/50 hover:bg-dark-700/50">
                <td className="p-3 font-bold inline-flex items-center gap-2"><AppIcon name={t.icon as any} className="w-4.5 h-4.5" />{t.n}</td>
                <td className="p-3 text-center font-mono text-gray-300">{t.s} OAI</td>
                <td className="p-3 text-center font-bold text-neon-green">{t.p}</td>
                <td className="p-3 text-center font-bold text-neon-cyan">{t.r}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassCard>

      <GlassCard hover={false}>
        <h3 className="font-bold text-white mb-2">{tr("staking.lockPeriodsTitle", "Lock Periods (post-TGE)")}</h3>
        <p className="text-xs text-gray-500 mb-4">
          {tr("staking.lockPeriodsDesc", "Longer lockups receive stronger multipliers and season bonus weight.")}
        </p>
        <div className="grid md:grid-cols-4 gap-3">
          {LOCK_PLANS.map((plan) => (
            <div key={plan.days} className="p-3 rounded-xl bg-dark-700/50 border border-dark-500/50">
              <p className="text-xs text-gray-500">
                {tr("staking.lockDays", "{days}d", { days: plan.days })}
              </p>
              <p className="text-lg font-mono font-bold text-neon-cyan">{plan.multiplier}</p>
              <p className="text-sm text-neon-green">{tr("staking.pointsBonus", "Points bonus")} {plan.bonus}</p>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Stake/Unstake Form */}
      <GlassCard hover={false}>
        <div className="flex gap-2 mb-6">
          {(["stake", "unstake"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${
                activeTab === tab
                  ? "bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30"
                  : "bg-dark-700 text-gray-400 border border-dark-500"
              }`}
            >
              {tab === "stake" ? (
                <span className="inline-flex items-center gap-1"><AppIcon name="diamond" className="w-4 h-4" /> {t("staking.stakeTab")}</span>
              ) : (
                <span className="inline-flex items-center gap-1"><AppIcon name="send" className="w-4 h-4" /> {t("staking.unstakeTab")}</span>
              )}
            </button>
          ))}
        </div>

        {activeTab === "stake" ? (
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-400">{t("staking.amountToStake")}</span>
                <span className="text-gray-500">{t("staking.balance")}: {balance.toLocaleString()} OAI</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  placeholder="0.0"
                  className="flex-1 px-4 py-3 rounded-xl bg-dark-700 border border-dark-500 font-mono focus:border-neon-cyan/50 outline-none"
                />
                <button
                  onClick={() => setStakeAmount(balance.toString())}
                  className="px-4 py-3 rounded-xl bg-dark-600 text-xs text-gray-400 hover:text-white transition"
                >
                  {t("common.max")}
                </button>
              </div>
            </div>

            {!hasAllowance ? (
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleApprove}
                disabled={!isTgeLive || isPending || isConfirming}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-neon-purple to-neon-cyan text-dark-900 font-bold disabled:opacity-50"
              >
                {!isTgeLive
                  ? tr("staking.availableAfterTge", "Soon after TGE")
                  : isPending || isConfirming
                    ? t("staking.approving")
                    : t("staking.approveOai")}
              </motion.button>
            ) : (
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleStake}
                disabled={!isTgeLive || isPending || isConfirming || !stakeAmount}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-neon-cyan to-neon-purple text-dark-900 font-bold disabled:opacity-50"
              >
                {!isTgeLive
                  ? tr("staking.availableAfterTge", "Soon after TGE")
                  : isPending || isConfirming
                    ? t("staking.staking")
                    : t("staking.stakeOai")}
              </motion.button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {pendingUnstake > 0 ? (
              <div className="p-4 rounded-xl bg-neon-gold/10 border border-neon-gold/30">
                <p className="text-sm text-neon-gold font-bold mb-2">
                  {t("staking.unstakePending")}: {pendingUnstake.toLocaleString()} OAI
                </p>
                <p className="text-xs text-gray-400">
                  {canUnstake
                    ? t("staking.cooldownComplete")
                    : `${t("staking.cooldownEnds")}: ${new Date(cooldownEnd * 1000).toLocaleString()}`}
                </p>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleUnstake}
                  disabled={!isTgeLive || !canUnstake || isPending || isConfirming}
                  className={`mt-3 w-full py-3 rounded-xl font-bold text-sm ${
                    isTgeLive && canUnstake
                      ? "bg-neon-green/20 text-neon-green border border-neon-green/30"
                      : "bg-dark-600 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  {!isTgeLive
                    ? tr("staking.availableAfterTge", "Soon after TGE")
                    : isPending || isConfirming
                      ? t("checkin.processing")
                      : canUnstake
                        ? t("staking.claimUnstake")
                        : t("staking.cooldown")}
                </motion.button>
              </div>
            ) : (
              <>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-400">{t("staking.amountToUnstake")}</span>
                    <span className="text-gray-500">{t("staking.staked")}: {stakedAmount.toLocaleString()} OAI</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={unstakeAmount}
                      onChange={(e) => setUnstakeAmount(e.target.value)}
                      placeholder="0.0"
                      className="flex-1 px-4 py-3 rounded-xl bg-dark-700 border border-dark-500 font-mono focus:border-neon-cyan/50 outline-none"
                    />
                    <button
                      onClick={() => setUnstakeAmount(stakedAmount.toString())}
                      className="px-4 py-3 rounded-xl bg-dark-600 text-xs text-gray-400 hover:text-white transition"
                    >
                      {t("common.max")}
                    </button>
                  </div>
                </div>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleRequestUnstake}
                  disabled={!isTgeLive || isPending || isConfirming || !unstakeAmount}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold disabled:opacity-50"
                >
                  {!isTgeLive
                    ? tr("staking.availableAfterTge", "Soon after TGE")
                    : isPending || isConfirming
                      ? t("checkin.processing")
                      : t("staking.requestUnstake")}
                </motion.button>
              </>
            )}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
