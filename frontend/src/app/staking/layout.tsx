import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Staking",
  description: "Stake OAI tokens to earn points boosts, referral multipliers, and tier upgrades on OracleAI Predict.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
