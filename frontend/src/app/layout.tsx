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
      <body className="bg-dark-900 min-h-screen">
        <LiveBackground />
        <Providers>
          <Sidebar />
          <main className="relative z-10 lg:ml-64 pt-16 lg:pt-0 pb-20 lg:pb-0 min-h-screen">
            <div className="max-w-7xl mx-auto p-4 lg:p-8">{children}</div>
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
