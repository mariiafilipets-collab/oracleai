import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import express from "express";
import { connectTestDb, closeTestDb, clearTestDb } from "./setup.js";

// Direct model import to avoid blockchain init
import PredictionEvent from "../src/models/PredictionEvent.js";

describe("Predictions API - database layer", () => {
  let app;

  beforeAll(async () => {
    await connectTestDb();

    app = express();
    app.use(express.json());

    // Minimal route for testing DB reads (no blockchain dependency)
    app.get("/api/predictions", async (req, res) => {
      try {
        const events = await PredictionEvent.find({
          resolved: false,
          deadline: { $gt: new Date() },
        })
          .sort({ deadline: 1 })
          .lean();
        res.json({ success: true, data: events });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.get("/api/predictions/resolved", async (req, res) => {
      try {
        const events = await PredictionEvent.find({ resolved: true })
          .sort({ createdAt: -1 })
          .limit(50)
          .lean();
        res.json({ success: true, data: events });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  it("returns empty array when no events exist", async () => {
    const res = await request(app).get("/api/predictions");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it("returns active (unresolved, future deadline) events", async () => {
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const pastDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await PredictionEvent.create([
      {
        eventId: 1,
        title: "Will BTC hit $100k?",
        category: "CRYPTO",
        aiProbability: 60,
        deadline: futureDeadline,
        resolved: false,
      },
      {
        eventId: 2,
        title: "Expired event",
        category: "CRYPTO",
        aiProbability: 50,
        deadline: pastDeadline,
        resolved: false,
      },
      {
        eventId: 3,
        title: "Resolved event",
        category: "CRYPTO",
        aiProbability: 70,
        deadline: futureDeadline,
        resolved: true,
        outcome: true,
      },
    ]);

    const res = await request(app).get("/api/predictions");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].eventId).toBe(1);
  });

  it("returns resolved events on /resolved endpoint", async () => {
    await PredictionEvent.create([
      {
        eventId: 1,
        title: "Active event",
        category: "CRYPTO",
        aiProbability: 50,
        deadline: new Date(Date.now() + 86400000),
        resolved: false,
      },
      {
        eventId: 2,
        title: "Resolved yes",
        category: "CRYPTO",
        aiProbability: 70,
        deadline: new Date(Date.now() - 86400000),
        resolved: true,
        outcome: true,
      },
    ]);

    const res = await request(app).get("/api/predictions/resolved");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].eventId).toBe(2);
    expect(res.body.data[0].outcome).toBe(true);
  });
});
