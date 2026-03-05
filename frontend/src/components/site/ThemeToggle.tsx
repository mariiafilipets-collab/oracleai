"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

type Theme = "light" | "dark";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const { t } = useI18n();
  const tr = (key: string, fallback: string, params?: Record<string, string | number>) => {
    const value = t(key, params);
    return value === key ? fallback : value;
  };

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme") as Theme | null;
    if (current) setTheme(current);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("oai-theme", next);
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="theme-toggle"
      aria-label={tr("theme.switchAria", "Switch to {mode} mode", { mode: theme === "dark" ? tr("theme.light", "light") : tr("theme.dark", "dark") })}
    >
      <span aria-hidden>{theme === "dark" ? "☀️" : "🌙"}</span>
      <span>{theme === "dark" ? tr("theme.light", "Light") : tr("theme.dark", "Dark")}</span>
    </button>
  );
}
