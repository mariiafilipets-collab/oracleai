import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  address: { type: String, required: true, unique: true, lowercase: true },
  referralCode: { type: String, unique: true, sparse: true },
  referrer: { type: String, lowercase: true, default: null },
  referralAttribution: {
    utmSource: { type: String, default: "" },
    utmMedium: { type: String, default: "" },
    utmCampaign: { type: String, default: "" },
    utmContent: { type: String, default: "" },
    eventId: { type: Number, default: null },
    landingPath: { type: String, default: "" },
    attributedAt: { type: Date, default: null },
  },
  totalPoints: { type: Number, default: 0 },
  weeklyPoints: { type: Number, default: 0 },
  streak: { type: Number, default: 0 },
  totalCheckIns: { type: Number, default: 0 },
  lastCheckIn: { type: Date, default: null },
  tier: { type: String, enum: ["BASIC", "PRO", "WHALE"], default: "BASIC" },
  correctPredictions: { type: Number, default: 0 },
  totalPredictions: { type: Number, default: 0 },
  joinedAt: { type: Date, default: Date.now },
});

userSchema.pre("save", function (next) {
  if (!this.referralCode) {
    this.referralCode = this.address.slice(2, 10).toUpperCase();
  }
  next();
});

export default mongoose.model("User", userSchema);
