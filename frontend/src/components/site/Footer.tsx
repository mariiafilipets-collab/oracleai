"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";

export default function Footer() {
  const { t } = useI18n();
  const tr = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <h3>{tr("common.brandName", "OracleAI Predict")}</h3>
          <p>
            {tr(
              "footer.tagline",
              "The AI forecasting layer for modern Web3 communities. Build confidence with transparent, high-signal predictions."
            )}
          </p>
        </div>
        <div>
          <h4>{tr("footer.company", "Company")}</h4>
          <ul>
            <li>
              <Link href="/about">{tr("nav.about", "About")}</Link>
            </li>
            <li>
              <Link href="/features">{tr("nav.features", "Features")}</Link>
            </li>
            <li>
              <Link href="/pricing">{tr("nav.pricing", "Pricing")}</Link>
            </li>
          </ul>
        </div>
        <div>
          <h4>{tr("footer.resources", "Resources")}</h4>
          <ul>
            <li>
              <Link href="/blog">{tr("nav.blog", "Blog")}</Link>
            </li>
            <li>
              <Link href="/litepaper">{tr("nav.litepaper", "Litepaper")}</Link>
            </li>
            <li>
              <Link href="/contact">{tr("nav.contact", "Contact")}</Link>
            </li>
          </ul>
        </div>
        <div>
          <h4>{tr("footer.social", "Social")}</h4>
          <ul>
            <li>
              <a href="https://x.com" target="_blank" rel="noreferrer">
                {tr("footer.xTwitter", "X / Twitter")}
              </a>
            </li>
            <li>
              <a href="https://discord.com" target="_blank" rel="noreferrer">
                Discord
              </a>
            </li>
            <li>
              <a href="https://github.com" target="_blank" rel="noreferrer">
                GitHub
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="container footer-base">
        <span>
          © {new Date().getFullYear()} {tr("common.brandName", "OracleAI Predict")}.{" "}
          {tr("footer.rightsReserved", "All rights reserved.")}
        </span>
        <span>{tr("footer.bottomTagline", "Built for trust, speed, and conversion.")}</span>
      </div>
    </footer>
  );
}
