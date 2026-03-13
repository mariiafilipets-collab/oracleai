import mongoose from "mongoose";

const questProgressSchema = new mongoose.Schema({
  address: { type: String, required: true },
  questId: { type: String, required: true },
  progress: { type: Number, default: 0 },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date, default: null },
  claimed: { type: Boolean, default: false },
  // For daily/weekly resets
  periodKey: { type: String, default: "" }, // e.g. "2026-03-13" or "2026-W11"
}, { timestamps: true });

questProgressSchema.index({ address: 1, questId: 1, periodKey: 1 }, { unique: true });
questProgressSchema.index({ address: 1, completed: 1 });

export default mongoose.model("QuestProgress", questProgressSchema);
