const { ethers } = require("hardhat");

const OLD = {
  Points: "0x6055C3975B7eD7d753464297B6657a5152b2b7f7",
  PrizePool: "0x5950f6e818b3945FD09442428C7a3D3BFC9De89d",
  Referral: "0xa2fB0cBeb887155dEc3669F93dfb919f7aaBB359",
  Prediction: "0x7a6210BD2a3C1233209dC4a2b53BcA267CDE5532",
};

const POINTS_ABI = [
  "function getUserCount() view returns (uint256)",
  "function allUsers(uint256) view returns (address)",
  "function getUserPoints(address user) view returns ((uint256 points,uint256 weeklyPoints,uint256 streak,uint256 lastCheckIn,uint256 totalCheckIns,uint256 correctPredictions,uint256 totalPredictions))",
  "function addPoints(address user, uint256 amount, uint256 streak)",
  "function grantRole(bytes32 role, address account)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

const PRIZEPOOL_ABI = [
  "function getBalance() view returns (uint256)",
  "function emergencyWithdraw(address to)",
];

const REFERRAL_ABI = [
  "function hasReferrer(address user) view returns (bool)",
  "function referrer(address user) view returns (address)",
  "function registerReferral(address user, address ref)",
];

const PREDICTION_ABI = [
  "function eventCount() view returns (uint256)",
  "function getEvent(uint256 eventId) view returns ((uint256 id,string title,uint8 category,uint256 aiProbability,uint256 deadline,bool resolved,bool outcome,uint256 totalVotesYes,uint256 totalVotesNo,address creator,bool isUserEvent,uint256 listingFee,string sourcePolicy))",
  "function createEvent(string title, uint8 category, uint256 deadline, uint256 aiProbability) returns (uint256)",
  "function resolveEvent(uint256 eventId, bool actualOutcome)",
];

async function waitTx(txPromise) {
  const tx = await txPromise;
  return tx.wait();
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Migrating with:", deployer.address);

  const deployment = require("../deployments/bscTestnet.json");
  const NEW = {
    Points: deployment.Points,
    PrizePool: deployment.PrizePool,
    Referral: deployment.Referral,
    Prediction: deployment.Prediction,
  };

  const oldPoints = new ethers.Contract(OLD.Points, POINTS_ABI, deployer);
  const newPoints = new ethers.Contract(NEW.Points, POINTS_ABI, deployer);
  const oldPrize = new ethers.Contract(OLD.PrizePool, PRIZEPOOL_ABI, deployer);
  const newPrize = new ethers.Contract(NEW.PrizePool, PRIZEPOOL_ABI, deployer);
  const oldReferral = new ethers.Contract(OLD.Referral, REFERRAL_ABI, deployer);
  const newReferral = new ethers.Contract(NEW.Referral, REFERRAL_ABI, deployer);
  const oldPrediction = new ethers.Contract(OLD.Prediction, PREDICTION_ABI, deployer);
  const newPrediction = new ethers.Contract(NEW.Prediction, PREDICTION_ABI, deployer);

  // Ensure migrator has Points operator role for write migration.
  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
  const hasOperator = await newPoints.hasRole(OPERATOR_ROLE, deployer.address);
  if (!hasOperator) {
    await waitTx(newPoints.grantRole(OPERATOR_ROLE, deployer.address));
    console.log("Granted OPERATOR_ROLE to migrator on new Points");
  }

  // 1) Migrate points/users (for leaderboard and verified creator gates).
  const oldUsersCount = Number(await oldPoints.getUserCount());
  console.log("Old points users:", oldUsersCount);
  let migratedUsers = 0;
  for (let i = 0; i < oldUsersCount; i++) {
    const user = await oldPoints.allUsers(i);
    const oldPts = await oldPoints.getUserPoints(user);
    const newPts = await newPoints.getUserPoints(user);
    const oldTotal = BigInt(oldPts.points || oldPts[0] || 0n);
    const newTotal = BigInt(newPts.points || newPts[0] || 0n);
    if (oldTotal === 0n || newTotal > 0n) continue;
    const streak = Number(oldPts.streak || oldPts[2] || 1n) || 1;
    await waitTx(newPoints.addPoints(user, oldTotal, streak));
    migratedUsers++;
  }
  console.log("Migrated users to new Points:", migratedUsers);

  // 2) Migrate referral links.
  let migratedRefs = 0;
  for (let i = 0; i < oldUsersCount; i++) {
    const user = await oldPoints.allUsers(i);
    const hadOldRef = await oldReferral.hasReferrer(user);
    if (!hadOldRef) continue;
    const hasNewRef = await newReferral.hasReferrer(user);
    if (hasNewRef) continue;
    const ref = await oldReferral.referrer(user);
    if (!ref || ref === ethers.ZeroAddress || ref.toLowerCase() === user.toLowerCase()) continue;
    await waitTx(newReferral.registerReferral(user, ref));
    migratedRefs++;
  }
  console.log("Migrated referral links:", migratedRefs);

  // 3) Migrate prediction events (preserve ids/order by replaying createEvent).
  const oldEventCount = Number(await oldPrediction.eventCount());
  let newEventCount = Number(await newPrediction.eventCount());
  console.log("Old events:", oldEventCount, "| New before migration:", newEventCount);

  let createdEvents = 0;
  for (let id = newEventCount + 1; id <= oldEventCount; id++) {
    const e = await oldPrediction["getEvent(uint256)"](BigInt(id));
    const title = String(e.title || "");
    if (!title) continue;
    const category = Number(e.category || 3);
    const latest = await ethers.provider.getBlock("latest");
    const minDeadline = BigInt(Number(latest.timestamp || 0) + 300);
    const oldDeadline = BigInt(e.deadline || 0n);
    const deadline = oldDeadline > minDeadline ? oldDeadline : minDeadline;
    const aiProbability = BigInt(e.aiProbability || 50n);
    await waitTx(newPrediction.createEvent(title, category, deadline, aiProbability));
    createdEvents++;
    if (id % 20 === 0) console.log("Created events:", id, "/", oldEventCount);
  }
  console.log("Created new events:", createdEvents);

  // 4) Resolve migrated events that were already resolved in old contract.
  let resolvedEvents = 0;
  const now = BigInt(Math.floor(Date.now() / 1000));
  newEventCount = Number(await newPrediction.eventCount());
  for (let id = 1; id <= Math.min(oldEventCount, newEventCount); id++) {
    const oldE = await oldPrediction["getEvent(uint256)"](BigInt(id));
    if (!oldE.resolved) continue;
    const newE = await newPrediction["getEvent(uint256)"](BigInt(id));
    if (newE.resolved) continue;
    if (BigInt(newE.deadline || 0n) > now) continue;
    await waitTx(newPrediction.resolveEvent(BigInt(id), Boolean(oldE.outcome)));
    resolvedEvents++;
  }
  console.log("Resolved migrated events:", resolvedEvents);

  // 5) Move remaining BNB from old PrizePool to new PrizePool.
  const oldPrizeBalance = BigInt(await oldPrize.getBalance());
  if (oldPrizeBalance > 0n) {
    await waitTx(oldPrize.emergencyWithdraw(NEW.PrizePool));
  }
  const newPrizeBalance = await newPrize.getBalance();
  console.log("PrizePool migrated. New balance:", ethers.formatEther(newPrizeBalance), "BNB");

  console.log("Migration complete.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

