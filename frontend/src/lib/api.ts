import { useI18n } from "./i18n";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").replace(/\/+$/, "");

function getLang(): string {
  try {
    return useI18n.getState().locale || "en";
  } catch {
    return "en";
  }
}

function langParam(base: string): string {
  const lang = getLang();
  if (lang === "en") return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}lang=${lang}`;
}

function langParamWithOverride(base: string, lang?: string): string {
  if (!lang) return langParam(base);
  if (lang === "en") return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}lang=${lang}`;
}

async function fetchAPI(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  return res.json();
}

export const api = {
  getStats: () => fetchAPI("/api/stats"),
  getActivity: (limit = 50) => fetchAPI(`/api/stats/activity?limit=${limit}`),
  getTgeForecast: () => fetchAPI("/api/stats/tge-forecast"),
  getContracts: () => fetchAPI("/api/stats/contracts"),
  getPredictions: (lang?: string) => fetchAPI(langParamWithOverride("/api/predictions", lang)),
  getResolvedPredictions: (lang?: string) => fetchAPI(langParamWithOverride("/api/predictions/resolved", lang)),
  getAllPredictions: (lang?: string) => fetchAPI(langParamWithOverride("/api/predictions/all", lang)),
  getUserVotedPredictions: (address: string, lang?: string) =>
    fetchAPI(langParamWithOverride(`/api/predictions/voted/${address}`, lang)),
  getSchedulerStatus: () => fetchAPI("/api/predictions/scheduler"),
  validateUserPredictionEvent: (payload: {
    title: string;
    category: string;
    deadlineMs: number;
    sourcePolicy: string;
    creator?: string;
  }) =>
    fetchAPI("/api/predictions/user/validate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  ingestUserPredictionEvent: (eventId: number) =>
    fetchAPI("/api/predictions/user/ingest", {
      method: "POST",
      body: JSON.stringify({ eventId }),
    }),
  generatePredictions: () => fetchAPI("/api/predictions/generate", { method: "POST" }),
  resolveEvent: (eventId: number, outcome: boolean) =>
    fetchAPI(`/api/predictions/${eventId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ outcome }),
    }),
  getLeaderboard: (limit = 100) => fetchAPI(`/api/leaderboard?limit=${limit}`),
  getCurrentPrizeEpoch: () => fetchAPI("/api/leaderboard/epoch/current"),
  getClaimProof: (address: string) => fetchAPI(`/api/leaderboard/claim-proof/${address}`),
  getUser: (address: string) => fetchAPI(`/api/user/${address}`),
  getUserHistory: (address: string) => fetchAPI(`/api/user/${address}/history`),
  getReferralCode: (address: string) => fetchAPI(`/api/user/${address}/referral-code`),
  getReferralStats: (address: string) => fetchAPI(`/api/user/${address}/referral-stats`),
  getCreatorStats: (address: string) => fetchAPI(`/api/user/${address}/creator-stats`),
  getOnboardingStatus: (address: string) => fetchAPI(`/api/user/${address}/onboarding`),
  registerReferral: (
    address: string,
    referrerCode: string,
    attribution?: {
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      utmContent?: string;
      eventId?: number;
      landingPath?: string;
    }
  ) =>
    fetchAPI(`/api/user/${address}/referral`, {
      method: "POST",
      body: JSON.stringify({ referrerCode, attribution }),
    }),
};
