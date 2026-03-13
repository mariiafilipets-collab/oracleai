import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { createTestApp, connectTestDb, closeTestDb, clearTestDb } from "./setup.js";

let app, request;

beforeAll(async () => {
  await connectTestDb();
  ({ app, request } = createTestApp());
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await clearTestDb();
});

const ADDR = "0x1234567890abcdef1234567890abcdef12345678";
const INVALID = "not-an-address";

describe("GET /api/quests/:address", () => {
  it("returns quests for valid address", async () => {
    const res = await request.get(`/api/quests/${ADDR}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // Should seed default quests
    expect(res.body.data.length).toBeGreaterThan(0);
    // Each quest should have expected fields
    const q = res.body.data[0];
    expect(q).toHaveProperty("questId");
    expect(q).toHaveProperty("title");
    expect(q).toHaveProperty("progress");
    expect(q).toHaveProperty("completed");
    expect(q).toHaveProperty("claimed");
  });

  it("rejects invalid address", async () => {
    const res = await request.get(`/api/quests/${INVALID}`);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/quests/:address/progress", () => {
  it("increments quest progress", async () => {
    // First fetch to seed quests
    await request.get(`/api/quests/${ADDR}`);

    const res = await request
      .post(`/api/quests/${ADDR}/progress`)
      .send({ questId: "daily-checkin", increment: 1 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.progress).toBe(1);
  });

  it("rejects missing questId", async () => {
    const res = await request
      .post(`/api/quests/${ADDR}/progress`)
      .send({ increment: 1 });
    expect(res.status).toBe(400);
  });

  it("rejects unknown questId", async () => {
    const res = await request
      .post(`/api/quests/${ADDR}/progress`)
      .send({ questId: "nonexistent-quest" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/quests/:address/claim", () => {
  it("rejects claim for incomplete quest", async () => {
    // Seed quests
    await request.get(`/api/quests/${ADDR}`);

    const res = await request
      .post(`/api/quests/${ADDR}/claim`)
      .send({ questId: "daily-checkin" });
    expect(res.status).toBe(400);
  });

  it("allows claim for completed quest", async () => {
    // Seed quests
    await request.get(`/api/quests/${ADDR}`);

    // Complete the daily-checkin quest (target=1)
    await request
      .post(`/api/quests/${ADDR}/progress`)
      .send({ questId: "daily-checkin", increment: 1 });

    const res = await request
      .post(`/api/quests/${ADDR}/claim`)
      .send({ questId: "daily-checkin" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.claimed).toBe(true);
    expect(res.body.data.rewardPoints).toBeGreaterThan(0);
  });

  it("rejects double claim", async () => {
    await request.get(`/api/quests/${ADDR}`);
    await request
      .post(`/api/quests/${ADDR}/progress`)
      .send({ questId: "daily-checkin", increment: 1 });
    await request
      .post(`/api/quests/${ADDR}/claim`)
      .send({ questId: "daily-checkin" });

    const res = await request
      .post(`/api/quests/${ADDR}/claim`)
      .send({ questId: "daily-checkin" });
    expect(res.status).toBe(400);
  });
});
