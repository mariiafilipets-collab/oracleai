import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts";
import {
  StreakNFTMinted,
  Transfer,
} from "../../generated/PredictionNFT/PredictionNFT";
import { PredictionNFTToken, User } from "../../generated/schema";

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

export function handleStreakNFTMinted(event: StreakNFTMinted): void {
  let token = new PredictionNFTToken(event.params.tokenId.toString());
  let user = getOrCreateUser(event.params.to, event.block.timestamp);
  user.save();

  token.owner = user.id;
  token.tier = event.params.tier;
  token.streak = event.params.streak;
  token.eventId = event.params.eventId;
  token.mintedAt = event.block.timestamp;
  token.save();
}

export function handleNFTTransfer(event: Transfer): void {
  let token = PredictionNFTToken.load(event.params.tokenId.toString());
  if (!token) return;

  let zeroAddress = Address.fromString("0x0000000000000000000000000000000000000000");
  if (event.params.from == zeroAddress) return; // mint handled above

  let newOwner = getOrCreateUser(event.params.to, event.block.timestamp);
  newOwner.save();

  token.owner = newOwner.id;
  token.save();
}
