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

const ADDR = "0x1234567890abcdef1234567890abcdef12345678";
const INVALID = "xyz123";

describe("GET /api/user/:address", () => {
  it("returns user profile for valid address", async () => {
    const res = await request.get(`/api/user/${ADDR}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("address");
  });

  it("rejects invalid address", async () => {
    const res = await request.get(`/api/user/${INVALID}`);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/user/:address/onboarding", () => {
  it("returns onboarding status", async () => {
    const res = await request.get(`/api/user/${ADDR}/onboarding`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("isNewUser");
  });
});

describe("GET /api/user/:address/referral-code", () => {
  it("returns referral code", async () => {
    const res = await request.get(`/api/user/${ADDR}/referral-code`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("code");
  });
});

describe("GET /api/user/:address/history", () => {
  it("returns check-in history", async () => {
    const res = await request.get(`/api/user/${ADDR}/history`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("GET /api/user/:address/referral-stats", () => {
  it("returns referral stats", async () => {
    const res = await request.get(`/api/user/${ADDR}/referral-stats`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("GET /api/user/:address/creator-stats", () => {
  it("returns creator stats", async () => {
    const res = await request.get(`/api/user/${ADDR}/creator-stats`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("POST /api/user/:address/referral", () => {
  it("rejects missing referrerCode", async () => {
    const res = await request
      .post(`/api/user/${ADDR}/referral`)
      .send({});
    // Should fail with 400 or similar
    expect([400, 404, 500]).toContain(res.status);
  });
});
