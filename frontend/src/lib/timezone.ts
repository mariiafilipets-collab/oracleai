"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type TimezoneMode = "auto" | "fixed";

interface TimezoneState {
  mode: TimezoneMode;
  fixedOffsetMinutes: number;
  setAuto: () => void;
  setFixedOffsetMinutes: (offsetMinutes: number) => void;
}

export const useTimezone = create<TimezoneState>()(
  persist(
    (set) => ({
      mode: "auto",
      fixedOffsetMinutes: 0,
      setAuto: () => set({ mode: "auto" }),
      setFixedOffsetMinutes: (offsetMinutes) =>
        set({
          mode: "fixed",
          fixedOffsetMinutes: Math.max(-12 * 60, Math.min(14 * 60, Math.round(offsetMinutes))),
        }),
    }),
    {
      name: "oai-timezone",
      partialize: (state) => ({
        mode: state.mode,
        fixedOffsetMinutes: state.fixedOffsetMinutes,
      }),
    }
  )
);

export function getEffectiveOffsetMinutes(mode: TimezoneMode, fixedOffsetMinutes: number): number {
  if (mode === "fixed") return fixedOffsetMinutes;
  return -new Date().getTimezoneOffset();
}

export function offsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}

export function formatInOffset(isoOrDate: string | number | Date, offsetMinutes: number): string {
  const date = new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const mo = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d} ${hh}:${mm} ${offsetLabel(offsetMinutes)}`;
}
