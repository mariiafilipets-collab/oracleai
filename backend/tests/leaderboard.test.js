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

describe("GET /api/leaderboard", () => {
  it("returns leaderboard list", async () => {
    const res = await request.get("/api/leaderboard?limit=10");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("GET /api/leaderboard/accuracy", () => {
  it("returns accuracy ranking", async () => {
    const res = await request.get("/api/leaderboard/accuracy?limit=10&min=1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("GET /api/leaderboard/epoch/current", () => {
  it("returns epoch or null", async () => {
    const res = await request.get("/api/leaderboard/epoch/current");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("GET /api/leaderboard/claim-proof/:address", () => {
  it("returns null for unknown address", async () => {
    const addr = "0x0000000000000000000000000000000000000001";
    const res = await request.get(`/api/leaderboard/claim-proof/${addr}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
