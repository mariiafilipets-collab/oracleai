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

const BSC_TESTNET = { chainId: 97, name: "bsc-testnet" };

async function connectRpc() {
  const urls = [config.rpcUrl].concat(config.rpcFallbackUrl ? [config.rpcFallbackUrl] : []);
  const network = config.deploymentNetwork === "bscTestnet" ? BSC_TESTNET : undefined;
  for (const url of urls) {
    if (!url) continue;
    try {
      const p = new ethers.JsonRpcProvider(url, network);
      await p.getBlockNumber();
      console.log("[Blockchain] RPC connected:", url.replace(/\/\/[^@]+@/, "//***@"));
      return p;
    } catch (err) {
      console.warn("[Blockchain] RPC unreachable:", url.replace(/\/\/[^@]+@/, "//***@"), err?.message || err);
    }
  }
  const primary = config.rpcUrl || "http://127.0.0.1:8545";
  throw new Error(
    `RPC unreachable. Set RPC_URL (and optionally RPC_FALLBACK_URL) in env. Primary: ${primary}. ` +
    "From cloud (e.g. Render) some public RPCs block datacenter IPs — try https://bsc-testnet.publicnode.com or another provider."
  );
}

export async function initBlockchain() {
  provider = await connectRpc();
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
