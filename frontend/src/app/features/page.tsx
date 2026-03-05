"use client";

import { useI18n } from "@/lib/i18n";

export default function FeaturesPage() {
  const { t } = useI18n();
  const tr = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };
  const features = [
    { title: tr("featuresPage.items.ai.title", "Adaptive AI Forecasting"), body: tr("featuresPage.items.ai.body", "Generate high-signal predictions with real-time updates from market data and sentiment context.") },
    { title: tr("featuresPage.items.incentives.title", "On-Chain Incentive Engine"), body: tr("featuresPage.items.incentives.body", "Reward participation through transparent points, staking boosts, and referral logic.") },
    { title: tr("featuresPage.items.leaderboard.title", "Weekly Leaderboards"), body: tr("featuresPage.items.leaderboard.body", "Drive healthy competition and recurring engagement with merit-based rankings.") },
    { title: tr("featuresPage.items.api.title", "Predictive Analytics API"), body: tr("featuresPage.items.api.body", "Access event streams and confidence metrics for your own dashboards and automations.") },
    { title: tr("featuresPage.items.roles.title", "Role-Based Team Views"), body: tr("featuresPage.items.roles.body", "Give operators, analysts, and marketing teams purpose-built views from a single data layer.") },
    { title: tr("featuresPage.items.ab.title", "A/B-Ready Growth Layer"), body: tr("featuresPage.items.ab.body", "Test headlines, CTAs, and incentive messages without rebuilding your product flow.") },
  ];
  return (
    <section className="section">
      <div className="container">
        <p className="eyebrow">{tr("featuresPage.eyebrow", "Platform capabilities")}</p>
        <h1>{tr("featuresPage.title", "Everything your team needs to forecast, engage, and scale.")}</h1>
        <p>
          {tr("featuresPage.subtitle", "OracleAI Predict is designed around one goal: improve decisions while increasing user retention and trust.")}
        </p>
        <div className="grid-3 mt-6">
          {features.map((feature) => (
            <article className="card" key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
