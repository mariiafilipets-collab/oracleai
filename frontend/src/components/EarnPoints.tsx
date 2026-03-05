"use client";

import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

const EARN_KEYS = ["checkin", "prediction", "streak", "referrals", "staking", "prizes"];
const EARN_ICONS = ["🎯", "🔮", "🔥", "🌐", "💎", "🏆"];
const EARN_COLORS = [
  "text-neon-cyan", "text-neon-purple", "text-orange-400",
  "text-neon-green", "text-neon-gold", "text-yellow-400",
];
const EARN_BGS = [
  "bg-neon-cyan/10 border-neon-cyan/20", "bg-neon-purple/10 border-neon-purple/20",
  "bg-orange-500/10 border-orange-500/20", "bg-neon-green/10 border-neon-green/20",
  "bg-neon-gold/10 border-neon-gold/20", "bg-yellow-500/10 border-yellow-500/20",
];

export default function EarnPoints() {
  const { t } = useI18n();

  return (
    <div className="glass rounded-2xl p-5 lg:p-6">
      <h2 className="text-lg font-heading font-bold flex items-center gap-2 mb-4">
        <span>💰</span> {t("guide.howToEarn")}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {EARN_KEYS.map((key, i) => (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className={`p-4 rounded-xl border ${EARN_BGS[i]} group hover:scale-[1.02] transition-transform`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">{EARN_ICONS[i]}</span>
              <div>
                <h3 className="text-sm font-bold text-white">{t(`guide.earn.${key}.title`)}</h3>
                <span className={`text-xs font-mono font-bold ${EARN_COLORS[i]}`}>{t(`guide.earn.${key}.pts`)} {t("common.pts")}</span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-2">{t(`guide.earn.${key}.desc`)}</p>
            <p className="text-xs text-gray-500 italic opacity-0 group-hover:opacity-100 transition-opacity">{t(`guide.earn.${key}.tip`)}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
