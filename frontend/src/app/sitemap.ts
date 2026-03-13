import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://oracleai-predict.app";
  const routes: { path: string; priority: number; freq: "daily" | "weekly" | "monthly" }[] = [
    { path: "/", priority: 1, freq: "daily" },
    { path: "/predictions", priority: 0.9, freq: "daily" },
    { path: "/leaderboard", priority: 0.8, freq: "daily" },
    { path: "/staking", priority: 0.7, freq: "weekly" },
    { path: "/tokenomics", priority: 0.7, freq: "monthly" },
    { path: "/litepaper", priority: 0.7, freq: "monthly" },
    { path: "/tge-claim", priority: 0.6, freq: "weekly" },
    { path: "/about", priority: 0.5, freq: "monthly" },
    { path: "/features", priority: 0.5, freq: "monthly" },
    { path: "/pricing", priority: 0.5, freq: "monthly" },
    { path: "/blog", priority: 0.5, freq: "weekly" },
    { path: "/contact", priority: 0.4, freq: "monthly" },
  ];

  return routes.map((r) => ({
    url: `${base}${r.path}`,
    lastModified: new Date(),
    changeFrequency: r.freq,
    priority: r.priority,
  }));
}
