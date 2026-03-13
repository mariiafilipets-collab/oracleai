const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Deploy OracleGovernance and InsurancePool contracts.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-governance.js --network localhost
 *   npx hardhat run scripts/deploy-governance.js --network bscTestnet
 */
async function main() {
  const signers = await ethers.getSigners();
  if (!signers.length) {
    throw new Error(`No deployer for "${network.name}". Set DEPLOYER_PRIVATE_KEY.`);
  }
  const [deployer] = signers;
  console.log("Deploying Governance & Insurance with:", deployer.address);
  console.log("Network:", network.name);

  // Load existing deployments to get OAIToken address
  const deploymentsFile = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  let deployments = {};
  if (fs.existsSync(deploymentsFile)) {
    deployments = JSON.parse(fs.readFileSync(deploymentsFile, "utf-8"));
  }

  const oaiTokenAddr = deployments.OAIToken;
  if (!oaiTokenAddr) {
    throw new Error("OAIToken not found in deployments. Deploy main contracts first.");
  }

  // Deploy OracleGovernance
  console.log("\n--- OracleGovernance ---");
  const Governance = await ethers.getContractFactory("OracleGovernance");
  const governance = await Governance.deploy(oaiTokenAddr);
  await governance.waitForDeployment();
  const govAddr = await governance.getAddress();
  console.log("OracleGovernance:", govAddr);

  // Deploy InsurancePool
  console.log("\n--- InsurancePool ---");
  const Insurance = await ethers.getContractFactory("InsurancePool");
  const insurance = await Insurance.deploy();
  await insurance.waitForDeployment();
  const insAddr = await insurance.getAddress();
  console.log("InsurancePool:", insAddr);

  // Update deployments
  deployments.OracleGovernance = govAddr;
  deployments.InsurancePool = insAddr;

  const outDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(deploymentsFile, JSON.stringify(deployments, null, 2));
  console.log(`\nDeployments updated in deployments/${network.name}.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
