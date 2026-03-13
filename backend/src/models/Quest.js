import mongoose from "mongoose";

const questSchema = new mongoose.Schema({
  // Quest definition
  questId: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String, default: "" },
  category: {
    type: String,
    enum: ["daily", "weekly", "onetime"],
    default: "daily",
  },
  // Requirements
  action: {
    type: String,
    enum: ["checkin", "vote", "streak", "referral", "share", "accuracy"],
    required: true,
  },
  target: { type: Number, required: true }, // e.g. 3 votes, 5-day streak
  rewardPoints: { type: Number, default: 0 },
  rewardLabel: { type: String, default: "" }, // e.g. "+200 points"
  // Active window
  active: { type: Boolean, default: true },
  startsAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
}, { timestamps: true });

questSchema.index({ active: 1, category: 1 });

export default mongoose.model("Quest", questSchema);
