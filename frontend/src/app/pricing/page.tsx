"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";

export default function PricingPage() {
  const { t } = useI18n();
  const tr = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };
  return (
    <section className="section">
      <div className="container">
        <p className="eyebrow">{tr("pricingPage.eyebrow", "Pricing plans")}</p>
        <h1>{tr("pricingPage.title", "Simple tiers. Predictable growth.")}</h1>
        <p>{tr("pricingPage.subtitle", "Start free, validate quickly, and scale into advanced automation when your volume grows.")}</p>
        <div className="grid-3 mt-6">
          <article className="card">
            <h3>{tr("pricingPage.starter.title", "Starter")}</h3>
            <h4>$0/mo</h4>
            <p>{tr("pricingPage.starter.desc", "Ideal for validating your first prediction funnel.")}</p>
            <ul>
              <li>{tr("pricingPage.starter.f1", "Up to 5 live prediction events")}</li>
              <li>{tr("pricingPage.starter.f2", "Basic leaderboard and referral settings")}</li>
              <li>{tr("pricingPage.starter.f3", "Email support")}</li>
            </ul>
            <Link href="/contact" className="btn btn-ghost">
              {tr("pricingPage.starter.cta", "Get Started")}
            </Link>
          </article>

          <article className="card pricing-popular">
            <p className="eyebrow">{tr("pricingPage.popular", "Most popular")}</p>
            <h3>{tr("pricingPage.growth.title", "Growth")}</h3>
            <h4>$99/mo</h4>
            <p>{tr("pricingPage.growth.desc", "For active communities and performance-focused teams.")}</p>
            <ul>
              <li>{tr("pricingPage.growth.f1", "Unlimited prediction events")}</li>
              <li>{tr("pricingPage.growth.f2", "Advanced AI confidence tuning")}</li>
              <li>{tr("pricingPage.growth.f3", "Conversion analytics + A/B hooks")}</li>
            </ul>
            <Link href="/contact" className="btn btn-primary">
              {tr("pricingPage.growth.cta", "Start Growth Plan")}
            </Link>
          </article>

          <article className="card">
            <h3>{tr("pricingPage.enterprise.title", "Enterprise")}</h3>
            <h4>{tr("pricingPage.enterprise.price", "Custom")}</h4>
            <p>{tr("pricingPage.enterprise.desc", "Designed for high-volume ecosystems and regulated workflows.")}</p>
            <ul>
              <li>{tr("pricingPage.enterprise.f1", "Dedicated infrastructure")}</li>
              <li>{tr("pricingPage.enterprise.f2", "Custom API and SLA")}</li>
              <li>{tr("pricingPage.enterprise.f3", "Security and compliance review")}</li>
            </ul>
            <Link href="/contact" className="btn btn-ghost">
              {tr("pricingPage.enterprise.cta", "Talk to Sales")}
            </Link>
          </article>
        </div>
      </div>
    </section>
  );
}
