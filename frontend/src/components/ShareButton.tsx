"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { trackEvent } from "@/lib/analytics";
import { api } from "@/lib/api";

interface ShareButtonProps {
  title: string;
  eventId?: number;
  className?: string;
}

export default function ShareButton({ title, eventId, className = "" }: ShareButtonProps) {
  const { address } = useAccount();
  const [shared, setShared] = useState(false);

  const referralSuffix = address ? `?ref=${address.slice(2, 10).toUpperCase()}` : "";
  const shareUrl = `https://oracleai-predict.app/predictions${referralSuffix}`;
  const shareText = `${title}\n\nPredict and earn on @OracleAI_Predict`;

  const handleShare = async (platform: "twitter" | "telegram" | "copy") => {
    trackEvent("share", { platform, eventId, title: title.slice(0, 50) });

    if (platform === "twitter") {
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
        "_blank",
        "noopener,noreferrer"
      );
    } else if (platform === "telegram") {
      window.open(
        `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`,
        "_blank",
        "noopener,noreferrer"
      );
    } else {
      try {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        toast.success("Copied to clipboard!");
      } catch {
        toast.error("Copy failed");
      }
    }

    // Track share for quest progress
    if (address && !shared) {
      setShared(true);
      try {
        await api.updateQuestProgress(address, "daily-share", 1);
      } catch {}
    }
  };

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <button
        onClick={() => handleShare("twitter")}
        className="p-1.5 rounded-lg bg-dark-700/50 hover:bg-dark-700 text-gray-400 hover:text-white transition-colors"
        title="Share on X"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </button>
      <button
        onClick={() => handleShare("telegram")}
        className="p-1.5 rounded-lg bg-dark-700/50 hover:bg-dark-700 text-gray-400 hover:text-white transition-colors"
        title="Share on Telegram"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
      </button>
      <button
        onClick={() => handleShare("copy")}
        className="p-1.5 rounded-lg bg-dark-700/50 hover:bg-dark-700 text-gray-400 hover:text-white transition-colors"
        title="Copy link"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
    </div>
  );
}
