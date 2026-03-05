import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import config from "../config/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let provider, signer, contracts = {};

function loadABI(name) {
  const abiPath = path.join(__dirname, "..", "..", "..", "contracts", "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(abiPath)) return null;
  return JSON.parse(fs.readFileSync(abiPath, "utf8")).abi;
}

function loadAddresses() {
  const deploymentName = config.deploymentNetwork || "localhost";
  const preferredPath = path.join(__dirname, "..", "..", "..", "contracts", "deployments", `${deploymentName}.json`);
  if (fs.existsSync(preferredPath)) {
    return JSON.parse(fs.readFileSync(preferredPath, "utf8"));
  }
  const fallbackPath = path.join(__dirname, "..", "..", "..", "contracts", "deployments", "localhost.json");
  if (deploymentName !== "localhost" && fs.existsSync(fallbackPath)) {
    console.warn(`[Blockchain] Deployment "${deploymentName}.json" not found, falling back to localhost.json`);
    return JSON.parse(fs.readFileSync(fallbackPath, "utf8"));
  }
  return null;
}

export async function initBlockchain() {
  provider = new ethers.JsonRpcProvider(config.rpcUrl);
  signer = config.deployerKey ? new ethers.Wallet(config.deployerKey, provider) : null;

  const addresses = loadAddresses();
  if (!addresses) {
    console.warn("No deployment found. Deploy contracts first.");
    return;
  }

  const contractNames = ["OAIToken", "Points", "PrizePool", "PrizePoolV2", "Referral", "CheckIn", "Staking", "Prediction"];
  for (const name of contractNames) {
    const abi = loadABI(name);
    if (abi && addresses[name]) {
      try {
        const code = await provider.getCode(addresses[name]);
        if (!code || code === "0x") {
          console.warn(`[Blockchain] ${name} not deployed at ${addresses[name]} (no bytecode)`);
          continue;
        }
        contracts[name] = new ethers.Contract(addresses[name], abi, signer || provider);
      } catch (err) {
        console.warn(`[Blockchain] Failed to init ${name}:`, err?.message || err);
      }
    }
  }

  if (!signer) {
    console.warn("[Blockchain] DEPLOYER_PRIVATE_KEY is empty: started in read-only mode.");
  }
  console.log("Blockchain service initialized. Contracts:", Object.keys(contracts).join(", "));
  return { provider, signer, contracts, addresses };
}

export function getContracts() {
  return contracts;
}

export function getProvider() {
  return provider;
}

export function getSigner() {
  return signer;
}

export function getAddresses() {
  return loadAddresses();
}
