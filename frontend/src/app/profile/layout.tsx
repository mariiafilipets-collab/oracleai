import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your OracleAI dashboard — points, streaks, prediction accuracy, referral stats, and badges.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
