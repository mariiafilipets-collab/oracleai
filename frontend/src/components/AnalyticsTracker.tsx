"use client";

import { useEffect } from "react";
import { useAccount } from "wagmi";
import { trackPageView, identifyUser } from "@/lib/analytics";

/**
 * Tracks page views and identifies connected wallet users.
 * Drop into Providers to enable automatic analytics.
 */
export default function AnalyticsTracker() {
  const { address, isConnected } = useAccount();

  // Track page views on route changes
  useEffect(() => {
    trackPageView();
  }, []);

  // Identify user when wallet connects
  useEffect(() => {
    if (isConnected && address) {
      identifyUser(address, { chain: "bnb" });
    }
  }, [isConnected, address]);

  return null;
}
