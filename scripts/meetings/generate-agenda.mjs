#!/usr/bin/env node

const mode = process.env.MEETING_MODE || "release-council";
const agenda = {
  "daily-standup": [
    "Top delivered items (last 24h)",
    "Current blockers",
    "High-risk changes in flight",
    "Today priorities by role",
  ],
  "weekly-review": [
    "KPI trend (delivery and growth)",
    "Release quality and incidents",
    "Contract/backend/frontend roadmap",
    "Campaign performance and creative learnings",
  ],
  "release-council": [
    "Go/No-Go checks",
    "Rollback readiness",
    "Post-release monitoring plan",
    "Communications timeline",
  ],
  "incident-mode": [
    "Incident scope and user impact",
    "Mitigation steps in progress",
    "Root-cause hypothesis",
    "Recovery ETA and owner",
  ],
};

const list = agenda[mode] || agenda["release-council"];
console.log(`# Agenda: ${mode}\n`);
list.forEach((item, idx) => console.log(`${idx + 1}. ${item}`));
