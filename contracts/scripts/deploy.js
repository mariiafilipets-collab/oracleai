const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const signers = await ethers.getSigners();
  if (!signers.length) {
    throw new Error(
      `No deployer account available for network "${network.name}". Set DEPLOYER_PRIVATE_KEY in contracts/.env.`
    );
  }
  const [deployer] = signers;
  const CENTRAL_WALLET = process.env.CENTRAL_WALLET || "0x8973987BF03AeA074daB64a98fe13D2538C1302b";
  if (!ethers.isAddress(CENTRAL_WALLET)) {
    throw new Error(`Invalid CENTRAL_WALLET: ${CENTRAL_WALLET}`);
  }
  console.log("Deploying with:", deployer.address);
  console.log("Target network:", network.name);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("Central wallet:", CENTRAL_WALLET);
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  // 1. OAI Token
  const OAIToken = await ethers.getContractFactory("OAIToken");
  const oaiToken = await OAIToken.deploy();
  await oaiToken.waitForDeployment();
  console.log("OAIToken:", await oaiToken.getAddress());

  // 2. Points
  const Points = await ethers.getContractFactory("Points");
  const points = await Points.deploy();
  await points.waitForDeployment();
  console.log("Points:", await points.getAddress());

  // 3. PrizePool
  const PrizePool = await ethers.getContractFactory("PrizePool");
  const prizePool = await PrizePool.deploy();
  await prizePool.waitForDeployment();
  console.log("PrizePool:", await prizePool.getAddress());

  // 3b. PrizePoolV2 (claim model, gas-safe for large winner sets)
  const PrizePoolV2 = await ethers.getContractFactory("PrizePoolV2");
  const prizePoolV2 = await PrizePoolV2.deploy();
  await prizePoolV2.waitForDeployment();
  console.log("PrizePoolV2:", await prizePoolV2.getAddress());

  // 4. Referral
  const Referral = await ethers.getContractFactory("Referral");
  const referral = await Referral.deploy();
  await referral.waitForDeployment();
  console.log("Referral:", await referral.getAddress());

  // 5. CheckIn
  const treasury = CENTRAL_WALLET;
  const burnReserve = CENTRAL_WALLET;
  const stakingRewards = CENTRAL_WALLET;

  const CheckIn = await ethers.getContractFactory("CheckIn");
  const checkIn = await CheckIn.deploy(
    await points.getAddress(),
    await referral.getAddress(),
    await prizePool.getAddress(),
    treasury,
    burnReserve,
    stakingRewards
  );
  await checkIn.waitForDeployment();
  console.log("CheckIn:", await checkIn.getAddress());

  // 6. Staking
  const Staking = await ethers.getContractFactory("Staking");
  const staking = await Staking.deploy(await oaiToken.getAddress());
  await staking.waitForDeployment();
  console.log("Staking:", await staking.getAddress());

  // 7. Prediction
  const Prediction = await ethers.getContractFactory("Prediction");
  const prediction = await Prediction.deploy(
    await points.getAddress(),
    treasury,
    await prizePool.getAddress(),
    await referral.getAddress(),
    burnReserve,
    stakingRewards
  );
  await prediction.waitForDeployment();
  console.log("Prediction:", await prediction.getAddress());

  // --- Grant roles ---
  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));

  // Points: grant OPERATOR to CheckIn and Prediction
  await points.grantRole(OPERATOR_ROLE, await checkIn.getAddress());
  await points.grantRole(OPERATOR_ROLE, await prediction.getAddress());
  console.log("Points: OPERATOR granted to CheckIn & Prediction");

  // Referral: grant OPERATOR to CheckIn and Prediction
  await referral.grantRole(OPERATOR_ROLE, await checkIn.getAddress());
  await referral.grantRole(OPERATOR_ROLE, await prediction.getAddress());
  // Also grant deployer to support backend referral onboarding registration flow.
  await referral.grantRole(OPERATOR_ROLE, deployer.address);
  console.log("Referral: OPERATOR granted to CheckIn, Prediction & deployer");

  // PrizePool: grant DISTRIBUTOR to deployer (for weekly distribution)
  const DISTRIBUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISTRIBUTOR_ROLE"));
  await prizePool.grantRole(DISTRIBUTOR_ROLE, deployer.address);
  console.log("PrizePool: DISTRIBUTOR granted to deployer");
  await prizePoolV2.grantRole(DISTRIBUTOR_ROLE, deployer.address);
  console.log("PrizePoolV2: DISTRIBUTOR granted to deployer");

  // CheckIn: set staking contract
  await checkIn.setStakingContract(await staking.getAddress());
  console.log("CheckIn: Staking contract linked");

  // Referral: set staking contract (for referral boost)
  await referral.setStakingContract(await staking.getAddress());
  console.log("Referral: Staking contract linked");

  // --- Save deployment addresses ---
  const addresses = {
    OAIToken: await oaiToken.getAddress(),
    Points: await points.getAddress(),
    PrizePool: await prizePool.getAddress(),
    PrizePoolV2: await prizePoolV2.getAddress(),
    Referral: await referral.getAddress(),
    CheckIn: await checkIn.getAddress(),
    Staking: await staking.getAddress(),
    Prediction: await prediction.getAddress(),
    Treasury: treasury,
    BurnReserve: burnReserve,
    StakingRewards: stakingRewards,
    deployer: deployer.address,
    chainId,
    network: network.name,
    deployedAt: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = `${network.name}.json`;
  fs.writeFileSync(
    path.join(outDir, outFile),
    JSON.stringify(addresses, null, 2)
  );
  console.log(`\nDeployment saved to deployments/${outFile}`);
  console.log(JSON.stringify(addresses, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
