const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;
  const deployFile = path.join(__dirname, "..", "deployments", `${network === "hardhat" ? "localhost" : network}.json`);

  let deployments = {};
  if (fs.existsSync(deployFile)) {
    deployments = JSON.parse(fs.readFileSync(deployFile, "utf8"));
  }

  console.log("Deployer:", deployer.address);
  console.log("Network:", network);

  // ─── 1. Deploy OracleTimelock (48h delay) ────────────────────────
  console.log("\n--- Deploying OracleTimelock ---");
  const OracleTimelock = await ethers.getContractFactory("OracleTimelock");

  // Deployer is both proposer and executor for testnet
  // In production: use multisig addresses
  const proposers = [deployer.address];
  const executors = [deployer.address];
  const admin = deployer.address; // In production: address(0) to renounce

  const timelock = await OracleTimelock.deploy(proposers, executors, admin);
  await timelock.waitForDeployment();
  const timelockAddr = await timelock.getAddress();
  console.log("OracleTimelock deployed:", timelockAddr);

  deployments.OracleTimelock = timelockAddr;

  // ─── 2. Deploy OAIVesting for Team (6mo cliff, 2yr vest) ────────
  console.log("\n--- Deploying OAIVesting (Team) ---");
  const OAIVesting = await ethers.getContractFactory("OAIVesting");

  const now = Math.floor(Date.now() / 1000);
  const SIX_MONTHS = 180 * 24 * 60 * 60;
  const TWO_YEARS = 730 * 24 * 60 * 60;
  const ONE_YEAR = 365 * 24 * 60 * 60;

  const teamVesting = await OAIVesting.deploy(
    deployer.address, // beneficiary (in prod: team multisig)
    now,              // start now
    TWO_YEARS,        // 2-year total vest
    SIX_MONTHS        // 6-month cliff
  );
  await teamVesting.waitForDeployment();
  const teamVestingAddr = await teamVesting.getAddress();
  console.log("TeamVesting deployed:", teamVestingAddr);
  console.log("  Cliff: 6 months, Total: 2 years");

  deployments.TeamVesting = teamVestingAddr;

  // ─── 3. Deploy OAIVesting for Marketing (no cliff, 1yr vest) ────
  console.log("\n--- Deploying OAIVesting (Marketing) ---");
  const marketingVesting = await OAIVesting.deploy(
    deployer.address, // beneficiary
    now,
    ONE_YEAR,         // 1-year vest
    0                 // no cliff
  );
  await marketingVesting.waitForDeployment();
  const marketingVestingAddr = await marketingVesting.getAddress();
  console.log("MarketingVesting deployed:", marketingVestingAddr);
  console.log("  Cliff: none, Total: 1 year");

  deployments.MarketingVesting = marketingVestingAddr;

  // ─── 4. Deploy OAIVesting for Ecosystem (no cliff, 1yr vest) ────
  console.log("\n--- Deploying OAIVesting (Ecosystem) ---");
  const ecosystemVesting = await OAIVesting.deploy(
    deployer.address, // beneficiary
    now,
    ONE_YEAR,         // 1-year vest
    0                 // no cliff
  );
  await ecosystemVesting.waitForDeployment();
  const ecosystemVestingAddr = await ecosystemVesting.getAddress();
  console.log("EcosystemVesting deployed:", ecosystemVestingAddr);
  console.log("  Cliff: none, Total: 1 year");

  deployments.EcosystemVesting = ecosystemVestingAddr;

  // ─── Save deployments ───────────────────────────────────────────
  fs.writeFileSync(deployFile, JSON.stringify(deployments, null, 2));
  console.log("\n✅ All deployed. Updated", deployFile);

  console.log("\n--- Next Steps ---");
  console.log("1. Transfer OAI team tokens (120M) to TeamVesting:", teamVestingAddr);
  console.log("2. Transfer OAI marketing tokens (30M) to MarketingVesting:", marketingVestingAddr);
  console.log("3. Transfer OAI ecosystem tokens (20M) to EcosystemVesting:", ecosystemVestingAddr);
  console.log("4. Transfer ownership of CheckIn, Prediction to OracleTimelock:", timelockAddr);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
