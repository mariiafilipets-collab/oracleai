import mongoose from "mongoose";

const checkInRecordSchema = new mongoose.Schema({
  address: { type: String, required: true, lowercase: true },
  amount: { type: String, required: true },
  tier: { type: String, enum: ["BASIC", "PRO", "WHALE"], required: true },
  points: { type: Number, required: true },
  streak: { type: Number, default: 1 },
  txHash: { type: String },
  timestamp: { type: Date, default: Date.now },
});

checkInRecordSchema.index({ address: 1, timestamp: -1 });
checkInRecordSchema.index({ txHash: 1 }, { unique: true, sparse: true });

export default mongoose.model("CheckInRecord", checkInRecordSchema);
