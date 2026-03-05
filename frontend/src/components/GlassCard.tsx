"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: "cyan" | "purple" | "gold" | "green";
  id?: string;
}

export default function GlassCard({
  children,
  className = "",
  hover = true,
  glow,
  id,
}: GlassCardProps) {
  const glowColor = {
    cyan: "hover:shadow-neon-cyan/20 hover:border-neon-cyan/30",
    purple: "hover:shadow-neon-purple/20 hover:border-neon-purple/30",
    gold: "hover:shadow-neon-gold/20 hover:border-neon-gold/30",
    green: "hover:shadow-neon-green/20 hover:border-neon-green/30",
  };

  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`
        glass rounded-2xl p-6 transition-all duration-300
        ${hover ? "glass-hover cursor-pointer" : ""}
        ${glow ? glowColor[glow] : ""}
        ${className}
      `}
    >
      {children}
    </motion.div>
  );
}
