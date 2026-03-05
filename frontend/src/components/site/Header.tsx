"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Image from "next/image";
import ThemeToggle from "./ThemeToggle";
import { useI18n } from "@/lib/i18n";

const navItems = [
  { href: "/", key: "home" },
  { href: "/about", key: "about" },
  { href: "/features", key: "features" },
  { href: "/pricing", key: "pricing" },
  { href: "/blog", key: "blog" },
  { href: "/contact", key: "contact" },
];

export default function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const tr = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  return (
    <header className="site-header">
      <div className="container nav-shell">
        <Link href="/" className="brand" aria-label="OracleAI Predict homepage">
          <span className="brand-mark" aria-hidden>
            <Image src="/images/oracleai-logo.png" alt="" width={46} height={46} />
          </span>
          <span className="brand-text">OracleAI Predict</span>
        </Link>

        <nav className="desktop-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname === item.href ? "active" : ""}
            >
              {tr(`nav.${item.key}`, item.key)}
            </Link>
          ))}
        </nav>

        <div className="nav-actions">
          <ThemeToggle />
          <a className="btn btn-ghost" href="/predictions">
            {tr("common.launchApp", "Launch App")}
          </a>
          <button
            type="button"
            className="menu-btn"
            aria-expanded={open}
            aria-label="Toggle navigation"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? tr("common.close", "Close") : tr("common.menu", "Menu")}
          </button>
        </div>
      </div>

      {open && (
        <nav className="mobile-nav container" aria-label="Mobile navigation">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
              {tr(`nav.${item.key}`, item.key)}
            </Link>
          ))}
          <a href="/predictions" onClick={() => setOpen(false)}>
            {tr("common.launchApp", "Launch App")}
          </a>
        </nav>
      )}
    </header>
  );
}
