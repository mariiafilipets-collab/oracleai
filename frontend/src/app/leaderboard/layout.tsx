import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "See the top predictors on OracleAI. Compete for weekly prizes and climb the rankings.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
