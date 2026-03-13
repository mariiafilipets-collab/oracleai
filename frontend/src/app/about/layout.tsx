import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description: "Learn about OracleAI Predict — the AI-powered decentralized prediction market on BNB Chain.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
