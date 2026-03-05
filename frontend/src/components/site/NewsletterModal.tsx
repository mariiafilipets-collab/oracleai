"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

export default function NewsletterModal() {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const tr = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  useEffect(() => {
    const dismissed = localStorage.getItem("oai-newsletter-dismissed");
    if (dismissed) return;
    const timer = window.setTimeout(() => setOpen(true), 4500);
    return () => window.clearTimeout(timer);
  }, []);

  const close = () => {
    setOpen(false);
    localStorage.setItem("oai-newsletter-dismissed", "1");
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="newsletter-title">
      <div className="modal-card">
        <button type="button" onClick={close} className="modal-close" aria-label={tr("newsletter.closeAria", "Close popup")}>
          ✕
        </button>
        <p className="kicker">{tr("newsletter.kicker", "Free Growth Playbook")}</p>
        <h3 id="newsletter-title">{tr("newsletter.title", "Get 15 high-converting launch templates")}</h3>
        <p>
          {tr(
            "newsletter.body",
            "Join 12,000+ founders and traders receiving weekly AI + Web3 growth insights. No spam. One-click unsubscribe."
          )}
        </p>
        <form action="https://formspree.io/f/your-form-id" method="POST" className="newsletter-form">
          <label htmlFor="newsletter-email" className="sr-only">
            {tr("newsletter.emailLabel", "Email address")}
          </label>
          <input
            id="newsletter-email"
            type="email"
            name="email"
            placeholder="you@company.com"
            required
          />
          <button className="btn btn-primary" type="submit">
            {tr("newsletter.submit", "Send me the templates")}
          </button>
        </form>
      </div>
    </div>
  );
}
