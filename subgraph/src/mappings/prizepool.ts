import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  EpochStarted,
  PrizeClaimed,
} from "../../generated/PrizePoolV2/PrizePoolV2";
import { PrizeEpoch, PrizeClaim, ProtocolMetrics } from "../../generated/schema";

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

export function handleEpochStarted(event: EpochStarted): void {
  let epoch = new PrizeEpoch(event.params.epoch.toString());
  epoch.merkleRoot = event.params.merkleRoot;
  epoch.totalAllocation = event.params.totalAllocation;
  epoch.claimed = BigInt.zero();
  epoch.startedAt = event.block.timestamp;
  epoch.save();
}

export function handlePrizeClaimed(event: PrizeClaimed): void {
  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let claim = new PrizeClaim(id);
  claim.epoch = event.params.epoch.toString();
  claim.claimant = event.params.claimant;
  claim.amount = event.params.amount;
  claim.index = event.params.index;
  claim.timestamp = event.block.timestamp;
  claim.save();

  let epoch = PrizeEpoch.load(event.params.epoch.toString());
  if (epoch) {
    epoch.claimed = epoch.claimed.plus(event.params.amount);
    epoch.save();
  }

  let metrics = getOrCreateMetrics();
  metrics.totalPrizesDistributed = metrics.totalPrizesDistributed.plus(event.params.amount);
  metrics.updatedAt = event.block.timestamp;
  metrics.save();
}
