import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Litepaper",
  description: "OracleAI Predict litepaper — architecture, AI pipeline, gamification mechanics, and roadmap.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
