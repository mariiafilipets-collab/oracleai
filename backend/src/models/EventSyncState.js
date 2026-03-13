import mongoose from "mongoose";

const eventSyncStateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  lastProcessedBlock: { type: Number, required: true, default: 0 },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("EventSyncState", eventSyncStateSchema);
