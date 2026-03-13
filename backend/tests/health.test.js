import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import request from "supertest";

describe("GET /api/health", () => {
  let app;

  beforeAll(() => {
    app = express();
    app.get("/api/health", (req, res) => {
      res.json({ status: "ok", timestamp: Date.now() });
    });
  });

  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.timestamp).toBeDefined();
  });
});
