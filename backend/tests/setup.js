/**
 * Shared test setup: creates a minimal Express app with the same middleware
 * as production, but WITHOUT blockchain or scheduler side-effects.
 */
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

let mongod = null;

export async function createTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  return app;
}

export async function connectTestDb() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
}

export async function closeTestDb() {
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  } catch {}
  if (mongod) {
    try { await mongod.stop(); } catch {}
  }
}

export async function clearTestDb() {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}
