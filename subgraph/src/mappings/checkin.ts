import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { CheckedIn } from "../../generated/CheckIn/CheckIn";
import { User, CheckInEvent, ProtocolMetrics } from "../../generated/schema";

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

export function handleCheckedIn(event: CheckedIn): void {
  let id = event.transaction.hash.concatI32(event.logIndex.toI32());

  let checkIn = new CheckInEvent(id);
  let user = getOrCreateUser(event.params.user, event.block.timestamp);

  user.totalCheckIns = user.totalCheckIns.plus(BigInt.fromI32(1));
  user.streak = event.params.streak;
  user.totalPoints = user.totalPoints.plus(event.params.points);
  user.updatedAt = event.block.timestamp;
  user.save();

  checkIn.user = user.id;
  checkIn.amount = event.params.amount;
  checkIn.tier = event.params.tier;
  checkIn.points = event.params.points;
  checkIn.streak = event.params.streak;
  checkIn.timestamp = event.block.timestamp;
  checkIn.blockNumber = event.block.number;
  checkIn.save();

  let metrics = getOrCreateMetrics();
  metrics.totalCheckIns = metrics.totalCheckIns.plus(BigInt.fromI32(1));
  metrics.totalFeesCollected = metrics.totalFeesCollected.plus(event.params.amount);
  metrics.totalPointsIssued = metrics.totalPointsIssued.plus(event.params.points);
  metrics.updatedAt = event.block.timestamp;
  metrics.save();
}
