import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tokenomics",
  description: "OAI token distribution, fee structure, burn mechanics, and staking rewards explained.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
