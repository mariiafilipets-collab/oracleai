import { describe, it, expect } from "@jest/globals";
import express from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";

describe("Rate limiting", () => {
  it("blocks requests exceeding the limit", async () => {
    const app = express();
    app.use(
      rateLimit({
        windowMs: 60 * 1000,
        max: 3,
        message: { success: false, error: "Too many requests" },
      })
    );
    app.get("/test", (req, res) => res.json({ ok: true }));

    // First 3 requests should succeed
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get("/test");
      expect(res.status).toBe(200);
    }

    // 4th request should be rate limited
    const res = await request(app).get("/test");
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("Too many requests");
  });
});
