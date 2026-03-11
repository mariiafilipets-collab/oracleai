"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { formatEther, parseEther } from "viem";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import GlassCard from "@/components/GlassCard";
import { useContractAddresses } from "@/hooks/useContracts";
import { CheckInABI, PointsABI, PredictionABI } from "@/lib/contracts";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { formatInOffset, getEffectiveOffsetMinutes, useTimezone } from "@/lib/timezone";
import AppIcon from "@/components/icons/AppIcon";

const CAT_KEYS = ["ALL", "SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"];
const CAT_ICONS: Record<string, "globe" | "target" | "bank" | "chart" | "diamond" | "history"> = {
  ALL: "globe",
  SPORTS: "target",
  POLITICS: "bank",
  ECONOMY: "chart",
  CRYPTO: "diamond",
  CLIMATE: "history",
};

const CHECKIN_TIERS = [
  { key: "basic", amount: "0.0015", pts: "100", color: "text-gray-300" },
  { key: "pro", amount: "0.01", pts: "300", color: "text-neon-cyan" },
  { key: "whale", amount: "0.05", pts: "1000", color: "text-neon-gold" },
];
const USER_EVENT_CATEGORIES = ["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"] as const;
const USER_EVENT_SOURCES = ["official", "market", "newswire", "oracle"] as const;

function formatSeconds(total: number) {
  const sec = Math.max(0, Math.floor(total));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function CountdownTimer({ deadline, compact = false }: { deadline: string; compact?: boolean }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft("⏳");
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  const isUrgent =
    new Date(deadline).getTime() - Date.now() < 30 * 60 * 1000 &&
    new Date(deadline).getTime() - Date.now() > 0;

  return (
    <span className={`font-mono ${compact ? "text-[11px]" : "text-xs"} ${isUrgent ? "text-neon-red animate-pulse" : "text-neon-gold"}`}>
      {timeLeft}
    </span>
  );
}

function ExpandableDesc({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 80;

  return (
    <div className="mb-3 cursor-pointer" onClick={() => isLong && setExpanded(!expanded)}>
      <p className={`text-xs text-gray-500 leading-relaxed ${!expanded && isLong ? "line-clamp-2" : ""}`}>
        {text}
      </p>
      {isLong && (
        <span className="text-[10px] text-neon-cyan mt-0.5 inline-block">
          {expanded ? "▲" : "▼ ..."}
        </span>
      )}
    </div>
  );
}

export default function PredictionsPage() {
  const { address, isConnected } = useAccount();
  const { addresses } = useContractAddresses();
  const [predictions, setPredictions] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"active" | "resolved" | "voted">("active");
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState<"ALL" | "AI" | "USER">("ALL");
  const [loading, setLoading] = useState(true);
  const [schedulerInfo, setSchedulerInfo] = useState<any>(null);
  const [votedPredictions, setVotedPredictions] = useState<any[]>([]);
  const [referralCode, setReferralCode] = useState("");
  const [lastSubmittedVote, setLastSubmittedVote] = useState<{ eventId: number; prediction: boolean } | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const requestSeqRef = useRef(0);
  const predictionsRef = useRef<any[]>([]);

  const { t, locale } = useI18n();
  const { mode: tzMode, fixedOffsetMinutes } = useTimezone();
  const userOffsetMinutes = getEffectiveOffsetMinutes(tzMode, fixedOffsetMinutes);
  const tr = useCallback((key: string, fallback: string) => {
    const translated = t(key);
    return translated === key ? fallback : translated;
  }, [t]);
  const localizeUserCreateMessage = useCallback((raw: string, kind: "error" | "warning" = "error") => {
    const message = String(raw || "").trim();
    const lower = message.toLowerCase();
    if (!message) {
      return kind === "warning"
        ? tr("predictions.userCreateQualityHint", "Improve question clarity")
        : tr("predictions.userCreateFailed", "Failed to create user event");
    }

    if (kind === "warning") {
      if (lower.includes("question should end with")) {
        return tr("predictions.userCreateWarnQuestionMark", "Question should end with '?' for clarity.");
      }
      if (lower.includes("clear binary wording")) {
        return tr("predictions.userCreateWarnBinaryWording", "Use clear YES/NO wording.");
      }
      return message;
    }

    if (lower.includes("title must be")) {
      return tr("predictions.userCreateErrTitleLength", "Title must be between 12 and 180 characters.");
    }
    if (lower.includes("unsupported category")) {
      return tr("predictions.userCreateErrCategory", "Unsupported category.");
    }
    if (lower.includes("unsupported source policy")) {
      return tr("predictions.userCreateErrSource", "Unsupported source policy.");
    }
    if (lower.includes("invalid deadline")) {
      return tr("predictions.userCreateErrDeadline", "Invalid deadline.");
    }
    if (lower.includes("deadline must be in")) {
      return tr("predictions.userCreateErrDeadlineRange", "Deadline must be within 10 minutes to 14 days.");
    }
    if (lower.includes("duplicate active event")) {
      return tr("predictions.userCreateErrDuplicate", "A similar active event already exists.");
    }
    if (lower.includes("cooldown active")) {
      return tr("predictions.cooldownActive", "Cooldown is active. Try later.");
    }
    if (lower.includes("not a prediction about a binary event")
      || lower.includes("not binary")
      || lower.includes("non-binary")
      || lower.includes("vague question")) {
      return tr("predictions.userCreateErrBinary", "Question is not clearly binary (YES/NO). Clarify conditions and deadline.");
    }
    if (lower.includes("requires clarification") || lower.includes("too vague") || lower.includes("unclear")) {
      return tr("predictions.userCreateErrClarify", "Question is too vague. Add measurable condition and clear deadline.");
    }
    if (lower.includes("ai validation rejected")) {
      return tr("predictions.userCreateErrAiRejected", "AI validation rejected this event. Please rephrase.");
    }
    if (lower.includes("question is in ")) {
      return tr("predictions.userCreateErrLanguage", "Language detected. Please keep the question clear and binary (YES/NO).");
    }

    return message;
  }, [tr]);
  const predictionAddress = addresses?.Prediction as `0x${string}` | undefined;
  const checkInAddress = addresses?.CheckIn as `0x${string}` | undefined;
  const pointsAddress = addresses?.Points as `0x${string}` | undefined;
  const [checkInModalOpen, setCheckInModalOpen] = useState(false);
  const [selectedTier, setSelectedTier] = useState(0);
  const [pendingVote, setPendingVote] = useState<{ eventId: number; prediction: boolean } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [expectedCreatedEventId, setExpectedCreatedEventId] = useState<number | null>(null);
  const [newEvent, setNewEvent] = useState({
    title: "",
    category: "CRYPTO",
    hoursToDeadline: 12,
    sourcePolicy: "official",
  });
  const checkInHandledRef = useRef<string | undefined>(undefined);
  const voteHandledRef = useRef<string | undefined>(undefined);
  const createHandledRef = useRef<string | undefined>(undefined);

  const { data: userPoints } = useReadContract({
    address: pointsAddress,
    abi: PointsABI,
    functionName: "getUserPoints",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!pointsAddress },
  });
  const up = userPoints as any;
  const lastCheckIn = Number(up?.lastCheckIn ?? up?.[3] ?? 0);
  const checkedToday = Math.floor(lastCheckIn / 86400) === Math.floor(Date.now() / 1000 / 86400);
  const { data: userEventFeeRaw } = useReadContract({
    address: predictionAddress,
    abi: PredictionABI,
    functionName: "USER_EVENT_FEE",
    query: { enabled: !!predictionAddress },
  });
  const { data: userEventVoteFeeRaw } = useReadContract({
    address: predictionAddress,
    abi: PredictionABI,
    functionName: "userEventVoteFee",
    query: { enabled: !!predictionAddress },
  });
  const { data: creatorShareBpsRaw } = useReadContract({
    address: predictionAddress,
    abi: PredictionABI,
    functionName: "creatorShareBps",
    query: { enabled: !!predictionAddress },
  });
  const { data: minCreatorPayoutVotesRaw } = useReadContract({
    address: predictionAddress,
    abi: PredictionABI,
    functionName: "minCreatorPayoutVotes",
    query: { enabled: !!predictionAddress },
  });
  const { data: eventCountRaw } = useReadContract({
    address: predictionAddress,
    abi: PredictionABI,
    functionName: "eventCount",
    query: { enabled: !!predictionAddress },
  });
  const { data: nextUserEventAtRaw } = useReadContract({
    address: predictionAddress,
    abi: PredictionABI,
    functionName: "nextUserEventAt",
    args: address ? [address] : undefined,
    query: { enabled: !!predictionAddress && !!address },
  });
  const { data: isVerifiedCreatorRaw } = useReadContract({
    address: predictionAddress,
    abi: PredictionABI,
    functionName: "isVerifiedCreator",
    args: address ? [address] : undefined,
    query: { enabled: !!predictionAddress && !!address },
  });
  const { data: creatorCooldownRaw } = useReadContract({
    address: predictionAddress,
    abi: PredictionABI,
    functionName: "getCreatorCooldown",
    args: address ? [address] : undefined,
    query: { enabled: !!predictionAddress && !!address },
  });
  const { data: verifiedMinPointsRaw } = useReadContract({
    address: predictionAddress,
    abi: PredictionABI,
    functionName: "VERIFIED_MIN_POINTS",
    query: { enabled: !!predictionAddress },
  });
  const userEventFeeWei = (userEventFeeRaw as bigint | undefined) ?? parseEther("0.0015");
  const userEventFeeDisplay = Number(formatEther(userEventFeeWei)).toFixed(4);
  const hasCreatorEconomy = typeof userEventVoteFeeRaw !== "undefined";
  const userEventVoteFeeWei = (userEventVoteFeeRaw as bigint | undefined) ?? BigInt(0);
  const userEventVoteFeeDisplay = Number(formatEther(userEventVoteFeeWei)).toFixed(4);
  const creatorSharePct = Number(creatorShareBpsRaw ?? 5000) / 100;
  const minCreatorPayoutVotes = Number(minCreatorPayoutVotesRaw ?? BigInt(20));
  const nextUserEventAt = Number(nextUserEventAtRaw ?? BigInt(0));
  const cooldownSeconds = Math.max(0, nextUserEventAt - Math.floor(Date.now() / 1000));
  const nextCreateAtText =
    nextUserEventAt > 0 ? formatInOffset(nextUserEventAt * 1000, userOffsetMinutes) : "";
  const isVerifiedCreator = Boolean(isVerifiedCreatorRaw);
  const creatorCooldownHours = Math.round(Number(creatorCooldownRaw ?? BigInt(86400)) / 3600);
  const verifiedMinPoints = Number(verifiedMinPointsRaw ?? BigInt(5000));

  const { writeContract: writeVote, data: voteHash, isPending: isVotePending } = useWriteContract();
  const { isSuccess: isVoteSuccess } = useWaitForTransactionReceipt({ hash: voteHash });
  const { writeContract: writeCheckIn, data: checkInHash, isPending: isCheckInPending } = useWriteContract();
  const { isLoading: isCheckInConfirming, isSuccess: isCheckInSuccess } = useWaitForTransactionReceipt({ hash: checkInHash });
  const { writeContract: writeCreateEvent, data: createHash, isPending: isCreatePending } = useWriteContract();
  const { isSuccess: isCreateSuccess } = useWaitForTransactionReceipt({ hash: createHash });

  const loadPredictions = useCallback(async (lang?: string) => {
    const seq = ++requestSeqRef.current;
    const requestedLang = lang ?? locale;
    try {
      const [activeRes, resolvedRes] = await Promise.all([
        api.getPredictions(requestedLang, address),
        api.getResolvedPredictions(requestedLang, address),
      ]);
      if (seq !== requestSeqRef.current) return;
      const active = activeRes.success ? activeRes.data || [] : [];
      const resolved = resolvedRes.success ? resolvedRes.data || [] : [];
      const next = [
        ...active.map((p: any) => ({ ...p, _status: "active" })),
        ...resolved.map((p: any) => ({ ...p, _status: "resolved" })),
      ];
      // Preserve local vote state until backend poll/index catches up.
      const localById = new Map(predictionsRef.current.map((p) => [Number(p.eventId), p]));
      const merged = next.map((row) => {
        const local = localById.get(Number(row.eventId));
        if (!local) return row;
        const withLocalVote =
          typeof local.userPrediction === "boolean"
            ? {
                ...row,
                userPrediction: local.userPrediction,
                userCorrect: local.userCorrect,
                aiWasRight: local.aiWasRight,
                beatAi: local.beatAi,
                rewardPoints: local.rewardPoints,
              }
            : row;
        return {
          ...withLocalVote,
          totalVotesYes: Math.max(Number(withLocalVote.totalVotesYes || 0), Number(local.totalVotesYes || 0)),
          totalVotesNo: Math.max(Number(withLocalVote.totalVotesNo || 0), Number(local.totalVotesNo || 0)),
        };
      });
      setPredictions(merged);
    } catch {}
    if (seq === requestSeqRef.current) setLoading(false);
  }, [locale, address]);

  const loadSchedulerStatus = useCallback(async () => {
    try {
      const res = await api.getSchedulerStatus();
      if (res.success) setSchedulerInfo(res.data);
    } catch {}
  }, []);

  const loadVotedPredictions = useCallback(async (userAddress?: string, lang?: string) => {
    if (!userAddress) {
      setVotedPredictions([]);
      return;
    }
    try {
      const res = await api.getUserVotedPredictions(userAddress, lang ?? locale);
      if (res?.success) {
        setVotedPredictions(res.data || []);
      }
    } catch {}
  }, [locale]);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    setLoading(true);
    loadPredictions(locale);
    loadSchedulerStatus();
    if (address) loadVotedPredictions(address, locale);
    pollRef.current = setInterval(() => {
      loadPredictions(locale);
      loadSchedulerStatus();
      if (address) loadVotedPredictions(address, locale);
    }, 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadPredictions, loadSchedulerStatus, loadVotedPredictions, locale, address]);

  useEffect(() => {
    predictionsRef.current = predictions;
  }, [predictions]);

  useEffect(() => {
    if (!address) {
      setReferralCode("");
      return;
    }
    api.getReferralCode(address)
      .then((res) => {
        if (res?.success) setReferralCode(String(res?.data?.code || ""));
      })
      .catch(() => {});
  }, [address]);

  useEffect(() => {
    if (isVoteSuccess && voteHash && voteHandledRef.current !== voteHash) {
      voteHandledRef.current = voteHash;
      toast.success(t("predictions.submitted"));
      if (lastSubmittedVote) {
        const { eventId, prediction } = lastSubmittedVote;
        setPredictions((prev) =>
          prev.map((p) => {
            if (Number(p.eventId) !== Number(eventId)) return p;
            if (typeof p.userPrediction === "boolean") return p;
            return {
              ...p,
              userPrediction: prediction,
              totalVotesYes: Number(p.totalVotesYes || 0) + (prediction ? 1 : 0),
              totalVotesNo: Number(p.totalVotesNo || 0) + (!prediction ? 1 : 0),
            };
          })
        );
        setVotedPredictions((prev) => {
          const exists = prev.some((p) => Number(p.eventId) === Number(eventId));
          if (exists) return prev;
          const src = predictionsRef.current.find((p) => Number(p.eventId) === Number(eventId));
          if (!src) return prev;
          return [{ ...src, userPrediction: prediction }, ...prev];
        });
      }
      if (address) {
        void loadVotedPredictions(address);
      }
      loadPredictions();
    }
  }, [isVoteSuccess, voteHash, loadPredictions, loadVotedPredictions, t, lastSubmittedVote, address]);

  useEffect(() => {
    if (!isCheckInSuccess || !checkInHash || checkInHandledRef.current === checkInHash) return;
    checkInHandledRef.current = checkInHash;
    toast.success(tr("checkin.processing", "Check-in confirmed"));
    setCheckInModalOpen(false);
    if (pendingVote && predictionAddress) {
      writeVote({
        address: predictionAddress,
        abi: PredictionABI,
        functionName: "submitPrediction",
        args: [BigInt(pendingVote.eventId), pendingVote.prediction],
      });
      setLastSubmittedVote({ eventId: pendingVote.eventId, prediction: pendingVote.prediction });
      setPendingVote(null);
    }
  }, [isCheckInSuccess, checkInHash, pendingVote, predictionAddress, tr, writeVote]);

  useEffect(() => {
    if (!isCreateSuccess || !createHash || createHandledRef.current === createHash) return;
    createHandledRef.current = createHash;
    const expectedId = expectedCreatedEventId;
    setCreatingEvent(false);
    setCreateOpen(false);
    setNewEvent({ title: "", category: "CRYPTO", hoursToDeadline: 12, sourcePolicy: "official" });
    toast.success(tr("predictions.userCreateSuccess", "User event created successfully"));
    if (expectedId) {
      api.ingestUserPredictionEvent(expectedId).catch(() => null);
      setExpectedCreatedEventId(null);
    }
    loadPredictions();
  }, [isCreateSuccess, createHash, expectedCreatedEventId, loadPredictions, tr]);

  const handleVote = (eventId: number, prediction: boolean) => {
    if (!predictionAddress) {
      toast.error(t("predictions.contractsNotLoaded"));
      return;
    }
    if (!checkedToday) {
      setPendingVote({ eventId, prediction });
      setCheckInModalOpen(true);
      toast.error(tr("predictions.checkInRequiredToast", "Complete today's check-in before voting"));
      return;
    }
    const target = predictions.find((p) => Number(p.eventId) === Number(eventId));
    if (typeof target?.userPrediction === "boolean") {
      toast.error(tr("predictions.alreadyVoted", "You already voted on this event"));
      return;
    }
    const isUserEvent = Boolean(target?.isUserEvent);
    const isOwnUserEvent = Boolean(
      isUserEvent
      && address
      && String(target?.creator || "").toLowerCase() === address.toLowerCase()
    );
    if (isOwnUserEvent) {
      toast.error(tr("predictions.creatorCannotVoteOwn", "You cannot vote on your own event"));
      return;
    }
    writeVote({
      address: predictionAddress,
      abi: PredictionABI,
      functionName: "submitPrediction",
      args: [BigInt(eventId), prediction],
      value: isUserEvent && hasCreatorEconomy ? userEventVoteFeeWei : undefined,
    });
    setLastSubmittedVote({ eventId, prediction });
  };

  const handleCheckInFromModal = () => {
    if (!checkInAddress) {
      toast.error(t("predictions.contractsNotLoaded"));
      return;
    }
    if (checkedToday) {
      toast(tr("predictions.checkInAlreadyToday", "You already completed check-in today"));
      return;
    }
    writeCheckIn({
      address: checkInAddress,
      abi: CheckInABI,
      functionName: "checkIn",
      value: parseEther(CHECKIN_TIERS[selectedTier].amount),
    });
  };

  const handleCreateUserEvent = async () => {
    if (!predictionAddress || !isConnected) {
      toast.error(tr("predictions.connectToCreate", "Connect wallet to create an event"));
      return;
    }
    if (cooldownSeconds > 0) {
      toast.error(`${tr("predictions.cooldownActive", "Cooldown is active.")} ${tr("predictions.nextCreateIn", "Next event in")} ${formatSeconds(cooldownSeconds)}`);
      return;
    }

    const title = newEvent.title.trim();
    const categoryIdx = USER_EVENT_CATEGORIES.indexOf(newEvent.category as any);
    if (!title || categoryIdx < 0) {
      toast.error(tr("predictions.userCreateInvalid", "Please fill all required fields"));
      return;
    }

    try {
      setCreatingEvent(true);
      const deadlineMs = Date.now() + Number(newEvent.hoursToDeadline) * 3600 * 1000;
      const validation = await api.validateUserPredictionEvent({
        title,
        category: newEvent.category,
        deadlineMs,
        sourcePolicy: newEvent.sourcePolicy,
        creator: address,
      });
      if (!validation?.success) {
        const left = Number(validation?.data?.secondsLeft || 0);
        if (left > 0) {
          throw new Error(`${tr("predictions.cooldownActive", "Cooldown is active.")} ${tr("predictions.nextCreateIn", "Next event in")} ${formatSeconds(left)}`);
        }
        throw new Error(validation?.error || "Validation failed");
      }

      const warnings = validation?.data?.qualityWarnings || [];
      if (warnings.length) {
        toast(localizeUserCreateMessage((warnings[0] as string) || "", "warning"));
      }

      const currentEventCount = Number(eventCountRaw ?? BigInt(0));
      setExpectedCreatedEventId(currentEventCount + 1);
      const titleForChain = String(validation?.data?.normalizedTitleAi || title).trim().slice(0, 180) || title;
      writeCreateEvent({
        address: predictionAddress,
        abi: PredictionABI,
        functionName: "createUserEvent",
        args: [
          titleForChain,
          categoryIdx,
          BigInt(Math.floor(deadlineMs / 1000)),
          newEvent.sourcePolicy,
        ],
        value: userEventFeeWei,
      });
    } catch (err: any) {
      setCreatingEvent(false);
      setExpectedCreatedEventId(null);
      toast.error(localizeUserCreateMessage(err?.message || tr("predictions.userCreateFailed", "Failed to create user event"), "error"));
    }
  };

  const buildEventShareLink = useCallback((pred: any, source: "telegram" | "x" | "discord" | "copy") => {
    if (typeof window === "undefined") return "";
    const eventId = Number(pred?.eventId || 0);
    const category = String(pred?.category || "general").toLowerCase();
    const params = new URLSearchParams({
      eventId: String(eventId),
      utm_source: source,
      utm_medium: "social",
      utm_campaign: `event_share_${category}`,
      utm_content: `event_${eventId}`,
    });
    if (referralCode) params.set("ref", referralCode);
    return `${window.location.origin}/predictions?${params.toString()}`;
  }, [referralCode]);

  const shareEvent = useCallback((platform: "telegram" | "x" | "discord", pred: any) => {
    if (!isConnected || !referralCode) {
      toast.error(tr("predictions.connectToShareRef", "Connect wallet to share with your referral link"));
      return;
    }
    const link = buildEventShareLink(pred, platform);
    const text = `${pred?.title || tr("predictions.title", "Predictions")} — ${tr("predictions.shareInvite", "Predict with AI on OracleAI Predict")}`;
    const payload = `${text} ${link}`.trim();
    if (platform === "telegram") {
      window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
      return;
    }
    if (platform === "x") {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(payload)}`, "_blank", "noopener,noreferrer");
      return;
    }
    navigator.clipboard.writeText(payload).then(() => {
      toast.success(tr("predictions.discordCopied", "Share text copied for Discord"));
      window.open("https://discord.com/channels/@me", "_blank", "noopener,noreferrer");
    }).catch(() => {
      toast.error(tr("predictions.discordCopyFailed", "Failed to copy Discord share text"));
    });
  }, [isConnected, referralCode, buildEventShareLink, tr]);

  const copyEventLink = useCallback((pred: any) => {
    if (!isConnected || !referralCode) {
      toast.error(tr("predictions.connectToShareRef", "Connect wallet to share with your referral link"));
      return;
    }
    const link = buildEventShareLink(pred, "copy");
    navigator.clipboard.writeText(link).then(() => {
      toast.success(tr("predictions.shareLinkCopied", "Referral link copied"));
    }).catch(() => {
      toast.error(tr("predictions.shareLinkCopyFailed", "Failed to copy referral link"));
    });
  }, [isConnected, referralCode, buildEventShareLink, tr]);

  const votedByEventId = useMemo(() => {
    const map = new Map<number, any>();
    for (const row of votedPredictions) {
      const id = Number(row?.eventId || 0);
      if (id > 0) map.set(id, row);
    }
    return map;
  }, [votedPredictions]);

  const attachVoteMeta = useCallback((pred: any) => {
    const vote = votedByEventId.get(Number(pred?.eventId || 0));
    if (!vote) return pred;
    return {
      ...pred,
      userPrediction: vote.userPrediction,
      userCorrect: vote.userCorrect,
      aiWasRight: vote.aiWasRight,
      beatAi: vote.beatAi,
      rewardPoints: vote.rewardPoints,
    };
  }, [votedByEventId]);

  const activePredictions = predictions.filter((p) => p._status === "active").map(attachVoteMeta);
  const resolvedPredictions = predictions.filter((p) => p._status === "resolved").map(attachVoteMeta);
  const displayList =
    activeTab === "active"
      ? activePredictions
      : activeTab === "resolved"
        ? resolvedPredictions
        : votedPredictions;
  const byCategory =
    activeCategory === "ALL" ? displayList : displayList.filter((p) => p.category === activeCategory);
  const filtered = byCategory.filter((p) => {
    if (sourceFilter === "ALL") return true;
    if (sourceFilter === "AI") return !p.isUserEvent;
    return Boolean(p.isUserEvent);
  });

  const formatUserTime = useCallback(
    (iso: string) => formatInOffset(iso, userOffsetMinutes),
    [userOffsetMinutes]
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Points info banner */}
      <div className="glass rounded-xl p-3.5 sm:p-4 border border-neon-purple/20 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <span className="text-2xl"><AppIcon name="brain" className="w-7 h-7 text-neon-cyan" /></span>
        <div className="flex-1">
          <p suppressHydrationWarning className="text-xs sm:text-sm text-gray-200">
            <strong suppressHydrationWarning className="text-neon-cyan">{t("predictions.howVoting")}</strong> {t("predictions.clickAgree")}
            <span className="text-neon-green font-bold"> {t("predictions.agree")}</span> {t("predictions.orDisagree")}
            <span className="text-neon-red font-bold"> {t("predictions.disagree")}</span>.{" "}
            {t("predictions.correctReward")}.
            <span className="text-neon-gold font-bold"> {t("predictions.beatAi")}</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">{t("predictions.autoResolve")}</p>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 sm:gap-3">
        <div>
          <h1 className="text-[1.7rem] sm:text-3xl font-heading font-bold">
            <span className="text-white">{t("predictions.title")}</span>
          </h1>
          <p className="text-gray-400 text-sm mt-1">{t("predictions.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Scheduler Status Badge */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-dark-700 border border-dark-500 text-xs w-fit">
            <span className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
            <span className="text-gray-400">{t("predictions.autoCycle")}</span>
            <span className="text-neon-cyan font-mono">{activePredictions.length} {t("common.active")}</span>
          </div>
        </div>
      </div>

      {/* Active / Resolved Tabs */}
      <GlassCard className="space-y-3 p-3.5 sm:p-6" glow="purple" hover={false}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">
              {tr("predictions.userCreateTitle", "Create your own event")}
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              {tr("predictions.userCreateSubtitle", "List your event for")} {userEventFeeDisplay} BNB
              {" · "}
              {isVerifiedCreator
                ? tr("predictions.userCreateCooldownVerified", "verified: 3 events per 24h")
                : tr("predictions.userCreateCooldown", "1 event per 24h")}
            </p>
            {hasCreatorEconomy && (
              <p className="text-[11px] text-gray-500 mt-1">
                {tr("predictions.userVoteFeeInfo", "User-event vote fee")} {userEventVoteFeeDisplay} BNB
                {" · "}
                {tr("predictions.creatorGets", "creator gets")} {creatorSharePct}%
                {" · "}
                {tr("predictions.creatorPayoutVotesMin", "payout unlock")} {minCreatorPayoutVotes} {tr("predictions.votes", "votes")}
              </p>
            )}
            <p className="text-[11px] text-gray-500 mt-1">
              {isVerifiedCreator
                ? tr("predictions.creatorTierVerified", "Creator tier: VERIFIED")
                : tr("predictions.creatorTierNewbie", "Creator tier: NEWBIE")} ·{" "}
              {(t("predictions.creatorTierRule", { points: verifiedMinPoints }) === "predictions.creatorTierRule"
                ? `verified unlocks at ${verifiedMinPoints} points`
                : t("predictions.creatorTierRule", { points: verifiedMinPoints }))}
              {" · "}
              {(t("predictions.currentCooldown", { hours: creatorCooldownHours }) === "predictions.currentCooldown"
                ? `cooldown: ${creatorCooldownHours}h`
                : t("predictions.currentCooldown", { hours: creatorCooldownHours }))}
            </p>
          </div>
          <button
            onClick={() => setCreateOpen((v) => !v)}
            className="min-h-11 px-4 py-2 rounded-xl bg-neon-purple/20 border border-neon-purple/40 text-neon-purple text-sm font-bold w-full sm:w-auto"
          >
            {createOpen ? tr("common.close", "Close") : tr("predictions.openCreate", "Create Event")}
          </button>
        </div>
        {cooldownSeconds > 0 && (
          <p className="text-xs text-neon-gold">
            {tr("predictions.nextCreateIn", "Next event in")} {formatSeconds(cooldownSeconds)}
            {nextCreateAtText ? ` (${nextCreateAtText})` : ""}
          </p>
        )}
        {createOpen && (
          <div className="grid md:grid-cols-2 gap-2.5 sm:gap-3">
            <input
              className="bg-dark-700 border border-dark-500 rounded-xl px-3 py-2.5 text-sm text-white min-h-11"
              placeholder={tr("predictions.userCreateTitleInput", "Will BTC close above 80k by Friday?")}
              value={newEvent.title}
              onChange={(e) => setNewEvent((p) => ({ ...p, title: e.target.value }))}
              maxLength={180}
            />
            <select
              className="bg-dark-700 border border-dark-500 rounded-xl px-3 py-2.5 text-sm text-white min-h-11"
              value={newEvent.category}
              onChange={(e) => setNewEvent((p) => ({ ...p, category: e.target.value }))}
            >
              {USER_EVENT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{t(`categories.${cat}`)}</option>
              ))}
            </select>
            <select
              className="bg-dark-700 border border-dark-500 rounded-xl px-3 py-2.5 text-sm text-white min-h-11"
              value={newEvent.hoursToDeadline}
              onChange={(e) => setNewEvent((p) => ({ ...p, hoursToDeadline: Number(e.target.value) }))}
            >
              {[4, 8, 12, 24, 48, 72].map((h) => (
                <option key={h} value={h}>{tr("predictions.deadlineIn", "Deadline in")} {h}h</option>
              ))}
            </select>
            <select
              className="bg-dark-700 border border-dark-500 rounded-xl px-3 py-2.5 text-sm text-white min-h-11"
              value={newEvent.sourcePolicy}
              onChange={(e) => setNewEvent((p) => ({ ...p, sourcePolicy: e.target.value }))}
            >
              {USER_EVENT_SOURCES.map((s) => (
                <option key={s} value={s}>{tr(`predictions.source.${s}`, s)}</option>
              ))}
            </select>
            <div className="md:col-span-2">
              <button
                onClick={handleCreateUserEvent}
                disabled={creatingEvent || isCreatePending || cooldownSeconds > 0}
                className="w-full min-h-11 py-3 rounded-xl bg-gradient-to-r from-neon-cyan to-neon-purple text-dark-900 font-bold disabled:opacity-50"
              >
                {creatingEvent || isCreatePending
                  ? tr("predictions.creatingEvent", "Creating...")
                  : (t("predictions.createForFee", { fee: userEventFeeDisplay }) === "predictions.createForFee"
                    ? `Create for ${userEventFeeDisplay} BNB`
                    : t("predictions.createForFee", { fee: userEventFeeDisplay }))}
              </button>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Active / Resolved Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        <button
          onClick={() => setActiveTab("active")}
          className={`shrink-0 min-h-11 px-4 sm:px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
            activeTab === "active"
              ? "bg-neon-green/20 text-neon-green border border-neon-green/30"
              : "bg-dark-700 text-gray-400 border border-dark-500"
          }`}
        >
          <span className="inline-flex items-center gap-1"><AppIcon name="activity" className="w-4 h-4" /> {t("predictions.active")} ({activePredictions.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("resolved")}
          className={`shrink-0 min-h-11 px-4 sm:px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
            activeTab === "resolved"
              ? "bg-neon-purple/20 text-neon-purple border border-neon-purple/30"
              : "bg-dark-700 text-gray-400 border border-dark-500"
          }`}
        >
          <span className="inline-flex items-center gap-1"><AppIcon name="check" className="w-4 h-4" /> {t("predictions.resolved")} ({resolvedPredictions.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("voted")}
          className={`shrink-0 min-h-11 px-4 sm:px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
            activeTab === "voted"
              ? "bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30"
              : "bg-dark-700 text-gray-400 border border-dark-500"
          }`}
        >
          <span className="inline-flex items-center gap-1"><AppIcon name="target" className="w-4 h-4" /> {tr("predictions.myVotes", "My Votes")} ({votedPredictions.length})</span>
        </button>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
        {CAT_KEYS.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              activeCategory === cat
                ? "bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30"
                : "bg-dark-700 text-gray-400 border border-dark-500 hover:bg-dark-600"
            }`}
          >
            <span className="inline-flex items-center gap-1"><AppIcon name={CAT_ICONS[cat]} className="w-4 h-4" /> {t(`categories.${cat}`)}</span>
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {(["ALL", "AI", "USER"] as const).map((src) => (
          <button
            key={src}
            onClick={() => setSourceFilter(src)}
            className={`shrink-0 min-h-10 px-3 py-2 rounded-xl text-xs font-semibold transition ${
              sourceFilter === src
                ? "bg-neon-purple/20 border border-neon-purple/40 text-neon-purple"
                : "bg-dark-700 border border-dark-500 text-gray-400"
            }`}
          >
            {src === "ALL"
              ? tr("predictions.filterAllSources", "All sources")
              : src === "AI"
                ? tr("predictions.filterAiSources", "AI events")
                : tr("predictions.filterUserSources", "User-created")}
          </button>
        ))}
      </div>

      {/* Predictions Grid */}
      {loading ? (
        <div className="text-center py-20 text-gray-500">{t("common.loading")}</div>
      ) : filtered.length === 0 ? (
        <GlassCard hover={false} className="text-center py-16">
          <p className="text-4xl mb-4 flex justify-center">{activeTab === "active" ? <AppIcon name="prediction" className="w-10 h-10 text-neon-cyan" /> : <AppIcon name="litepaper" className="w-10 h-10 text-neon-purple" />}</p>
          <p className="text-gray-400 mb-2">
            {activeTab === "active"
              ? t("predictions.noActive")
              : activeTab === "resolved"
                ? t("predictions.noResolved")
                : tr("predictions.noVoted", "No voted events yet")}
          </p>
          <p className="text-sm text-gray-500">
            {activeTab === "active"
              ? t("predictions.willGenerate")
              : activeTab === "resolved"
                ? t("predictions.resolvedByAi")
                : tr("predictions.voteToSeeHistory", "Vote on events to see your personal history here")}
          </p>
        </GlassCard>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <AnimatePresence mode="popLayout">
            {filtered.map((pred, i) => {
              const deadline = new Date(pred.deadline);
              const isExpired = deadline < new Date();
              const totalVotes = (pred.totalVotesYes || 0) + (pred.totalVotesNo || 0);
              const isOwnUserEvent = Boolean(
                pred.isUserEvent
                && address
                && String(pred.creator || "").toLowerCase() === address.toLowerCase()
              );

              return (
                <motion.div
                  key={pred.eventId}
                  layout
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <GlassCard
                    className={`relative overflow-hidden ${
                      pred.resolved ? "" : ""
                    }`}
                    glow={pred.resolved ? (pred.outcome ? "green" : undefined) : "cyan"}
                    hover={!pred.resolved}
                  >
                    {/* Resolved overlay badge */}
                    {pred.resolved && (
                      <div
                        className={`absolute top-0 right-0 px-3 py-1 text-xs font-bold rounded-bl-xl ${
                          pred.outcome
                            ? "bg-neon-green/20 text-neon-green"
                            : "bg-neon-red/20 text-neon-red"
                        }`}
                      >
                        {pred.outcome ? `✓ ${t("predictions.happened")}` : `✗ ${t("predictions.didNotHappen")}`}
                      </div>
                    )}

                    {/* Category + Countdown */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <span className="text-xs px-2 py-1 rounded-full bg-dark-600 text-gray-400">
                        <span className="inline-flex items-center gap-1"><AppIcon name={CAT_ICONS[pred.category]} className="w-3.5 h-3.5" /> {t(`categories.${pred.category}`)}</span>
                      </span>
                      {pred.isUserEvent && (
                        <span className="text-[10px] px-2 py-1 rounded-full border border-neon-gold/40 text-neon-gold bg-neon-gold/10">
                          {tr("predictions.userEventBadge", "User Event")}
                          {hasCreatorEconomy ? ` · ${userEventVoteFeeDisplay} BNB` : ""}
                        </span>
                      )}
                      {!pred.resolved && !isExpired && <CountdownTimer deadline={pred.deadline} />}
                      {!pred.resolved && isExpired && (
                        <span className="text-xs text-neon-gold animate-pulse font-mono">
                          ⏳ {t("predictions.resolving")}
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <h3 className="text-sm font-medium text-gray-100 mb-3 leading-snug pr-2">
                      {pred.title}
                    </h3>

                    {/* Description — expandable */}
                    {pred.description && (
                      <ExpandableDesc text={pred.description} />
                    )}

                    {/* Timing details in user UTC */}
                    <div className="mb-3 p-2.5 rounded-lg bg-dark-700/60 border border-dark-500/50">
                      <div className="flex items-center justify-between text-[11px] text-gray-400">
                        <span>{tr("predictions.eventStartsAt", "Event starts at")}</span>
                        <span className="font-mono text-gray-300">
                          {pred.eventStartAtUtc
                            ? formatUserTime(pred.eventStartAtUtc)
                            : tr("predictions.eventStartTbd", "TBD")}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-gray-400">
                        <span>{tr("predictions.voteClosesAt", "Voting closes at")}</span>
                        <span className="font-mono text-gray-300">{formatUserTime(pred.deadline)}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-gray-400 mt-1">
                        <span>{tr("predictions.verifyAt", "Verification at")}</span>
                        <span className="font-mono text-gray-300">{formatUserTime(pred.verifyAfter || pred.deadline)}</span>
                      </div>
                      {!pred.resolved && (
                        <div className="mt-2 grid grid-cols-1 gap-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-gray-500">{tr("predictions.voteCloseIn", "Voting closes in")}</span>
                            <CountdownTimer deadline={pred.deadline} compact />
                          </div>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-gray-500">{tr("predictions.verifyIn", "Verification in")}</span>
                            <CountdownTimer deadline={pred.verifyAfter || pred.deadline} compact />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Share with referral tracking */}
                    <div className="mb-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => shareEvent("telegram", pred)}
                        className="px-3 py-1.5 rounded-lg text-[11px] bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/20 transition"
                      >
                        <span className="inline-flex items-center gap-1"><AppIcon name="send" className="w-3.5 h-3.5" /> {tr("predictions.shareTelegram", "Telegram")}</span>
                      </button>
                      <button
                        onClick={() => shareEvent("x", pred)}
                        className="px-3 py-1.5 rounded-lg text-[11px] bg-neon-purple/10 border border-neon-purple/30 text-neon-purple hover:bg-neon-purple/20 transition"
                      >
                        <span className="inline-flex items-center gap-1"><AppIcon name="x" className="w-3.5 h-3.5" /> {tr("predictions.shareX", "X")}</span>
                      </button>
                      <button
                        onClick={() => shareEvent("discord", pred)}
                        className="px-3 py-1.5 rounded-lg text-[11px] bg-neon-gold/10 border border-neon-gold/30 text-neon-gold hover:bg-neon-gold/20 transition"
                      >
                        <span className="inline-flex items-center gap-1"><AppIcon name="link" className="w-3.5 h-3.5" /> {tr("predictions.shareDiscord", "Discord")}</span>
                      </button>
                      <button
                        onClick={() => copyEventLink(pred)}
                        className="px-3 py-1.5 rounded-lg text-[11px] bg-dark-700 border border-dark-500 text-gray-300 hover:border-neon-cyan/40 hover:text-neon-cyan transition"
                      >
                        <span className="inline-flex items-center gap-1"><AppIcon name="chain" className="w-3.5 h-3.5" /> {tr("predictions.shareCopyLink", "Copy Link")}</span>
                      </button>
                    </div>

                    {/* AI Probability Gauge */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span>{t("predictions.aiProbability")}</span>
                        <span className="font-mono text-neon-cyan">{pred.aiProbability}%</span>
                      </div>
                      <div className="w-full h-2 bg-dark-600 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pred.aiProbability}%` }}
                          transition={{ duration: 0.8 }}
                          className={`h-full rounded-full ${
                            pred.resolved
                              ? pred.outcome
                                ? "bg-gradient-to-r from-neon-green to-emerald-400"
                                : "bg-gradient-to-r from-neon-red to-orange-500"
                              : "bg-gradient-to-r from-neon-cyan to-neon-purple"
                          }`}
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500">
                        {tr("predictions.aiPick", "AI pick")}:{" "}
                        <span className="text-gray-300 font-mono">{Number(pred.aiProbability || 0) >= 50 ? "YES" : "NO"}</span>
                      </p>
                    </div>

                    {/* AI Reasoning (for resolved) */}
                    {pred.resolved && pred.aiReasoning && (
                      <div className="mb-3 p-2.5 rounded-lg bg-dark-700/80 border border-dark-500/50">
                        <p className="text-xs text-gray-400 mb-1 font-bold inline-flex items-center gap-1"><AppIcon name="brain" className="w-3.5 h-3.5" /> {t("predictions.aiReasoning")}</p>
                        <p className="text-xs text-gray-300 leading-relaxed">{pred.aiReasoning}</p>
                      </div>
                    )}

                    {typeof pred.userPrediction === "boolean" && (
                      <div className="mb-3 p-2.5 rounded-lg bg-dark-700/60 border border-dark-500/50 text-xs">
                        <p className="text-gray-300">
                          {tr("predictions.yourVote", "Your vote")}:{" "}
                          <span className={pred.userPrediction ? "text-neon-green" : "text-neon-red"}>
                            {pred.userPrediction ? tr("predictions.agree", "Agree") : tr("predictions.disagree", "Disagree")}
                          </span>
                        </p>
                        {pred.resolved && (
                          <p className="text-gray-400 mt-1">
                            {tr("predictions.result", "Result")}:{" "}
                            <span className={pred.userCorrect ? "text-neon-green" : "text-neon-red"}>
                              {pred.userCorrect ? tr("predictions.correct", "Correct") : tr("predictions.wrong", "Wrong")}
                            </span>
                            {" · "}
                            {tr("predictions.aiStatus", "AI")}:{" "}
                            <span className={pred.aiWasRight ? "text-neon-green" : "text-neon-gold"}>
                              {pred.aiWasRight ? tr("predictions.aiWasRight", "right") : tr("predictions.aiWasWrong", "wrong")}
                            </span>
                            {" · "}
                            {tr("predictions.reward", "Reward")}:{" "}
                            <span className="text-neon-cyan font-mono">+{Number(pred.rewardPoints ?? (pred.userCorrect ? (Number(pred.aiProbability || 0) >= 50) === Boolean(pred.outcome) ? 50 : 150 : 0))} pts</span>
                          </p>
                        )}
                      </div>
                    )}

                    {/* Votes */}
                    {totalVotes > 0 && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                        <span className="text-neon-green">👍 {pred.totalVotesYes || 0}</span>
                        <span className="text-neon-red">👎 {pred.totalVotesNo || 0}</span>
                        <span>· {totalVotes} {t("predictions.votes")}</span>
                      </div>
                    )}

                    {/* Vote Buttons (active + not expired + connected) */}
                    {!pred.resolved && !isExpired && isConnected && (
                      isOwnUserEvent ? (
                        <p className="text-xs text-gray-400 text-center mt-2">
                          {tr("predictions.creatorCannotVoteOwn", "You cannot vote on your own event")}
                        </p>
                      ) : typeof pred.userPrediction === "boolean" ? (
                        <p className="text-xs text-neon-cyan text-center mt-2">
                          {tr("predictions.alreadyVotedCard", "You already voted on this event")}
                        </p>
                      ) : (
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <button
                            onClick={() => handleVote(pred.eventId, true)}
                            disabled={isVotePending || isCheckInPending || isCheckInConfirming}
                            className="min-h-11 py-2.5 rounded-xl bg-neon-green/10 border border-neon-green/30 text-neon-green text-sm font-bold hover:bg-neon-green/20 transition disabled:opacity-50"
                          >
                          👍 {t("predictions.agree")}
                        </button>
                        <button
                          onClick={() => handleVote(pred.eventId, false)}
                          disabled={isVotePending || isCheckInPending || isCheckInConfirming}
                          className="min-h-11 py-2.5 rounded-xl bg-neon-red/10 border border-neon-red/30 text-neon-red text-sm font-bold hover:bg-neon-red/20 transition disabled:opacity-50"
                        >
                          👎 {t("predictions.disagree")}
                          </button>
                        </div>
                      )
                    )}

                    {/* Connect prompt */}
                    {!pred.resolved && !isExpired && !isConnected && (
                      <p className="text-xs text-gray-500 text-center mt-2">
                        {t("predictions.connectToVote")}
                      </p>
                    )}
                  </GlassCard>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {checkInModalOpen && isConnected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => (!isCheckInPending && !isCheckInConfirming) && setCheckInModalOpen(false)}
          >
            <motion.div
              initial={{ y: 20, scale: 0.98, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 20, scale: 0.98, opacity: 0 }}
              className="w-full max-w-lg rounded-2xl border border-neon-cyan/30 bg-dark-800 p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-white mb-2">{tr("predictions.checkInModalTitle", "Daily Check-In Required")}</h3>
              <p className="text-sm text-gray-400 mb-4">
                {tr("predictions.checkInModalSubtitle", "You must complete today's check-in before voting. Choose a tier:")}
              </p>
              {checkedToday && (
                <p className="text-xs text-neon-cyan mb-3">
                  {tr("predictions.checkInAlreadyToday", "You already completed check-in today")}
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                {CHECKIN_TIERS.map((tier, idx) => (
                  <button
                    key={tier.key}
                    onClick={() => setSelectedTier(idx)}
                    className={`p-3 rounded-xl border text-xs transition ${
                      selectedTier === idx ? "border-neon-cyan bg-neon-cyan/10" : "border-dark-500 bg-dark-700"
                    }`}
                  >
                    <div className={`font-bold ${tier.color}`}>{t(`tiers.${tier.key}`)}</div>
                    <div className="font-mono text-white mt-1">{tier.amount} BNB</div>
                    <div className="text-gray-400 mt-1">+{tier.pts} {t("common.pts")}</div>
                  </button>
                ))}
              </div>
              <button
                onClick={handleCheckInFromModal}
                disabled={checkedToday || isCheckInPending || isCheckInConfirming}
                className="w-full min-h-11 py-3 rounded-xl bg-gradient-to-r from-neon-cyan to-neon-purple text-dark-900 font-bold disabled:opacity-50"
              >
                {isCheckInPending
                  ? tr("checkin.confirming", "Confirm in wallet...")
                  : isCheckInConfirming
                    ? tr("checkin.processing", "Processing on-chain...")
                    : checkedToday
                      ? tr("predictions.checkInAlreadyToday", "You already completed check-in today")
                    : t("predictions.checkInModalAction", { amount: CHECKIN_TIERS[selectedTier].amount })}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
