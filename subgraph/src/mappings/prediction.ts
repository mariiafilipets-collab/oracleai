import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  EventCreated,
  VoteSubmitted,
  EventResolved,
  VoteFeeDistributed,
} from "../../generated/Prediction/Prediction";
import {
  PredictionEvent,
  VoteEvent,
  EventResolution,
  User,
  ProtocolMetrics,
} from "../../generated/schema";

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

export function handleEventCreated(event: EventCreated): void {
  let pred = new PredictionEvent(event.params.id.toString());
  pred.title = event.params.title;
  pred.category = event.params.category;
  pred.aiProbability = BigInt.zero();
  pred.deadline = event.params.deadline;
  pred.resolved = false;
  pred.totalVotesYes = BigInt.zero();
  pred.totalVotesNo = BigInt.zero();
  pred.isUserEvent = false;
  pred.listingFee = BigInt.zero();
  pred.createdAt = event.block.timestamp;
  pred.save();
}

export function handleVoteSubmitted(event: VoteSubmitted): void {
  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let vote = new VoteEvent(id);

  let user = getOrCreateUser(event.params.user, event.block.timestamp);
  user.totalPredictions = user.totalPredictions.plus(BigInt.fromI32(1));
  user.updatedAt = event.block.timestamp;
  user.save();

  vote.event = event.params.eventId.toString();
  vote.user = user.id;
  vote.prediction = event.params.prediction;
  vote.multiplierBps = BigInt.zero();
  vote.feePaid = BigInt.zero();
  vote.timestamp = event.block.timestamp;
  vote.blockNumber = event.block.number;
  vote.save();

  let pred = PredictionEvent.load(event.params.eventId.toString());
  if (pred) {
    if (event.params.prediction) {
      pred.totalVotesYes = pred.totalVotesYes.plus(BigInt.fromI32(1));
    } else {
      pred.totalVotesNo = pred.totalVotesNo.plus(BigInt.fromI32(1));
    }
    pred.save();
  }
}

export function handleEventResolved(event: EventResolved): void {
  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let resolution = new EventResolution(id);
  resolution.event = event.params.id.toString();
  resolution.outcome = event.params.outcome;
  resolution.winnersCount = event.params.winnersCount;
  resolution.timestamp = event.block.timestamp;
  resolution.save();

  let pred = PredictionEvent.load(event.params.id.toString());
  if (pred) {
    pred.resolved = true;
    pred.outcome = event.params.outcome;
    pred.resolvedAt = event.block.timestamp;
    pred.save();
  }
}

export function handleVoteFeeDistributed(event: VoteFeeDistributed): void {
  let metrics = getOrCreateMetrics();
  metrics.totalVoteFeesCollected = metrics.totalVoteFeesCollected.plus(
    event.params.totalFee
  );
  metrics.updatedAt = event.block.timestamp;
  metrics.save();
}
