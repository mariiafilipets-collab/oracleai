"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import LanguageSwitcher from "./LanguageSwitcher";
import TimezoneSwitcher from "./TimezoneSwitcher";
import { useI18n } from "@/lib/i18n";
import Image from "next/image";
import AppIcon, { type IconName } from "./icons/AppIcon";

const NAV_KEYS = [
  { href: "/", key: "home", icon: "home" },
  { href: "/predictions", key: "predictions", icon: "prediction" },
  { href: "/leaderboard", key: "leaderboard", icon: "leaderboard" },
  { href: "/profile", key: "profile", icon: "profile" },
  { href: "/staking", key: "staking", icon: "staking" },
  { href: "/tge-claim", key: "tgeClaim", icon: "points" },
  { href: "/tokenomics", key: "tokenomics", icon: "tokenomics" },
  { href: "/litepaper", key: "litepaper", icon: "litepaper" },
] as const;

export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 h-screen fixed left-0 top-0 bg-dark-800/90 border-r border-dark-500 backdrop-blur-xl z-40">
        <div className="p-6">
          <div className="rounded-2xl p-3 border border-neon-cyan/20 bg-dark-700/70">
            <Image
              src="/brand/oracleai-logo-clean.svg"
              alt="OracleAI Predict"
              width={220}
              height={96}
              className="w-full h-auto"
              priority
            />
          </div>
          <p suppressHydrationWarning className="text-xs text-gray-500 mt-1">{t("common.slogan")}</p>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {NAV_KEYS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                pathname === item.href
                  ? "bg-neon-cyan/10 text-neon-cyan neon-border shadow-[0_0_20px_rgba(0,240,255,0.12)]"
                  : "text-gray-400 hover:bg-dark-600 hover:text-gray-200"
              }`}
            >
              <span className="text-lg"><AppIcon name={item.icon as IconName} className="w-[18px] h-[18px]" /></span>
              <span suppressHydrationWarning className="font-medium">{t(`nav.${item.key}`)}</span>
            </Link>
          ))}
        </nav>

        <div className="p-4 space-y-3">
          <TimezoneSwitcher />
          <LanguageSwitcher />
          <ConnectButton.Custom>
            {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
              if (!mounted || !account || !chain) {
                return (
                  <button onClick={openConnectModal} className="w-full py-3 rounded-xl bg-gradient-to-r from-neon-cyan to-neon-purple text-dark-900 font-bold text-sm hover:opacity-90 transition">
                    <span suppressHydrationWarning>{t("common.connectWallet")}</span>
                  </button>
                );
              }
              return (
                <button onClick={openAccountModal} className="w-full py-3 px-4 rounded-xl glass glass-hover text-sm font-mono truncate">
                  {account.displayName}
                </button>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </aside>

      {/* Mobile Bottom Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-dark-800/95 backdrop-blur-lg border-t border-dark-500 z-50 px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar snap-x snap-mandatory">
          {NAV_KEYS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`snap-start shrink-0 min-w-[72px] min-h-11 flex flex-col items-center justify-center gap-1 px-2 py-1 rounded-lg text-[11px] leading-none transition ${
                pathname === item.href ? "text-neon-cyan bg-neon-cyan/10" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              <span className="text-lg"><AppIcon name={item.icon as IconName} className="w-[18px] h-[18px]" /></span>
              <span suppressHydrationWarning>{t(`nav.${item.key}`)}</span>
            </Link>
          ))}
        </div>
      </nav>

      {/* Mobile Top Bar */}
      <header className="lg:hidden fixed top-0 left-0 right-0 bg-dark-800/95 backdrop-blur-lg border-b border-dark-500 z-50 px-3 py-2.5 flex items-center justify-between gap-2">
        <Image
          src="/brand/oracleai-logo-clean.svg"
          alt="OracleAI Predict"
          width={148}
          height={52}
          className="h-7 sm:h-8 w-auto"
          priority
        />
        <div className="shrink-0 flex items-center gap-2">
          <TimezoneSwitcher compact />
          <LanguageSwitcher compact />
        </div>
        <ConnectButton.Custom>
          {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
            if (!mounted || !account || !chain) {
              return (
              <button onClick={openConnectModal} className="min-h-10 px-2.5 sm:px-3 py-2 rounded-lg bg-gradient-to-r from-neon-cyan to-neon-purple text-dark-900 font-bold text-[11px] sm:text-xs">
                  <span suppressHydrationWarning>{t("common.connect")}</span>
                </button>
              );
            }
            return (
              <button onClick={openAccountModal} className="min-h-10 px-2.5 sm:px-3 py-2 rounded-lg glass text-[11px] sm:text-xs font-mono max-w-[106px] sm:max-w-[120px] truncate">
                {account.displayName}
              </button>
            );
          }}
        </ConnectButton.Custom>
      </header>
    </>
  );
}
