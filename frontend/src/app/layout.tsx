import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import Sidebar from "@/components/Sidebar";
import ReferralOnboardingModal from "@/components/ReferralOnboardingModal";
import { Toaster } from "react-hot-toast";
import LiveBackground from "@/components/LiveBackground";

export const metadata: Metadata = {
  title: {
    default: "OracleAI Predict — Decentralized AI Prediction Platform",
    template: "%s | OracleAI Predict",
  },
  description:
    "Predict real-world events, earn points, and win rewards on the AI-powered decentralized prediction market on BNB Chain.",
  keywords: [
    "prediction market",
    "AI predictions",
    "BNB Chain",
    "crypto",
    "decentralized",
    "oracle",
    "DeFi",
    "gamification",
  ],
  metadataBase: new URL("https://oracleai-predict.app"),
  openGraph: {
    type: "website",
    siteName: "OracleAI Predict",
    title: "OracleAI Predict — Decentralized AI Prediction Platform",
    description:
      "Predict real-world events, earn points, and win rewards on the AI-powered decentralized prediction market on BNB Chain.",
    url: "https://oracleai-predict.app",
    images: [{ url: "/brand/oracleai-logo-v2.png", width: 512, height: 512, alt: "OracleAI Predict" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "OracleAI Predict",
    description:
      "AI-powered prediction market on BNB Chain. Predict, earn, win.",
    images: ["/brand/oracleai-logo-v2.png"],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-dark-900 min-h-screen antialiased">
        <LiveBackground />
        <Providers>
          <Sidebar />
          <main className="relative z-10 lg:ml-64 pt-16 lg:pt-0 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-0 min-h-screen">
            <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 lg:py-8">{children}</div>
          </main>
          <ReferralOnboardingModal />
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: "#0f1425",
                color: "#e2e8f0",
                border: "1px solid rgba(0,240,255,0.2)",
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
