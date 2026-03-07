import mongoose from "mongoose";

const localizedTextSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    aiReasoning: { type: String, default: "" },
  },
  { _id: false }
);

const predictionEventSchema = new mongoose.Schema({
  eventId: { type: Number, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String, default: "" },
  category: {
    type: String,
    enum: ["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"],
    required: true,
  },
  aiProbability: { type: Number, required: true, min: 0, max: 100 },
  deadline: { type: Date, required: true },
  verifyAfter: { type: Date, default: null },
  eventStartAtUtc: { type: Date, default: null },
  expectedResolveAtUtc: { type: Date, default: null },
  timePrecision: {
    type: String,
    enum: ["EXACT_MINUTE", "EXACT_HOUR", "DATE_ONLY"],
    default: "DATE_ONLY",
  },
  confidence: { type: Number, default: 0, min: 0, max: 1 },
  popularityScore: { type: Number, default: 0, min: 0, max: 100 },
  sources: [{ type: String }],
  qualityVersion: { type: String, default: "v2" },
  creator: { type: String, default: "" },
  isUserEvent: { type: Boolean, default: false },
  listingFeeWei: { type: String, default: "0" },
  sourcePolicy: { type: String, default: "" },
  resolved: { type: Boolean, default: false },
  resolvePending: { type: Boolean, default: false },
  resolveAttempts: { type: Number, default: 0 },
  nextResolveRetryAt: { type: Date, default: null },
  lastResolveError: { type: String, default: "" },
  lastResolveTriedAt: { type: Date, default: null },
  outcome: { type: Boolean, default: null },
  aiReasoning: { type: String, default: "" },
  translations: {
    zh: { type: localizedTextSchema, default: undefined },
    ru: { type: localizedTextSchema, default: undefined },
    es: { type: localizedTextSchema, default: undefined },
    fr: { type: localizedTextSchema, default: undefined },
    ar: { type: localizedTextSchema, default: undefined },
  },
  totalVotesYes: { type: Number, default: 0 },
  totalVotesNo: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

predictionEventSchema.index({ resolved: 1, deadline: 1 });
predictionEventSchema.index({ resolved: 1, resolvePending: 1, nextResolveRetryAt: 1 });
predictionEventSchema.index({ title: 1, deadline: 1 });

export default mongoose.model("PredictionEvent", predictionEventSchema);
