import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import Sidebar from "@/components/Sidebar";
import ReferralOnboardingModal from "@/components/ReferralOnboardingModal";
import { Toaster } from "react-hot-toast";
import LiveBackground from "@/components/LiveBackground";

export const metadata: Metadata = {
  title: "OracleAI Predict",
  description: "Decentralized AI Prediction Platform",
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
