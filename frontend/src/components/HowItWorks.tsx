"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useI18n } from "@/lib/i18n";

const STEP_KEYS = ["1", "2", "3", "4", "5"];
const STEP_ICONS = ["🔗", "🎯", "🔮", "🏆", "🪂"];
const STEP_COLORS = [
  "from-blue-500 to-cyan-500",
  "from-cyan-500 to-teal-500",
  "from-purple-500 to-pink-500",
  "from-yellow-500 to-orange-500",
  "from-green-500 to-emerald-500",
];

export default function HowItWorks() {
  const [expanded, setExpanded] = useState<number | null>(null);
  const { t } = useI18n();

  return (
    <div className="glass rounded-2xl p-5 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-heading font-bold flex items-center gap-2">
          <span>📖</span> {t("guide.howItWorks")}
        </h2>
        <span className="text-xs text-gray-500">{t("guide.tapForDetails")}</span>
      </div>

      <div className="space-y-2">
        {STEP_KEYS.map((key, idx) => (
          <motion.div
            key={key}
            layout
            onClick={() => setExpanded(expanded === idx ? null : idx)}
            className="cursor-pointer"
          >
            <div className={`flex items-center gap-3 p-3 rounded-xl transition-all ${expanded === idx ? "bg-dark-600 border border-neon-cyan/20" : "bg-dark-700/50 border border-transparent hover:bg-dark-600/50"}`}>
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${STEP_COLORS[idx]} flex items-center justify-center text-lg shrink-0`}>{STEP_ICONS[idx]}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-500">{t("guide.step")} {parseInt(key)}</span>
                  <h3 className="text-sm font-bold text-white">{t(`guide.steps.${key}.title`)}</h3>
                </div>
                <p className="text-xs text-gray-400 truncate">{t(`guide.steps.${key}.desc`)}</p>
              </div>
              <motion.span animate={{ rotate: expanded === idx ? 180 : 0 }} className="text-gray-500 text-xs">▼</motion.span>
            </div>
            <AnimatePresence>
              {expanded === idx && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                  <div className="px-3 pb-3 pt-2">
                    <p className="text-sm text-gray-300 leading-relaxed pl-[52px]">{t(`guide.steps.${key}.detail`)}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
