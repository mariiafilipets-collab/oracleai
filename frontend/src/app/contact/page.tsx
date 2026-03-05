"use client";

import { useI18n } from "@/lib/i18n";

export default function ContactPage() {
  const { t } = useI18n();
  const tr = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };
  return (
    <section className="section">
      <div className="container grid-2">
        <div>
          <p className="eyebrow">{tr("contactPage.eyebrow", "Contact us")}</p>
          <h1>{tr("contactPage.title", "Let's map your growth and forecasting strategy.")}</h1>
          <p>
            {tr(
              "contactPage.subtitle",
              "Share your goals and we will send a customized rollout plan with KPI targets, funnel ideas, and platform recommendations."
            )}
          </p>
          <div className="card mt-4">
            <h3>{tr("contactPage.directTitle", "Direct channels")}</h3>
            <p>{tr("contactPage.email", "Email")}: hello@oracleai-predict.app</p>
            <p>{tr("contactPage.partnerships", "Partnerships")}: partners@oracleai-predict.app</p>
            <p>{tr("contactPage.responseTime", "Response time: under 24 hours on business days.")}</p>
          </div>
        </div>

        <form action="https://formspree.io/f/your-form-id" method="POST" className="card contact-form">
          <label htmlFor="fullName">{tr("contactPage.form.fullName", "Full name")}</label>
          <input id="fullName" name="fullName" type="text" required />

          <label htmlFor="email">{tr("contactPage.form.workEmail", "Work email")}</label>
          <input id="email" name="email" type="email" required />

          <label htmlFor="company">{tr("contactPage.form.company", "Company / Project")}</label>
          <input id="company" name="company" type="text" required />

          <label htmlFor="reason">{tr("contactPage.form.reason", "What do you need?")}</label>
          <select id="reason" name="reason" required defaultValue="">
            <option value="" disabled>
              {tr("contactPage.form.selectOne", "Select one")}
            </option>
            <option value="demo">{tr("contactPage.form.demo", "Product demo")}</option>
            <option value="pricing">{tr("contactPage.form.pricing", "Pricing consultation")}</option>
            <option value="partnership">{tr("contactPage.form.partnership", "Partnership discussion")}</option>
            <option value="other">{tr("contactPage.form.other", "Other")}</option>
          </select>

          <label htmlFor="message">{tr("contactPage.form.message", "Message")}</label>
          <textarea id="message" name="message" rows={5} required />

          <button type="submit" className="btn btn-primary">
            {tr("contactPage.form.submit", "Send Message")}
          </button>
        </form>
      </div>
    </section>
  );
}
