import { create } from "zustand";
import { persist } from "zustand/middleware";
import enMessages from "../messages/en.json";

export const LOCALES = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "zh", name: "中文", flag: "🇨🇳" },
  { code: "ru", name: "Русский", flag: "🇷🇺" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
  { code: "ar", name: "العربية", flag: "🇸🇦", rtl: true },
] as const;
function isRtlLocale(locale: string) {
  const entry = LOCALES.find((l) => l.code === locale) as { rtl?: boolean } | undefined;
  return !!entry?.rtl;
}


export type LocaleCode = (typeof LOCALES)[number]["code"];

type Messages = Record<string, any>;

interface I18nState {
  locale: LocaleCode;
  messages: Messages;
  hydrated: boolean;
  setLocale: (locale: LocaleCode) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const messageCache: Record<string, Messages> = { en: enMessages };

function deferAfterFirstPaint(fn: () => void) {
  if (typeof window === "undefined") {
    fn();
    return;
  }
  // Ensure persisted locale is applied only after initial hydration/paint.
  requestAnimationFrame(() => {
    requestAnimationFrame(fn);
  });
}

async function loadMessages(locale: string): Promise<Messages> {
  if (messageCache[locale]) return messageCache[locale];
  try {
    const mod = await import(`../messages/${locale}.json`);
    messageCache[locale] = mod.default;
    return mod.default;
  } catch {
    return enMessages;
  }
}

function getNestedValue(obj: any, path: string): string {
  const keys = path.split(".");
  let current = obj;
  for (const key of keys) {
    if (current === undefined || current === null) return path;
    current = current[key];
  }
  return typeof current === "string" ? current : path;
}

export const useI18n = create<I18nState>()(
  persist(
    (set, get) => ({
      locale: "en",
      messages: enMessages as Messages,
      hydrated: false,

      setLocale: async (locale: LocaleCode) => {
        const messages = await loadMessages(locale);
        set({ locale, messages, hydrated: true });
        if (typeof document !== "undefined") {
          document.documentElement.lang = locale;
          document.documentElement.dir = isRtlLocale(locale) ? "rtl" : "ltr";
        }
      },

      t: (key: string, params?: Record<string, string | number>) => {
        const { messages, hydrated } = get();
        // Prevent hydration mismatch: use SSR-compatible EN messages before client rehydration completes.
        const source = hydrated ? messages : (enMessages as Messages);
        let value = getNestedValue(source, key);
        if (params) {
          Object.entries(params).forEach(([k, v]) => {
            value = value.replace(`{${k}}`, String(v));
          });
        }
        return value;
      },
    }),
    {
      name: "oai-locale",
      partialize: (state) => ({ locale: state.locale }),
      merge: (_persistedState, currentState) => {
        return {
          ...currentState,
          // Keep locale/messages SSR-stable for initial client render.
          locale: "en",
          // Keep EN messages for first client render to match SSR.
          messages: currentState.messages,
          hydrated: false,
        };
      },
      onRehydrateStorage: () => {
        return (state) => {
          if (!state) return;
          let persistedLocale: LocaleCode = "en";
          try {
            const raw = localStorage.getItem("oai-locale");
            if (raw) {
              const parsed = JSON.parse(raw);
              const code = parsed?.state?.locale;
              if (typeof code === "string") persistedLocale = code as LocaleCode;
            }
          } catch {}
          if (persistedLocale !== "en") {
            deferAfterFirstPaint(() => {
              loadMessages(persistedLocale).then((messages) => {
                useI18n.setState({ locale: persistedLocale, messages, hydrated: true });
                if (typeof document !== "undefined") {
                  document.documentElement.lang = persistedLocale;
                  document.documentElement.dir = isRtlLocale(persistedLocale) ? "rtl" : "ltr";
                }
              });
            });
          } else {
            deferAfterFirstPaint(() => {
              useI18n.setState({ locale: "en", hydrated: true });
              if (typeof document !== "undefined") {
                document.documentElement.lang = "en";
                document.documentElement.dir = "ltr";
              }
            });
          }
        };
      },
    }
  )
);
