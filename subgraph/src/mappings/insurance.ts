import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  ClaimFiled,
  ClaimApproved,
  ClaimDenied,
  ClaimPaid,
} from "../../generated/InsurancePool/InsurancePool";
import { InsuranceClaim, User, ProtocolMetrics } from "../../generated/schema";

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

export function handleClaimFiled(event: ClaimFiled): void {
  let claim = new InsuranceClaim(event.params.claimId.toString());
  let user = getOrCreateUser(event.params.claimant, event.block.timestamp);
  user.save();

  claim.claimant = user.id;
  claim.eventId = event.params.eventId;
  claim.requestedAmount = event.params.amount;
  claim.approvedAmount = BigInt.zero();
  claim.reason = "";
  claim.status = 0; // Pending
  claim.filedAt = event.block.timestamp;
  claim.save();
}

export function handleClaimApproved(event: ClaimApproved): void {
  let claim = InsuranceClaim.load(event.params.claimId.toString());
  if (claim) {
    claim.approvedAmount = event.params.approvedAmount;
    claim.status = 1; // Approved
    claim.resolvedAt = event.block.timestamp;
    claim.save();
  }
}

export function handleClaimDenied(event: ClaimDenied): void {
  let claim = InsuranceClaim.load(event.params.claimId.toString());
  if (claim) {
    claim.status = 2; // Denied
    claim.resolvedAt = event.block.timestamp;
    claim.save();
  }
}

export function handleClaimPaid(event: ClaimPaid): void {
  let claim = InsuranceClaim.load(event.params.claimId.toString());
  if (claim) {
    claim.status = 3; // Paid
    claim.save();
  }

  let metrics = getOrCreateMetrics();
  metrics.totalInsurancePaid = metrics.totalInsurancePaid.plus(event.params.amount);
  metrics.updatedAt = event.block.timestamp;
  metrics.save();
}
