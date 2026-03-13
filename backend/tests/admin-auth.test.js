import { describe, it, expect } from "@jest/globals";
import express from "express";
import request from "supertest";

describe("Admin authentication", () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());

    // Simulate admin auth logic matching predictions.js
    function isAdminAuthorized(req) {
      const key = String(req.header("x-admin-key") || "").trim();
      if (!key) return false;
      const adminKey = "test-admin-key-123";
      return key === adminKey;
    }

    app.post("/admin/test", (req, res) => {
      if (!isAdminAuthorized(req)) {
        return res.status(403).json({ success: false, error: "Forbidden" });
      }
      res.json({ success: true });
    });
  });

  it("rejects requests without admin key", async () => {
    const res = await request(app).post("/admin/test");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden");
  });

  it("rejects requests with wrong admin key", async () => {
    const res = await request(app)
      .post("/admin/test")
      .set("x-admin-key", "wrong-key");
    expect(res.status).toBe(403);
  });

  it("accepts requests with correct admin key", async () => {
    const res = await request(app)
      .post("/admin/test")
      .set("x-admin-key", "test-admin-key-123");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("rejects empty string as admin key", async () => {
    const res = await request(app)
      .post("/admin/test")
      .set("x-admin-key", "");
    expect(res.status).toBe(403);
  });

  it("rejects whitespace-only admin key", async () => {
    const res = await request(app)
      .post("/admin/test")
      .set("x-admin-key", "   ");
    expect(res.status).toBe(403);
  });
});
