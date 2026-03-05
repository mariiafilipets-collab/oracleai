"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount } from "wagmi";
import { useI18n } from "@/lib/i18n";

export default function WelcomeBanner() {
  const { isConnected } = useAccount();
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const dismissed = localStorage.getItem("oai-welcome-dismissed");
    if (!dismissed) setVisible(true);
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem("oai-welcome-dismissed", "1");
  };

  const tips = [
    { icon: "👋", title: t("welcome.title"), text: t("welcome.desc") },
    { icon: "1️⃣", title: t("welcome.step1title"), text: t("welcome.step1desc") },
    { icon: "2️⃣", title: t("welcome.step2title"), text: t("welcome.step2desc") },
    { icon: "3️⃣", title: t("welcome.step3title"), text: t("welcome.step3desc") },
  ];

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="relative glass rounded-2xl p-5 lg:p-6 border border-neon-cyan/30 mb-6 overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-gold" />
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{tips[step].icon}</span>
            <h2 className="text-base font-heading font-bold text-white">{tips[step].title}</h2>
          </div>
          <button onClick={dismiss} className="text-gray-500 hover:text-gray-300 text-sm px-2">✕</button>
        </div>
        <p className="text-sm text-gray-300 leading-relaxed mb-4 pl-12">{tips[step].text}</p>
        <div className="flex items-center justify-between pl-12">
          <div className="flex gap-1.5">
            {tips.map((_, i) => (
              <button key={i} onClick={() => setStep(i)} className={`w-2 h-2 rounded-full transition-all ${i === step ? "bg-neon-cyan w-6" : "bg-dark-500 hover:bg-dark-400"}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && <button onClick={() => setStep(step - 1)} className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white border border-dark-500 transition">{t("welcome.back")}</button>}
            {step < tips.length - 1 ? (
              <button onClick={() => setStep(step + 1)} className="px-4 py-1.5 rounded-lg text-xs font-bold bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 transition">{t("welcome.next")} →</button>
            ) : (
              <button onClick={dismiss} className="px-4 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-neon-cyan to-neon-purple text-dark-900 transition">{t("welcome.gotIt")}</button>
            )}
          </div>
        </div>
        {!isConnected && (
          <div className="mt-4 pl-12">
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-neon-gold/10 border border-neon-gold/20 text-xs text-neon-gold">
              <span>⚠️</span> {t("welcome.connectFirst")}
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
