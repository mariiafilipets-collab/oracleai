import { Router } from "express";
import { ethers } from "ethers";
import User from "../models/User.js";
import CheckInRecord from "../models/CheckInRecord.js";
import PredictionEvent from "../models/PredictionEvent.js";
import { getContracts, getSigner } from "../services/blockchain.service.js";
import config from "../config/index.js";

const router = Router();
const SYSTEM_REFERRAL_CODE = "ORACLEAI";
const CHAIN_READ_TIMEOUT_MS = 8000;
const ADDRESS_RE = /^0x[a-f0-9]{40}$/i;

// Validate :address param on all routes that use it
router.param("address", (req, res, next, value) => {
  if (!ADDRESS_RE.test(value)) {
    return res.status(400).json({ success: false, error: "Invalid address format" });
  }
  next();
});

async function withTimeout(promise, timeoutMs = CHAIN_READ_TIMEOUT_MS) {
  return await Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("chain-read-timeout")), timeoutMs)),
  ]);
}

function buildReferralCode(address) {
  return String(address || "").toLowerCase().slice(2, 10).toUpperCase();
}

function parseReferralAttribution(input) {
  const src = String(input?.utmSource || "").trim().slice(0, 64);
  const med = String(input?.utmMedium || "").trim().slice(0, 64);
  const camp = String(input?.utmCampaign || "").trim().slice(0, 96);
  const content = String(input?.utmContent || "").trim().slice(0, 96);
  const landingPath = String(input?.landingPath || "").trim().slice(0, 256);
  const eventIdRaw = Number(input?.eventId || 0);
  const eventId = Number.isFinite(eventIdRaw) && eventIdRaw > 0 ? eventIdRaw : null;
  if (!src && !camp && !eventId) return null;
  return {
    utmSource: src,
    utmMedium: med,
    utmCampaign: camp,
    utmContent: content,
    eventId,
    landingPath,
    attributedAt: new Date(),
  };
}

async function ensureSystemReferrerUser() {
  const signer = getSigner();
  if (!signer) return null;
  const systemAddress = (await signer.getAddress()).toLowerCase();
  await User.findOneAndUpdate(
    { address: systemAddress },
    {
      $set: { referralCode: SYSTEM_REFERRAL_CODE },
      $setOnInsert: { address: systemAddress, joinedAt: new Date() },
    },
    { upsert: true }
  );
  return User.findOne({ address: systemAddress });
}

function isBadContractDataError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("could not decode result data") || msg.includes("bad_data");
}

function isAccessControlError(err) {
  const msg = String(err?.message || err || "");
  return msg.includes("AccessControlUnauthorizedAccount") || msg.includes("missing role");
}

async function readPredictionValueNoArgs(prediction, fragment, methodName, fallback) {
  try {
    if (typeof prediction?.[methodName] === "function") {
      return await prediction[methodName]();
    }
  } catch {}
  try {
    const provider = prediction?.runner?.provider;
    const to = prediction?.target || prediction?.address;
    if (!provider || !to) return fallback;
    const iface = new ethers.Interface([fragment]);
    const data = iface.encodeFunctionData(methodName, []);
    const raw = await withTimeout(provider.call({ to, data }));
    const decoded = iface.decodeFunctionResult(methodName, raw);
    return decoded?.[0] ?? fallback;
  } catch {
    return fallback;
  }
}

router.get("/:address/referral-stats", async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const directRefs = await User.find({ referrer: address })
      .select("address joinedAt totalPoints weeklyPoints totalCheckIns tier referralAttribution")
      .sort({ joinedAt: -1 })
      .lean();

    let frontier = [address];
    const seen = new Set([address]);
    const levels = [];

    for (let level = 1; level <= 6; level++) {
      if (!frontier.length) {
        levels.push({ level, count: 0 });
        continue;
      }

      const rows = await User.find({ referrer: { $in: frontier } })
        .select("address")
        .lean();
      const next = [];
      for (const row of rows) {
        const a = row.address?.toLowerCase();
        if (!a || seen.has(a)) continue;
        seen.add(a);
        next.push(a);
      }
      levels.push({ level, count: next.length });
      frontier = next;
    }

    const directAddresses = directRefs.map((u) => u.address);
    let activeDirect7d = 0;
    if (directAddresses.length > 0) {
      const activeRows = await CheckInRecord.aggregate([
        { $match: { address: { $in: directAddresses }, timestamp: { $gte: sevenDaysAgo } } },
        { $group: { _id: "$address" } },
      ]);
      activeDirect7d = activeRows.length;
    }

    const recentDirect7d = directRefs.filter((u) => new Date(u.joinedAt).getTime() >= sevenDaysAgo.getTime()).length;
    const totalDownline = levels.reduce((acc, lvl) => acc + lvl.count, 0);

    const sourceCounts = {};
    const campaignCounts = {};
    const eventCounts = {};
    for (const u of directRefs) {
      const attr = u?.referralAttribution || {};
      const src = String(attr.utmSource || "").trim().toLowerCase();
      const campaign = String(attr.utmCampaign || "").trim();
      const eventId = Number(attr.eventId || 0);
      if (src) sourceCounts[src] = (sourceCounts[src] || 0) + 1;
      if (campaign) campaignCounts[campaign] = (campaignCounts[campaign] || 0) + 1;
      if (eventId > 0) eventCounts[String(eventId)] = (eventCounts[String(eventId)] || 0) + 1;
    }

    const top = (obj, limit = 8) =>
      Object.entries(obj)
        .map(([key, count]) => ({ key, count: Number(count || 0) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);

    res.json({
      success: true,
      data: {
        directCount: directRefs.length,
        totalDownline,
        levels,
        recentDirect7d,
        activeDirect7d,
        directRefs: directRefs.slice(0, 20),
        shareAttribution: {
          bySource: top(sourceCounts),
          byCampaign: top(campaignCounts),
          byEvent: top(eventCounts),
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:address/creator-stats", async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const creatorMatch = new RegExp(`^${address}$`, "i");
    const { Prediction } = getContracts();
    const [summary] = await PredictionEvent.aggregate([
      { $match: { isUserEvent: true, creator: creatorMatch } },
      {
        $group: {
          _id: null,
          createdCount: { $sum: 1 },
          activeCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$resolved", false] },
                    { $gt: ["$deadline", new Date()] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          resolvedCount: {
            $sum: { $cond: [{ $eq: ["$resolved", true] }, 1, 0] },
          },
          disputedCount: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $regexMatch: { input: "$aiReasoning", regex: /^Archived/i } },
                    { $regexMatch: { input: "$aiReasoning", regex: /^Verification failed/i } },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalVotes: { $sum: { $add: ["$totalVotesYes", "$totalVotesNo"] } },
          eventsWithVotes: {
            $sum: {
              $cond: [{ $gt: [{ $add: ["$totalVotesYes", "$totalVotesNo"] }, 0] }, 1, 0],
            },
          },
          listingFeeWeiTotal: { $sum: { $toDecimal: "$listingFeeWei" } },
        },
      },
    ]);

    const latestEvents = await PredictionEvent.find({ isUserEvent: true, creator: creatorMatch })
      .sort({ createdAt: -1 })
      .limit(10)
      .select("eventId title category deadline resolved totalVotesYes totalVotesNo listingFeeWei sourcePolicy")
      .lean();

    const createdCount = Number(summary?.createdCount || 0);
    const conversionPct = createdCount > 0 ? Math.round((Number(summary?.eventsWithVotes || 0) / createdCount) * 100) : 0;
    const avgVotesPerEvent = createdCount > 0 ? Number(summary?.totalVotes || 0) / createdCount : 0;
    let onChainCreatorClaimableWei = "0";
    let voteFeeWei = "0";
    let creatorShareBps = 5000;
    let minCreatorPayoutVotes = 20;
    if (Prediction) {
      try {
        if (typeof Prediction.creatorClaimableWei === "function") {
          onChainCreatorClaimableWei = String(await withTimeout(Prediction.creatorClaimableWei(address)));
        } else {
          const provider = Prediction?.runner?.provider;
          const to = Prediction?.target || Prediction?.address;
          if (provider && to) {
            const iface = new ethers.Interface(["function creatorClaimableWei(address) view returns (uint256)"]);
            const data = iface.encodeFunctionData("creatorClaimableWei", [address]);
            const raw = await withTimeout(provider.call({ to, data }));
            const dec = iface.decodeFunctionResult("creatorClaimableWei", raw);
            onChainCreatorClaimableWei = String(dec?.[0] ?? 0n);
          }
        }
      } catch {}
      voteFeeWei = String(await readPredictionValueNoArgs(
        Prediction,
        "function userEventVoteFee() view returns (uint256)",
        "userEventVoteFee",
        0n
      ));
      creatorShareBps = Number(await readPredictionValueNoArgs(
        Prediction,
        "function creatorShareBps() view returns (uint16)",
        "creatorShareBps",
        5000n
      ));
      minCreatorPayoutVotes = Number(await readPredictionValueNoArgs(
        Prediction,
        "function minCreatorPayoutVotes() view returns (uint256)",
        "minCreatorPayoutVotes",
        20n
      ));
    }

    res.json({
      success: true,
      data: {
        createdCount,
        activeCount: Number(summary?.activeCount || 0),
        resolvedCount: Number(summary?.resolvedCount || 0),
        disputedCount: Number(summary?.disputedCount || 0),
        totalVotes: Number(summary?.totalVotes || 0),
        eventsWithVotes: Number(summary?.eventsWithVotes || 0),
        conversionPct,
        avgVotesPerEvent,
        listingFeeWeiTotal: String(summary?.listingFeeWeiTotal || "0"),
        onChainCreatorClaimableWei,
        voteFeeWei,
        creatorShareBps,
        minCreatorPayoutVotes,
        latestEvents,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:address/onboarding", async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const isCentralWallet = !!config.centralWallet && address === config.centralWallet;
    const existing = await User.findOne({ address }).lean();
    let isNewUser = false;

    if (!existing) {
      await User.create({ address });
      isNewUser = true;
    } else if (!existing.referralCode) {
      await User.updateOne({ address }, { $set: { referralCode: buildReferralCode(address) } });
    }

    const user = existing || (await User.findOne({ address }).lean());
    const hasStoredReferrer = !!user?.referrer;
    let hasReferrerOnChain = false;
    const { Referral } = getContracts();
    if (Referral) {
      try {
        hasReferrerOnChain = await withTimeout(Referral.hasReferrer(address));
      } catch {}
    }

    res.json({
      success: true,
      data: {
        isNewUser,
        hasReferrer: isCentralWallet || hasStoredReferrer || hasReferrerOnChain,
        referrer: user?.referrer || null,
        referralCode: user?.referralCode || "",
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:address", async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    let user = await User.findOne({ address }).lean();

    const { Points, Referral, Staking, CheckIn } = getContracts();

    let onChainData = {};
    if (Points) {
      try {
        const pts = await withTimeout(Points.getUserPoints(address));
        onChainData.points = Number(pts.points);
        onChainData.weeklyPoints = Number(pts.weeklyPoints);
        onChainData.streak = Number(pts.streak);
        onChainData.totalCheckIns = Number(pts.totalCheckIns);
      } catch {}
    }

    if (CheckIn) {
      try {
        const rec = await withTimeout(CheckIn.getRecord(address));
        onChainData.lastCheckIn = Number(rec.lastCheckIn);
        onChainData.lastTier = ["BASIC", "PRO", "WHALE"][Number(rec.lastTier)];
      } catch {}
    }

    if (Staking) {
      try {
        const stake = await withTimeout(Staking.getStakeInfo(address));
        onChainData.staked = stake.amount.toString();
        onChainData.stakedAt = Number(stake.stakedAt);
      } catch {}
    }

    if (Referral) {
      try {
        const refs = await withTimeout(Referral.getDirectReferrals(address));
        onChainData.directReferrals = refs.length;
        onChainData.hasReferrer = await withTimeout(Referral.hasReferrer(address));
        onChainData.referralEarnings = (await withTimeout(Referral.totalEarnings(address))).toString();
      } catch {}
    }

    // Keep leaderboard data in sync even when event log indexing lags due RPC limits.
    if (typeof onChainData.points === "number") {
      const update = {
        totalPoints: onChainData.points,
        weeklyPoints: typeof onChainData.weeklyPoints === "number" ? onChainData.weeklyPoints : 0,
        streak: typeof onChainData.streak === "number" ? onChainData.streak : 0,
        totalCheckIns: typeof onChainData.totalCheckIns === "number" ? onChainData.totalCheckIns : 0,
      };
      if (onChainData.lastTier) update.tier = onChainData.lastTier;
      if (typeof onChainData.lastCheckIn === "number" && onChainData.lastCheckIn > 0) {
        update.lastCheckIn = new Date(onChainData.lastCheckIn * 1000);
      }

      await User.findOneAndUpdate(
        { address },
        {
          $set: update,
          $setOnInsert: { address, referralCode: buildReferralCode(address), joinedAt: new Date() },
        },
        { upsert: true }
      );

      user = await User.findOne({ address }).lean();
    }

    if (!user) {
      user = { address, totalPoints: 0, weeklyPoints: 0, streak: 0, tier: "BASIC" };
    }

    res.json({ success: true, data: { ...user, onChain: onChainData } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:address/history", async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const history = await CheckInRecord.find({ address })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();
    res.json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:address/referral-code", async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    let user = await User.findOne({ address });
    if (!user) {
      user = await User.create({ address });
    }
    res.json({ success: true, data: { code: user.referralCode } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Register referral on-chain
router.post("/:address/referral", async (req, res) => {
  try {
    const userAddress = req.params.address.toLowerCase();
    const isCentralWallet = !!config.centralWallet && userAddress === config.centralWallet;
    if (isCentralWallet) {
      return res.json({ success: true, skipped: true, reason: "central-wallet-exempt" });
    }
    const referrerCode = String(req.body?.referrerCode || "").trim().toUpperCase();
    const isSystemCode = referrerCode === SYSTEM_REFERRAL_CODE;
    const referralAttribution = parseReferralAttribution(req.body?.attribution);

    if (!referrerCode) {
      return res.status(400).json({ success: false, error: "Referral code required" });
    }

    const existingUser = await User.findOne({ address: userAddress }).lean();
    if (existingUser?.referrer) {
      return res.status(400).json({ success: false, error: "Already has a referrer" });
    }

    let referrerUser = await User.findOne({ referralCode: referrerCode });
    if (!referrerUser && referrerCode === SYSTEM_REFERRAL_CODE) {
      referrerUser = await ensureSystemReferrerUser();
    }
    if (!referrerUser) {
      return res.status(404).json({ success: false, error: "Invalid referral code" });
    }

    if (referrerUser.address === userAddress) {
      return res.status(400).json({ success: false, error: "Cannot refer yourself" });
    }

    // ORACLEAI is a system onboarding code: registration succeeds,
    // but no on-chain referrer link is set, so referral fee share
    // flows to treasury via CheckIn fallback instead of referral payouts.
    if (isSystemCode) {
      const update = {
        referrer: referrerUser.address,
      };
      if (referralAttribution) update.referralAttribution = referralAttribution;
      await User.findOneAndUpdate(
        { address: userAddress },
        {
          $set: update,
          $setOnInsert: { address: userAddress, referralCode: buildReferralCode(userAddress), joinedAt: new Date() },
        },
        { upsert: true }
      );
      return res.json({
        success: true,
        referrer: referrerUser.address,
        mode: "system-code-no-referral-payout",
      });
    }

    const { Referral } = getContracts();
    const signer = getSigner();
    if (!Referral || !signer) {
      return res.status(503).json({
        success: false,
        error: "Referral contract is unavailable. Restart local chain and redeploy contracts.",
      });
    }

    let already = false;
    try {
      already = await withTimeout(Referral.hasReferrer(userAddress));
    } catch (err) {
      if (isBadContractDataError(err)) {
        return res.status(503).json({
          success: false,
          error: "Referral contract is not initialized on current chain. Redeploy contracts and retry.",
        });
      }
      throw err;
    }
    if (already) {
      return res.status(400).json({ success: false, error: "Already has a referrer" });
    }

    let tx;
    try {
      tx = await Referral.registerReferral(userAddress, referrerUser.address);
    } catch (err) {
      if (isBadContractDataError(err)) {
        return res.status(503).json({
          success: false,
          error: "Referral contract is not initialized on current chain. Redeploy contracts and retry.",
        });
      }
      if (isAccessControlError(err)) {
        return res.status(503).json({
          success: false,
          error: "Referral operator role is missing for backend signer. Redeploy contracts and retry.",
        });
      }
      throw err;
    }
    await tx.wait();

    const update = {
      referrer: referrerUser.address,
    };
    if (referralAttribution) update.referralAttribution = referralAttribution;
    await User.findOneAndUpdate(
      { address: userAddress },
      {
        $set: update,
        $setOnInsert: { address: userAddress, referralCode: buildReferralCode(userAddress), joinedAt: new Date() },
      },
      { upsert: true }
    );

    res.json({ success: true, referrer: referrerUser.address });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
