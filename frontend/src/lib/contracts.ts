const IS_BSC_TESTNET = process.env.NEXT_PUBLIC_CHAIN_TARGET === "bsc_testnet";
const BSC_TESTNET_RPC =
  process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
export const CHAIN_ID = IS_BSC_TESTNET ? 97 : 31338;
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export const HARDHAT_CHAIN = {
  id: CHAIN_ID,
  name: IS_BSC_TESTNET ? "BNB Smart Chain Testnet" : "BNB Chain Local",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: {
    default: { http: [IS_BSC_TESTNET ? BSC_TESTNET_RPC : "http://127.0.0.1:8545"] },
  },
  testnet: true,
} as const;

export const CheckInABI = [
  { inputs: [], name: "checkIn", outputs: [], stateMutability: "payable", type: "function" },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getRecord",
    outputs: [{ components: [
      { name: "lastCheckIn", type: "uint256" }, { name: "streak", type: "uint256" },
      { name: "totalCheckIns", type: "uint256" }, { name: "lastTier", type: "uint8" },
    ], type: "tuple" }],
    stateMutability: "view", type: "function",
  },
  { inputs: [], name: "totalFeesCollected", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" }, { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "tier", type: "uint8" }, { indexed: false, name: "points", type: "uint256" },
      { indexed: false, name: "streak", type: "uint256" },
    ],
    name: "CheckedIn", type: "event",
  },
] as const;

export const PointsABI = [
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserPoints",
    outputs: [{ components: [
      { name: "points", type: "uint256" }, { name: "weeklyPoints", type: "uint256" },
      { name: "streak", type: "uint256" }, { name: "lastCheckIn", type: "uint256" },
      { name: "totalCheckIns", type: "uint256" }, { name: "correctPredictions", type: "uint256" },
      { name: "totalPredictions", type: "uint256" },
    ], type: "tuple" }],
    stateMutability: "view", type: "function",
  },
  { inputs: [], name: "getUserCount", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "totalPointsIssued", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

export const ReferralABI = [
  { inputs: [{ name: "user", type: "address" }, { name: "ref", type: "address" }], name: "registerReferral", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "hasReferrer", outputs: [{ type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "getDirectReferrals", outputs: [{ type: "address[]" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "totalEarnings", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "pendingEarnings", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "withdrawReferralEarnings", outputs: [], stateMutability: "nonpayable", type: "function" },
] as const;

export const PredictionABI = [
  { inputs: [], name: "eventCount", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "USER_EVENT_FEE", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "userEventVoteFee", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "creatorShareBps", outputs: [{ type: "uint16" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "minCreatorPayoutVotes", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "pendingProtocolFeesWei", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "nextProtocolDistributionAt", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "distributeProtocolFees", outputs: [], stateMutability: "nonpayable", type: "function" },
  {
    inputs: [],
    name: "getProtocolDistributionState",
    outputs: [
      { name: "pendingAmount", type: "uint256" },
      { name: "nextAt", type: "uint256" },
      { name: "secondsLeft", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  { inputs: [], name: "USER_EVENT_COOLDOWN", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "VERIFIED_CREATOR_COOLDOWN", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "VERIFIED_MIN_POINTS", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "creatorClaimableWei", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "nextUserEventAt", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "isVerifiedCreator", outputs: [{ type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "getCreatorCooldown", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  {
    inputs: [{ name: "eventId", type: "uint256" }],
    name: "getCreatorEventPayoutPreview",
    outputs: [
      { name: "pendingCreatorCut", type: "uint256" },
      { name: "voterCount", type: "uint256" },
      { name: "eligibleNow", type: "bool" },
      { name: "requiredVotes", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  { inputs: [], name: "claimCreatorFees", outputs: [], stateMutability: "nonpayable", type: "function" },
  {
    inputs: [
      { name: "title", type: "string" },
      { name: "category", type: "uint8" },
      { name: "deadline", type: "uint256" },
      { name: "sourcePolicy", type: "string" },
    ],
    name: "createUserEvent",
    outputs: [{ type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  { inputs: [{ name: "eventId", type: "uint256" }, { name: "_prediction", type: "bool" }], name: "submitPrediction", outputs: [], stateMutability: "payable", type: "function" },
  {
    inputs: [{ name: "eventId", type: "uint256" }],
    name: "getEvent",
    outputs: [{ components: [
      { name: "id", type: "uint256" }, { name: "title", type: "string" }, { name: "category", type: "uint8" },
      { name: "aiProbability", type: "uint256" }, { name: "deadline", type: "uint256" },
      { name: "resolved", type: "bool" }, { name: "outcome", type: "bool" },
      { name: "totalVotesYes", type: "uint256" }, { name: "totalVotesNo", type: "uint256" },
      { name: "creator", type: "address" }, { name: "isUserEvent", type: "bool" },
      { name: "listingFee", type: "uint256" }, { name: "sourcePolicy", type: "string" },
    ], type: "tuple" }],
    stateMutability: "view", type: "function",
  },
  {
    inputs: [{ name: "eventId", type: "uint256" }, { name: "user", type: "address" }],
    name: "getUserVote",
    outputs: [{ components: [{ name: "voted", type: "bool" }, { name: "prediction", type: "bool" }], type: "tuple" }],
    stateMutability: "view", type: "function",
  },
] as const;

export const StakingABI = [
  { inputs: [{ name: "amount", type: "uint256" }], name: "stake", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "amount", type: "uint256" }], name: "requestUnstake", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "unstake", outputs: [], stateMutability: "nonpayable", type: "function" },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getStakeInfo",
    outputs: [{ components: [
      { name: "amount", type: "uint256" }, { name: "stakedAt", type: "uint256" },
      { name: "unstakeRequestedAt", type: "uint256" }, { name: "unstakeAmount", type: "uint256" },
    ], type: "tuple" }],
    stateMutability: "view", type: "function",
  },
  { inputs: [], name: "totalStaked", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

export const OAITokenABI = [
  { inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

export const PrizePoolABI = [
  { inputs: [], name: "getBalance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

export const PrizePoolV2ABI = [
  { inputs: [], name: "currentEpoch", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "epoch", type: "uint256" }, { name: "index", type: "uint256" }], name: "isClaimed", outputs: [{ type: "bool" }], stateMutability: "view", type: "function" },
  {
    inputs: [
      { name: "epoch", type: "uint256" },
      { name: "index", type: "uint256" },
      { name: "account", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "merkleProof", type: "bytes32[]" },
    ],
    name: "claim",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
