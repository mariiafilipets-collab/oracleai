const { ethers, upgrades, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Deploy PredictionNFT behind a UUPS proxy.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-nft.js --network localhost
 *   npx hardhat run scripts/deploy-nft.js --network bscTestnet
 */
async function main() {
  const signers = await ethers.getSigners();
  if (!signers.length) {
    throw new Error(
      `No deployer account for "${network.name}". Set DEPLOYER_PRIVATE_KEY.`
    );
  }
  const [deployer] = signers;
  console.log("Deploying PredictionNFT with:", deployer.address);
  console.log("Network:", network.name);

  const baseURI = process.env.NFT_BASE_URI || "https://oracleai-predict.app/api/nft/";

  // Deploy behind UUPS proxy
  const PredictionNFT = await ethers.getContractFactory("PredictionNFT");
  const nft = await upgrades.deployProxy(
    PredictionNFT,
    ["OracleAI Prediction Streak", "OAINFT", baseURI],
    { kind: "uups" }
  );
  await nft.waitForDeployment();

  const proxyAddr = await nft.getAddress();
  const implAddr = await upgrades.erc1967.getImplementationAddress(proxyAddr);

  console.log("PredictionNFT Proxy:", proxyAddr);
  console.log("PredictionNFT Impl:", implAddr);

  // Optionally grant MINTER_ROLE to the Prediction contract
  const deploymentsFile = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (fs.existsSync(deploymentsFile)) {
    const deployments = JSON.parse(fs.readFileSync(deploymentsFile, "utf-8"));
    if (deployments.Prediction) {
      const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
      const tx = await nft.grantRole(MINTER_ROLE, deployments.Prediction);
      await tx.wait();
      console.log("MINTER_ROLE granted to Prediction:", deployments.Prediction);
    }

    // Update deployments file
    deployments.PredictionNFT = proxyAddr;
    deployments.PredictionNFTImpl = implAddr;
    fs.writeFileSync(deploymentsFile, JSON.stringify(deployments, null, 2));
    console.log(`Deployments updated in deployments/${network.name}.json`);
  } else {
    // Save standalone
    const outDir = path.join(__dirname, "..", "deployments");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const data = {
      PredictionNFT: proxyAddr,
      PredictionNFTImpl: implAddr,
      deployer: deployer.address,
      network: network.name,
      deployedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(outDir, `${network.name}-nft.json`),
      JSON.stringify(data, null, 2)
    );
    console.log(`Saved to deployments/${network.name}-nft.json`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
