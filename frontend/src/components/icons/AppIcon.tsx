export type IconName =
  | "home"
  | "prediction"
  | "leaderboard"
  | "profile"
  | "staking"
  | "tokenomics"
  | "litepaper"
  | "points"
  | "chart"
  | "streak"
  | "pool"
  | "target"
  | "activity"
  | "brain"
  | "users"
  | "check"
  | "medal"
  | "gold"
  | "silver"
  | "bronze"
  | "bank"
  | "globe"
  | "fire"
  | "diamond"
  | "lock"
  | "hourglass"
  | "downtrend"
  | "link"
  | "search"
  | "gamepad"
  | "chain"
  | "history"
  | "megaphone"
  | "tree"
  | "new"
  | "whale"
  | "send"
  | "camera"
  | "x";

const base = "inline-block align-middle";

export default function AppIcon({ name, className = "w-5 h-5", strokeWidth = 1.9 }: { name: IconName; className?: string; strokeWidth?: number }) {
  const c = `${base} ${className}`;
  const common = { className: c, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  switch (name) {
    case "home": return <svg {...common}><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M10 20v-6h4v6"/></svg>;
    case "prediction": return <svg {...common}><path d="M12 3c4.8 0 8 3.1 8 7.8 0 5.6-4.4 9.5-8 10.2-3.6-.7-8-4.6-8-10.2C4 6.1 7.2 3 12 3Z"/><path d="M9.8 11.2c1.3-2.2 3.7-2 4.9.1"/><circle cx="10" cy="9.1" r="0.8"/><circle cx="14" cy="9.1" r="0.8"/></svg>;
    case "leaderboard": return <svg {...common}><path d="M8 4h8v2a4 4 0 0 1-8 0V4Z"/><path d="M6 6H4a3 3 0 0 0 3 3"/><path d="M18 6h2a3 3 0 0 1-3 3"/><path d="M12 10v5"/><path d="M9 21h6"/><path d="M10 15h4v6h-4z"/></svg>;
    case "profile": return <svg {...common}><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c.7-4 3.9-6 7.5-6s6.8 2 7.5 6"/></svg>;
    case "staking": return <svg {...common}><path d="m12 3 8 4.6-8 4.6L4 7.6 12 3Z"/><path d="m4 7.6 8 4.6 8-4.6"/><path d="M6.6 12.8 12 16l5.4-3.2"/><path d="M6.6 16.6 12 20l5.4-3.4"/></svg>;
    case "tokenomics": return <svg {...common}><path d="M4 19h16"/><path d="M6 17V9"/><path d="M12 17V5"/><path d="M18 17v-6"/></svg>;
    case "litepaper": return <svg {...common}><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>;
    case "points": return <svg {...common}><path d="M12 3l2.6 5.3 5.8.8-4.2 4 1 5.8L12 16l-5.2 2.9 1-5.8-4.2-4 5.8-.8L12 3Z"/></svg>;
    case "chart": return <svg {...common}><path d="M4 19h16"/><path d="m5 15 4-4 3 2 6-6"/></svg>;
    case "streak": return <svg {...common}><path d="M12 3c1.4 2.2 1.8 4.6.7 6.4-.8 1.3-2.1 2.1-2.1 3.6 0 1.5 1 2.7 2.4 2.7 2.8 0 5-2.5 5-5.6 0-3.3-2.3-5.8-6-7.1Z"/><path d="M9.2 14.2c-1.9.8-3.2 2.4-3.2 4.7 0 1.6 1.2 3.1 3 3.1h6c1.8 0 3-1.5 3-3.1 0-2.4-1.4-4-3.3-4.8"/></svg>;
    case "pool": return <svg {...common}><path d="M4 8h16"/><path d="M5 8l1.2 9a3 3 0 0 0 3 2.6h5.6a3 3 0 0 0 3-2.6L19 8"/><path d="M9 8V6a3 3 0 1 1 6 0v2"/></svg>;
    case "target": return <svg {...common}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.2"/></svg>;
    case "activity": return <svg {...common}><path d="M3 12h4l2-4 4 8 2-4h6"/></svg>;
    case "brain": return <svg {...common}><path d="M9 6a3 3 0 0 1 6 0v.5a2.5 2.5 0 0 1 2.5 2.5 2.5 2.5 0 0 1-.8 1.8 2.4 2.4 0 0 1 .8 1.8 2.5 2.5 0 0 1-2.5 2.5v.5a3 3 0 0 1-6 0"/><path d="M9 7.5a2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 0 .8 1.8 2.4 2.4 0 0 0-.8 1.8A2.5 2.5 0 0 0 9 16"/></svg>;
    case "users": return <svg {...common}><circle cx="9" cy="9" r="2.8"/><circle cx="16.5" cy="10.5" r="2.2"/><path d="M3.5 19c.7-3 3-4.5 5.5-4.5 2.6 0 4.9 1.5 5.6 4.5"/><path d="M14.2 18.7c.5-2.1 2.1-3.4 4.1-3.8"/></svg>;
    case "check": return <svg {...common}><path d="m5 12 4 4 10-10"/></svg>;
    case "medal": return <svg {...common}><circle cx="12" cy="14" r="4"/><path d="M9 3h6l-1.2 4.2h-3.6L9 3Z"/><path d="m10.2 18.2 1.8 2.8 1.8-2.8"/></svg>;
    case "gold": return <svg {...common}><circle cx="12" cy="12" r="8"/><path d="m12 7 1.6 3.2 3.5.5-2.5 2.4.6 3.4-3.2-1.8-3.2 1.8.6-3.4-2.5-2.4 3.5-.5L12 7Z"/></svg>;
    case "silver": return <svg {...common}><circle cx="12" cy="12" r="8"/><path d="M9 12h6"/><path d="M12 9v6"/></svg>;
    case "bronze": return <svg {...common}><circle cx="12" cy="12" r="8"/><path d="M9 9h5a2 2 0 1 1 0 4H9z"/><path d="M9 13h5.5a2 2 0 1 1 0 4H9z"/></svg>;
    case "bank": return <svg {...common}><path d="M3 9h18"/><path d="m4 9 8-5 8 5"/><path d="M5 9v8"/><path d="M10 9v8"/><path d="M14 9v8"/><path d="M19 9v8"/><path d="M3 17h18"/></svg>;
    case "globe": return <svg {...common}><circle cx="12" cy="12" r="8"/><path d="M4.8 9h14.4"/><path d="M4.8 15h14.4"/><path d="M12 4a13 13 0 0 1 0 16"/><path d="M12 4a13 13 0 0 0 0 16"/></svg>;
    case "fire": return <svg {...common}><path d="M12 3c1.4 2.2 1.8 4.6.7 6.4-.8 1.3-2.1 2.1-2.1 3.6 0 1.5 1 2.7 2.4 2.7 2.8 0 5-2.5 5-5.6 0-3.3-2.3-5.8-6-7.1Z"/><path d="M9.5 14.6c-.9.5-1.5 1.3-1.5 2.5 0 1.4 1 2.4 2.5 2.4h3c1.5 0 2.5-1 2.5-2.4 0-1.2-.6-2-1.5-2.5"/></svg>;
    case "diamond": return <svg {...common}><path d="M4 10 8 5h8l4 5-8 9-8-9Z"/><path d="M8 5l4 14 4-14"/></svg>;
    case "lock": return <svg {...common}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 1 1 8 0v3"/></svg>;
    case "hourglass": return <svg {...common}><path d="M6 4h12"/><path d="M6 20h12"/><path d="M8 4c0 3.2 2 4.5 4 6 2-1.5 4-2.8 4-6"/><path d="M8 20c0-3.2 2-4.5 4-6 2 1.5 4 2.8 4 6"/></svg>;
    case "downtrend": return <svg {...common}><path d="M4 19h16"/><path d="m5 8 5 5 4-4 5 5"/><path d="M19 10v4h-4"/></svg>;
    case "link": return <svg {...common}><path d="M10 14 8.5 15.5a3.5 3.5 0 0 1-5-5L5 9"/><path d="m14 10 1.5-1.5a3.5 3.5 0 0 1 5 5L19 15"/><path d="M8 12h8"/></svg>;
    case "search": return <svg {...common}><circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/></svg>;
    case "gamepad": return <svg {...common}><rect x="4" y="9" width="16" height="8" rx="4"/><path d="M8 13h4"/><path d="M10 11v4"/><circle cx="15.5" cy="12.5" r="0.8"/><circle cx="17.5" cy="14.5" r="0.8"/></svg>;
    case "chain": return <svg {...common}><path d="M9 12a3 3 0 0 1 3-3h2"/><path d="M15 12a3 3 0 0 1-3 3h-2"/><path d="M7 9l-2 2 2 2"/><path d="M17 9l2 2-2 2"/></svg>;
    case "history": return <svg {...common}><path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v4h4"/><path d="M12 8v5l3 2"/></svg>;
    case "megaphone": return <svg {...common}><path d="M4 12v-2l9-4v10l-9-4v-2Z"/><path d="M13 8h3a3 3 0 0 1 0 6h-3"/><path d="M6 14v4"/></svg>;
    case "tree": return <svg {...common}><path d="M12 21v-4"/><path d="M7 17h10"/><path d="M8 14h8"/><path d="M9 11h6"/><path d="M12 4 8.5 8h7L12 4Z"/></svg>;
    case "new": return <svg {...common}><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 14V9l3 5V9"/><path d="M13 9h3"/><path d="M13 11h2.5"/><path d="M13 13h3"/><path d="M18 9v5"/></svg>;
    case "whale": return <svg {...common}><path d="M3 14c2.5-2.3 5.4-3.5 8.5-3.5 5.3 0 9 3.4 9.5 6.5-2.5 1.1-4.7 1.5-6.7 1.5-4.2 0-7.6-1.8-11.3-4.5Z"/><circle cx="16.5" cy="13.3" r="0.6"/><path d="M6 10c.2-1.2 1.2-2.2 2.4-2.4"/></svg>;
    case "send": return <svg {...common}><path d="m3 11 17-7-5 16-2.2-6.8L3 11Z"/><path d="M20 4 12.8 13.2"/></svg>;
    case "camera": return <svg {...common}><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8 7 9.2 5h5.6L16 7"/></svg>;
    case "x": return <svg {...common}><path d="m5 5 14 14"/><path d="M19 5 5 19"/></svg>;
    default: return null;
  }
}
