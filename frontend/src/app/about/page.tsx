"use client";

import { useI18n } from "@/lib/i18n";

export default function AboutPage() {
  const { t } = useI18n();
  const tr = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  return (
    <section className="section">
      <div className="container">
        <p className="eyebrow">{tr("aboutPage.eyebrow", "Our mission")}</p>
        <h1>{tr("aboutPage.title", "We help communities predict with clarity, not hype.")}</h1>
        <p>
          {tr(
            "aboutPage.intro",
            "OracleAI Predict started with one question: why do smart teams still make expensive market decisions with weak signals? We built a platform that blends machine learning and verifiable on-chain data, so every decision has context, confidence, and accountability."
          )}
        </p>

        <div className="grid-2 mt-6">
          <article className="card">
            <h3>{tr("aboutPage.beliefTitle", "What we believe")}</h3>
            <ul>
              <li>{tr("aboutPage.belief1", "Signals should be transparent, not mysterious.")}</li>
              <li>{tr("aboutPage.belief2", "Communities should be rewarded for high-quality participation.")}</li>
              <li>{tr("aboutPage.belief3", "Forecasting tools should be usable by non-technical teams.")}</li>
            </ul>
          </article>
          <article className="card">
            <h3>{tr("aboutPage.deliverTitle", "What we deliver")}</h3>
            <ul>
              <li>{tr("aboutPage.deliver1", "AI-assisted prediction events with clear confidence scoring.")}</li>
              <li>{tr("aboutPage.deliver2", "On-chain rewards and referrals with full traceability.")}</li>
              <li>{tr("aboutPage.deliver3", "A polished, mobile-first interface optimized for conversion.")}</li>
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}
