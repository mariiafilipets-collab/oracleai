import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { User, StakeEvent, ProtocolMetrics } from "../../generated/schema";

// Note: These event types would be generated from the Staking ABI.
// For now we define handler signatures matching the subgraph.yaml.
// Actual event classes come from `graph codegen`.

class StakedEvent {
  params: StakedParams;
  transaction: TxInfo;
  logIndex: BigInt;
  block: BlockInfo;
}
class StakedParams { user: Bytes; amount: BigInt; }
class UnstakeRequestedEvent {
  params: UnstakeRequestedParams;
  transaction: TxInfo;
  logIndex: BigInt;
  block: BlockInfo;
}
class UnstakeRequestedParams { user: Bytes; amount: BigInt; }
class UnstakedEvent {
  params: UnstakedParams;
  transaction: TxInfo;
  logIndex: BigInt;
  block: BlockInfo;
}
class UnstakedParams { user: Bytes; amount: BigInt; }
class TxInfo { hash: Bytes; }
class BlockInfo { timestamp: BigInt; number: BigInt; }

function getOrCreateUser(address: Bytes, timestamp: BigInt): User {
  let user = User.load(address);
  if (!user) {
    user = new User(address);
    user.totalPoints = BigInt.zero();
    user.weeklyPoints = BigInt.zero();
    user.streak = BigInt.zero();
    user.totalCheckIns = BigInt.zero();
    user.correctPredictions = BigInt.zero();
    user.totalPredictions = BigInt.zero();
    user.stakedAmount = BigInt.zero();
    user.stakingTier = 0;
    user.directReferralCount = BigInt.zero();
    user.totalReferralEarnings = BigInt.zero();
    user.createdAt = timestamp;
    user.updatedAt = timestamp;
  }
  return user;
}

function getOrCreateMetrics(): ProtocolMetrics {
  let metrics = ProtocolMetrics.load("singleton");
  if (!metrics) {
    metrics = new ProtocolMetrics("singleton");
    metrics.totalCheckIns = BigInt.zero();
    metrics.totalFeesCollected = BigInt.zero();
    metrics.totalVoteFeesCollected = BigInt.zero();
    metrics.totalPointsIssued = BigInt.zero();
    metrics.totalStaked = BigInt.zero();
    metrics.totalPrizesDistributed = BigInt.zero();
    metrics.totalInsurancePaid = BigInt.zero();
    metrics.totalProposals = BigInt.zero();
    metrics.updatedAt = BigInt.zero();
  }
  return metrics;
}

function getTier(amount: BigInt): i32 {
  let diamond = BigInt.fromString("100000000000000000000000"); // 100K
  let gold = BigInt.fromString("10000000000000000000000");    // 10K
  let silver = BigInt.fromString("1000000000000000000000");   // 1K
  let bronze = BigInt.fromString("100000000000000000000");    // 100

  if (amount.ge(diamond)) return 4;
  if (amount.ge(gold)) return 3;
  if (amount.ge(silver)) return 2;
  if (amount.ge(bronze)) return 1;
  return 0;
}

export function handleStaked(event: StakedEvent): void {
  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let stake = new StakeEvent(id);
  let user = getOrCreateUser(event.params.user, event.block.timestamp);

  user.stakedAmount = user.stakedAmount.plus(event.params.amount);
  user.stakingTier = getTier(user.stakedAmount);
  user.updatedAt = event.block.timestamp;
  user.save();

  stake.user = user.id;
  stake.action = "stake";
  stake.amount = event.params.amount;
  stake.timestamp = event.block.timestamp;
  stake.save();

  let metrics = getOrCreateMetrics();
  metrics.totalStaked = metrics.totalStaked.plus(event.params.amount);
  metrics.updatedAt = event.block.timestamp;
  metrics.save();
}

export function handleUnstakeRequested(event: UnstakeRequestedEvent): void {
  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let stake = new StakeEvent(id);
  let user = getOrCreateUser(event.params.user, event.block.timestamp);

  stake.user = user.id;
  stake.action = "requestUnstake";
  stake.amount = event.params.amount;
  stake.timestamp = event.block.timestamp;
  stake.save();
}

export function handleUnstaked(event: UnstakedEvent): void {
  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let stake = new StakeEvent(id);
  let user = getOrCreateUser(event.params.user, event.block.timestamp);

  user.stakedAmount = user.stakedAmount.minus(event.params.amount);
  user.stakingTier = getTier(user.stakedAmount);
  user.updatedAt = event.block.timestamp;
  user.save();

  stake.user = user.id;
  stake.action = "unstake";
  stake.amount = event.params.amount;
  stake.timestamp = event.block.timestamp;
  stake.save();

  let metrics = getOrCreateMetrics();
  metrics.totalStaked = metrics.totalStaked.minus(event.params.amount);
  metrics.updatedAt = event.block.timestamp;
  metrics.save();
}
