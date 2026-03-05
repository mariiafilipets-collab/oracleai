import mongoose from "mongoose";

const winnerSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    address: { type: String, required: true, lowercase: true },
    amount: { type: String, required: true }, // wei
    rank: { type: Number, required: true },
    points: { type: Number, required: true },
    proof: [{ type: String }],
  },
  { _id: false }
);

const weeklyPrizeEpochSchema = new mongoose.Schema({
  epoch: { type: Number, required: true, unique: true },
  merkleRoot: { type: String, required: true },
  totalAllocation: { type: String, required: true }, // wei
  winners: { type: [winnerSchema], default: [] },
  winnerCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("WeeklyPrizeEpoch", weeklyPrizeEpochSchema);
