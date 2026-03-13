import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  ProposalCreated,
  VoteCast,
  ProposalExecuted,
  ProposalCancelled,
} from "../../generated/OracleGovernance/OracleGovernance";
import {
  GovernanceProposal,
  GovernanceVote,
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

export function handleProposalCreated(event: ProposalCreated): void {
  let proposal = new GovernanceProposal(event.params.id.toString());
  let user = getOrCreateUser(event.params.proposer, event.block.timestamp);
  user.save();

  proposal.proposer = user.id;
  proposal.title = event.params.title;
  proposal.description = "";
  proposal.forVotes = BigInt.zero();
  proposal.againstVotes = BigInt.zero();
  proposal.startTime = event.params.startTime;
  proposal.endTime = event.params.endTime;
  proposal.executed = false;
  proposal.cancelled = false;
  proposal.save();

  let metrics = getOrCreateMetrics();
  metrics.totalProposals = metrics.totalProposals.plus(BigInt.fromI32(1));
  metrics.updatedAt = event.block.timestamp;
  metrics.save();
}

export function handleVoteCast(event: VoteCast): void {
  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let vote = new GovernanceVote(id);
  vote.proposal = event.params.proposalId.toString();
  vote.voter = event.params.voter;
  vote.support = event.params.support;
  vote.weight = event.params.weight;
  vote.timestamp = event.block.timestamp;
  vote.save();

  let proposal = GovernanceProposal.load(event.params.proposalId.toString());
  if (proposal) {
    if (event.params.support) {
      proposal.forVotes = proposal.forVotes.plus(event.params.weight);
    } else {
      proposal.againstVotes = proposal.againstVotes.plus(event.params.weight);
    }
    proposal.save();
  }
}

export function handleProposalExecuted(event: ProposalExecuted): void {
  let proposal = GovernanceProposal.load(event.params.id.toString());
  if (proposal) {
    proposal.executed = true;
    proposal.save();
  }
}

export function handleProposalCancelled(event: ProposalCancelled): void {
  let proposal = GovernanceProposal.load(event.params.id.toString());
  if (proposal) {
    proposal.cancelled = true;
    proposal.save();
  }
}
