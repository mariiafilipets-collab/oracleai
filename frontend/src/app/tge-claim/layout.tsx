import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TGE Claim",
  description: "Claim your OAI tokens at the Token Generation Event. Convert earned points to OAI.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
