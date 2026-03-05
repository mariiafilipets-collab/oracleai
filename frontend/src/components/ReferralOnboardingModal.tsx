"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

function getRefFromQuery(): string {
  if (typeof window === "undefined") return "";
  return (new URLSearchParams(window.location.search).get("ref") || "").trim().toUpperCase();
}

function isCentralWallet(address?: string): boolean {
  const configured = (process.env.NEXT_PUBLIC_CENTRAL_WALLET || "").trim().toLowerCase();
  return !!address && !!configured && address.toLowerCase() === configured;
}

export default function ReferralOnboardingModal() {
  const { address, isConnected } = useAccount();
  const { t } = useI18n();
  const tr = (key: string, fallback: string, params?: Record<string, string | number>) => {
    const val = t(key, params);
    return val === key ? fallback : val;
  };
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [code, setCode] = useState("");
  const autoAppliedRef = useRef(false);

  useEffect(() => {
    if (!isConnected || !address) {
      setOpen(false);
      setCode("");
      autoAppliedRef.current = false;
      return;
    }

    let cancelled = false;
    if (isCentralWallet(address)) {
      setOpen(false);
      setChecking(false);
      return;
    }
    setChecking(true);
    api
      .getOnboardingStatus(address)
      .then((res) => {
        if (cancelled || !res?.success) return;
        const shouldOpen = !res.data?.hasReferrer;
        if (shouldOpen) {
          const prefetchedRef = getRefFromQuery();
          if (prefetchedRef) setCode(prefetchedRef);
          setOpen(true);
        } else {
          setOpen(false);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isConnected, address]);

  const submitCode = async (codeOverride?: unknown) => {
    if (!address) return;
    const rawCode = typeof codeOverride === "string" ? codeOverride : code;
    const finalCode = rawCode.trim().toUpperCase();
    if (!finalCode) {
      toast.error(tr("referralOnboarding.codeRequired", "Enter a referral code"));
      return;
    }
    setLoading(true);
    try {
      const res = await api.registerReferral(address, finalCode);
      if (!res?.success) {
        toast.error(res?.error || tr("referralOnboarding.invalidCode", "Invalid referral code"));
        return;
      }
      toast.success(tr("referralOnboarding.success", "Referral code applied successfully"));
      setOpen(false);
    } catch {
      toast.error(tr("referralOnboarding.failed", "Failed to apply referral code"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || loading) return;
    const prefetchedRef = getRefFromQuery();
    if (!prefetchedRef || autoAppliedRef.current) return;
    autoAppliedRef.current = true;
    setCode(prefetchedRef);
    void submitCode(prefetchedRef);
  }, [open, loading]);

  if (!open || checking) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-neon-cyan/30 bg-dark-800 p-6 shadow-2xl">
        <h3 className="text-xl font-heading font-bold text-white mb-2">{tr("referralOnboarding.title", "Enter Partner Code")}</h3>
        <p className="text-sm text-gray-400 mb-4">{tr("referralOnboarding.subtitle", "Referral code is required. Add partner code to unlock platform access and referral tracking.")}</p>
        <label className="text-xs text-gray-500 mb-2 block">{tr("referralOnboarding.inputLabel", "Partner / Referral Code")}</label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder={tr("referralOnboarding.inputPlaceholder", "Example: ABCD1234")}
          className="w-full px-4 py-3 rounded-xl bg-dark-700 border border-dark-500 font-mono text-neon-cyan focus:outline-none focus:border-neon-cyan/50"
          maxLength={24}
        />
        <p className="text-xs text-gray-500 mt-2">{tr("referralOnboarding.hint", "If you came from a partner link, the code may be pre-filled automatically.")}</p>
        <div className="mt-5 flex gap-3">
          <button
            onClick={() => {
              void submitCode();
            }}
            disabled={loading}
            className="ml-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-neon-cyan text-dark-900 font-bold text-sm hover:opacity-90 transition disabled:opacity-50"
          >
            {loading ? t("common.loading") : tr("referralOnboarding.apply", "Apply Code")}
          </button>
        </div>
      </div>
    </div>
  );
}

