import { Router } from "express";
import { getAIMetrics } from "../services/ai-metrics.service.js";

const router = Router();

router.get("/usage", (req, res) => {
  try {
    res.json({ success: true, data: getAIMetrics() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

