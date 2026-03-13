import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { createTestApp, connectTestDb, closeTestDb } from "./setup.js";

let request;

beforeAll(async () => {
  await connectTestDb();
  ({ request } = createTestApp());
});

afterAll(async () => {
  await closeTestDb();
});

describe("GET /api/stats", () => {
  it("returns platform stats", async () => {
    const res = await request.get("/api/stats");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("totalUsers");
    expect(res.body.data).toHaveProperty("totalPredictions");
  });
});

describe("GET /api/stats/contracts", () => {
  it("returns contract addresses", async () => {
    const res = await request.get("/api/stats/contracts");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("GET /api/stats/activity", () => {
  it("returns activity list", async () => {
    const res = await request.get("/api/stats/activity?limit=10");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("GET /api/stats/tge-forecast", () => {
  it("returns TGE forecast", async () => {
    const res = await request.get("/api/stats/tge-forecast");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
