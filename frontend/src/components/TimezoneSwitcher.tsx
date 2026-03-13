"use client";

import { useMemo, useState } from "react";
import { getEffectiveOffsetMinutes, offsetLabel, useTimezone } from "@/lib/timezone";

function buildOffsets() {
  const out: number[] = [];
  for (let m = -12 * 60; m <= 14 * 60; m += 30) out.push(m);
  return out;
}

const OFFSETS = buildOffsets();

export default function TimezoneSwitcher({ compact = false }: { compact?: boolean }) {
  const { mode, fixedOffsetMinutes, setAuto, setFixedOffsetMinutes } = useTimezone();
  const [open, setOpen] = useState(false);
  const effective = getEffectiveOffsetMinutes(mode, fixedOffsetMinutes);
  const autoLabel = useMemo(() => `Auto (${offsetLabel(getEffectiveOffsetMinutes("auto", 0))})`, []);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-dark-700 border border-dark-500 text-sm hover:border-neon-cyan/30 transition ${
          compact ? "min-h-10 w-auto" : "w-full"
        }`}
      >
        <span className="text-neon-cyan font-mono text-xs">{offsetLabel(effective)}</span>
        {!compact && <span className="text-gray-400 text-xs">{mode === "auto" ? "Auto" : "Manual"}</span>}
        <span className="text-gray-600 text-[10px] ml-auto">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          className={`absolute bg-dark-700 border border-dark-500 rounded-xl overflow-hidden z-50 shadow-xl max-h-72 overflow-y-auto ${
            compact ? "top-full mt-1 right-0 min-w-[190px]" : "bottom-full mb-1 left-0 right-0"
          }`}
        >
          <button
            onClick={() => {
              setAuto();
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-2.5 text-xs hover:bg-dark-600 transition ${
              mode === "auto" ? "text-neon-cyan bg-neon-cyan/5" : "text-gray-300"
            }`}
          >
            {autoLabel}
          </button>
          {OFFSETS.map((offset) => (
            <button
              key={offset}
              onClick={() => {
                setFixedOffsetMinutes(offset);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2.5 text-xs hover:bg-dark-600 transition ${
                mode === "fixed" && fixedOffsetMinutes === offset
                  ? "text-neon-cyan bg-neon-cyan/5"
                  : "text-gray-400"
              }`}
            >
              {offsetLabel(offset)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
