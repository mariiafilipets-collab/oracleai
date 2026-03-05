import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        dark: {
          900: "#050810",
          800: "#0a0e1a",
          700: "#0f1425",
          600: "#161b2e",
          500: "#1e2438",
        },
        neon: {
          cyan: "#00f0ff",
          purple: "#a855f7",
          pink: "#ec4899",
          gold: "#fbbf24",
          green: "#22c55e",
          red: "#ef4444",
        },
      },
      fontFamily: {
        heading: ["Space Grotesk", "Noto Sans", "Noto Sans SC", "Noto Sans Arabic", "sans-serif"],
        mono: ["JetBrains Mono", "Noto Sans", "monospace"],
      },
      animation: {
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "float": "float 3s ease-in-out infinite",
        "slide-up": "slide-up 0.5s ease-out",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 20px rgba(0, 240, 255, 0.3)" },
          "50%": { boxShadow: "0 0 40px rgba(0, 240, 255, 0.6)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "slide-up": {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
