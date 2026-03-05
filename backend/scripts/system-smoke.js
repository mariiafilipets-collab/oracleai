import { ethers } from "ethers";
import fs from "fs";
import path from "path";

const API = "http://localhost:3001";
const RPC = "http://127.0.0.1:8545";

const HARDHAT_PK_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const HARDHAT_PK_1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const provider = new ethers.JsonRpcProvider(RPC);
const admin = new ethers.Wallet(HARDHAT_PK_0, provider);
const user = new ethers.Wallet(HARDHAT_PK_1, provider);

const checkInAbi = [
  "function checkIn() external payable",
];
const predictionAbi = [
  "function submitPrediction(uint256 eventId, bool prediction) external",
  "function getUserVote(uint256 eventId, address account) external view returns (bool voted, bool prediction)",
];
const referralAbi = [
  "function hasReferrer(address user) external view returns (bool)",
  "function pendingEarnings(address user) external view returns (uint256)",
];
const prizePoolV2Abi = [
  "function claim(uint256 epoch,uint256 index,address account,uint256 amount,bytes32[] calldata merkleProof) external",
];

const results = [];
function add(status, check, details = "") {
  results.push({ status, check, details });
}

async function api(pathname, options) {
  const r = await fetch(`${API}${pathname}`, options);
  return r.json();
}

async function run() {
  const deployPath = path.resolve("d:/OAI/contracts/deployments/localhost.json");
  const addresses = JSON.parse(fs.readFileSync(deployPath, "utf-8"));

  const checkIn = new ethers.Contract(addresses.CheckIn, checkInAbi, user);
  const prediction = new ethers.Contract(addresses.Prediction, predictionAbi, user);
  const referralAsAdmin = new ethers.Contract(addresses.Referral, referralAbi, admin);
  const prizePoolV2 = new ethers.Contract(addresses.PrizePoolV2, prizePoolV2Abi, user);

  try {
    const health = await api("/api/health");
    add(health.status === "ok" ? "PASS" : "FAIL", "Backend health", JSON.stringify(health));
  } catch (e) {
    add("FAIL", "Backend health", e.message);
  }

  let contractsResp;
  try {
    contractsResp = await api("/api/stats/contracts");
    add(contractsResp?.success ? "PASS" : "FAIL", "Contracts endpoint", "available");
  } catch (e) {
    add("FAIL", "Contracts endpoint", e.message);
  }

  let enPred = [];
  let ruPred = [];
  try {
    const en = await api("/api/predictions?lang=en");
    const ru = await api("/api/predictions?lang=ru");
    enPred = en?.data || [];
    ruPred = ru?.data || [];
    add(en?.success && ru?.success && enPred.length > 0 ? "PASS" : "FAIL", "Predictions API EN/RU", `en=${enPred.length}, ru=${ruPred.length}`);
    if (enPred[0] && ruPred[0]) {
      add(enPred[0].title !== ruPred[0].title ? "PASS" : "FAIL", "Event translation diff EN vs RU", `en="${enPred[0].title}" ru="${ruPred[0].title}"`);
    } else {
      add("FAIL", "Event translation diff EN vs RU", "missing sample event");
    }
  } catch (e) {
    add("FAIL", "Predictions API EN/RU", e.message);
  }

  try {
    const scheduler = await api("/api/predictions/scheduler");
    add(scheduler?.success ? "PASS" : "FAIL", "Scheduler status endpoint", scheduler?.data?.weeklyResetIn || "");
  } catch (e) {
    add("FAIL", "Scheduler status endpoint", e.message);
  }

  try {
    const stats = await api("/api/stats");
    add(stats?.success ? "PASS" : "FAIL", "Stats endpoint", `users=${stats?.data?.totalUsers}, checkins=${stats?.data?.totalCheckIns}`);
  } catch (e) {
    add("FAIL", "Stats endpoint", e.message);
  }

  try {
    const onboard = await api(`/api/user/${user.address}/onboarding`);
    add(onboard?.success ? "PASS" : "FAIL", "Onboarding endpoint", JSON.stringify(onboard?.data || {}));
  } catch (e) {
    add("FAIL", "Onboarding endpoint", e.message);
  }

  let hadReferrer = false;
  try {
    hadReferrer = await referralAsAdmin.hasReferrer(user.address);
    if (!hadReferrer) {
      const reg = await api(`/api/user/${user.address}/referral`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referrerCode: "ORACLEAI" }),
      });
      add(reg?.success ? "PASS" : "FAIL", "Register referral ORACLEAI", reg?.error || reg?.referrer || "");
    } else {
      add("PASS", "Register referral ORACLEAI", "already had referrer");
    }
  } catch (e) {
    add("FAIL", "Register referral ORACLEAI", e.message);
  }

  let pendingBefore = 0n;
  try {
    pendingBefore = await referralAsAdmin.pendingEarnings(admin.address);
  } catch {}

  try {
    const tx = await checkIn.checkIn({ value: ethers.parseEther("0.0015") });
    await tx.wait();
    add("PASS", "Check-in transaction", tx.hash);
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes("Already checked in today")) {
      add("SKIP", "Check-in transaction", "already checked in today for this wallet");
    } else {
      add("FAIL", "Check-in transaction", msg);
    }
  }

  try {
    const pendingAfter = await referralAsAdmin.pendingEarnings(admin.address);
    add(pendingAfter >= pendingBefore ? "PASS" : "FAIL", "Referral pending earnings accrual", `before=${pendingBefore} after=${pendingAfter}`);
  } catch (e) {
    add("FAIL", "Referral pending earnings accrual", e.message);
  }

  try {
    const fresh = await api("/api/predictions?lang=en");
    const list = fresh?.data || [];
    if (!list.length) {
      add("FAIL", "Voting flow", "no active events");
    } else {
      let selectedId = null;
      for (const evt of list.slice(0, 10)) {
        const eventId = Number(evt.eventId);
        const existing = await prediction.getUserVote(BigInt(eventId), user.address);
        if (!existing.voted) {
          selectedId = eventId;
          break;
        }
      }
      if (!selectedId) {
        add("SKIP", "Voting flow", "user already voted in sampled active events");
      } else {
        const nonce = await provider.getTransactionCount(user.address, "pending");
        const tx = await prediction.submitPrediction(BigInt(selectedId), true, { nonce });
        await tx.wait();
        const vote = await prediction.getUserVote(BigInt(selectedId), user.address);
        add(vote?.voted ? "PASS" : "FAIL", "Voting flow", `eventId=${selectedId} tx=${tx.hash}`);
      }
    }
  } catch (e) {
    add("FAIL", "Voting flow", e.message);
  }

  try {
    const claimProof = await api(`/api/leaderboard/claim-proof/${user.address}`);
    if (claimProof?.success && claimProof?.data && !claimProof.data.claimed) {
      const d = claimProof.data;
      const tx = await prizePoolV2.claim(
        BigInt(d.epoch),
        BigInt(d.index),
        user.address,
        BigInt(d.amount),
        d.proof
      );
      await tx.wait();
      add("PASS", "Weekly prize claim flow", tx.hash);
    } else {
      add("SKIP", "Weekly prize claim flow", "no claimable epoch for this wallet");
    }
  } catch (e) {
    add("FAIL", "Weekly prize claim flow", e.message);
  }

  try {
    const aiUsage = await api("/api/ai/usage");
    add(aiUsage?.success ? "PASS" : "FAIL", "AI usage monitor endpoint", JSON.stringify(aiUsage?.data?.totals || {}));
  } catch (e) {
    add("FAIL", "AI usage monitor endpoint", e.message);
  }

  const summary = {
    pass: results.filter((r) => r.status === "PASS").length,
    fail: results.filter((r) => r.status === "FAIL").length,
    skip: results.filter((r) => r.status === "SKIP").length,
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (summary.fail > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

