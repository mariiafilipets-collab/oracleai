import { describe, it, expect } from "@jest/globals";
import { validate, isAddress, isPositiveInt, isNonEmptyString } from "../src/middleware/validate.js";
import express from "express";
import request from "supertest";

describe("validate middleware", () => {
  it("passes when validation succeeds", async () => {
    const app = express();
    app.use(express.json());
    app.post(
      "/test",
      validate({
        body: (data) => {
          if (!data.name) return { valid: false, errors: ["name is required"] };
          return { valid: true };
        },
      }),
      (req, res) => res.json({ ok: true })
    );

    const res = await request(app).post("/test").send({ name: "hello" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 400 when validation fails", async () => {
    const app = express();
    app.use(express.json());
    app.post(
      "/test",
      validate({
        body: (data) => {
          if (!data.name) return { valid: false, errors: ["name is required"] };
          return { valid: true };
        },
      }),
      (req, res) => res.json({ ok: true })
    );

    const res = await request(app).post("/test").send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors).toContain("body: name is required");
  });
});

describe("validators", () => {
  it("isAddress validates ETH addresses", () => {
    expect(isAddress("0x" + "a".repeat(40))).toBe(true);
    expect(isAddress("0x123")).toBe(false);
    expect(isAddress("")).toBe(false);
    expect(isAddress(null)).toBe(false);
  });

  it("isPositiveInt validates positive integers", () => {
    expect(isPositiveInt(1)).toBe(true);
    expect(isPositiveInt(100)).toBe(true);
    expect(isPositiveInt(0)).toBe(false);
    expect(isPositiveInt(-1)).toBe(false);
    expect(isPositiveInt(1.5)).toBe(false);
    expect(isPositiveInt("abc")).toBe(false);
  });

  it("isNonEmptyString validates strings", () => {
    expect(isNonEmptyString("hello")).toBe(true);
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString("  ")).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString("a".repeat(501))).toBe(false);
  });
});
