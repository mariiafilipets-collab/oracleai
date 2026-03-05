"use client";

import { useState, useRef, useEffect } from "react";
import { LOCALES, useI18n, type LocaleCode } from "@/lib/i18n";

export default function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = LOCALES.find((l) => l.code === locale) || LOCALES[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-dark-700 border border-dark-500 text-sm hover:border-neon-cyan/30 transition w-full"
      >
        <span>{current.flag}</span>
        <span className="text-gray-300 text-xs">{current.name}</span>
        <span className="text-gray-600 text-[10px] ml-auto">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute bottom-full mb-1 left-0 right-0 bg-dark-700 border border-dark-500 rounded-xl overflow-hidden z-50 shadow-xl">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              onClick={() => {
                setLocale(l.code as LocaleCode);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-dark-600 transition ${
                l.code === locale ? "text-neon-cyan bg-neon-cyan/5" : "text-gray-400"
              }`}
            >
              <span>{l.flag}</span>
              <span>{l.name}</span>
              {l.code === locale && <span className="ml-auto text-neon-cyan">*</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
