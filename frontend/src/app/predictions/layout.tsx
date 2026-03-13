import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Predictions",
  description: "Browse and vote on AI-generated prediction markets. Earn points for correct predictions on crypto, sports, politics, economy, and climate events.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
