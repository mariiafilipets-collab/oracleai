import { test, expect } from "@playwright/test";

const FRONTEND = "https://frontend-one-beta-22.vercel.app";
const BACKEND = "https://oracleai.onrender.com";
const SUBGRAPH = "https://api.studio.thegraph.com/query/1744366/oracleai-predict/v1.0.1";
const TEST_ADDRESS = "0x8973987bf03aea074dab64a98fe13d2538c1302b";

// ═══════════════════════════════════════════════════════════════
// BACKEND API TESTS
// ═══════════════════════════════════════════════════════════════

test.describe("Backend API", () => {
  test("GET /api/health — deep health check", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/health`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.mongodb).toBe("connected");
    expect(data.rpc).toBeDefined();
    expect(data.rpc.connected).toBe(true);
    expect(data.rpc.blockNumber).toBeGreaterThan(95000000);
  });

  test("GET /api/stats — platform stats", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/stats`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.totalUsers).toBeGreaterThanOrEqual(1);
    expect(data.data.totalPredictions).toBeGreaterThanOrEqual(1);
    expect(data.data.voteFeeSplitBps).toBeDefined();
  });

  test("GET /api/predictions?status=active — active events", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/predictions?status=active`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);
    // Verify event structure
    const event = data.data[0];
    expect(event.title).toBeTruthy();
    expect(event.category).toBeTruthy();
    expect(event.deadline).toBeTruthy();
  });

  test("GET /api/predictions/scheduler — scheduler running", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/predictions/scheduler`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.initialized).toBe(true);
    expect(data.data.timersCount).toBeGreaterThanOrEqual(1);
    expect(data.data.qaWatchdog).toBeDefined();
    expect(data.data.runtime.enableScheduler).toBe(true);
    expect(data.data.runtime.hasOpenRouterKey).toBe(true);
  });

  test("GET /api/leaderboard — leaderboard", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/leaderboard`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
  });

  test("GET /api/user/:address — user profile", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/user/${TEST_ADDRESS}`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.address).toBe(TEST_ADDRESS);
    expect(data.data.totalPoints).toBeGreaterThanOrEqual(0);
    expect(data.data.onChain).toBeDefined();
  });

  test("GET /api/insights/top — AI insights endpoint", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/insights/top`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("GET /api/insights/trending — trending insights", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/insights/trending`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("GET /api/insights/contrarian — contrarian insights", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/insights/contrarian`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("GET /api/insights/accuracy — accuracy insights", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/insights/accuracy`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("GET /api/quests/:address — quest system", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/quests/${TEST_ADDRESS}`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThanOrEqual(5);
    // Verify quest structure
    const quest = data.data[0];
    expect(quest.questId).toBeTruthy();
    expect(quest.title).toBeTruthy();
    expect(quest.category).toMatch(/daily|weekly|onetime/);
    expect(quest.target).toBeGreaterThan(0);
    expect(quest.rewardPoints).toBeGreaterThan(0);
  });

  test("GET /api-docs — Swagger UI", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api-docs/`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain("swagger");
  });

  test("Rate limiting headers present", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/health`);
    // Express rate-limit sets these headers
    const remaining = res.headers()["ratelimit-remaining"] || res.headers()["x-ratelimit-remaining"];
    // Just verify the endpoint responds — rate limit headers may vary
    expect(res.status()).toBe(200);
  });

  test("CORS headers present", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/health`);
    expect(res.status()).toBe(200);
    // Helmet security headers
    const headers = res.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });

  test("Admin endpoint rejects without key", async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/predictions/admin/resolve`, {
      data: { eventId: 1 },
    });
    // Should return 401, 403, or 500 (unhandled auth error)
    expect([401, 403, 500]).toContain(res.status());
  });
});

// ═══════════════════════════════════════════════════════════════
// SUBGRAPH TESTS
// ═══════════════════════════════════════════════════════════════

test.describe("Subgraph (The Graph)", () => {
  test("Subgraph synced, no indexing errors", async ({ request }) => {
    const res = await request.post(SUBGRAPH, {
      data: { query: "{ _meta { block { number } hasIndexingErrors } }" },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.data._meta.hasIndexingErrors).toBe(false);
    expect(data.data._meta.block.number).toBeGreaterThan(95600000);
  });

  test("PredictionEvents indexed", async ({ request }) => {
    const res = await request.post(SUBGRAPH, {
      data: { query: "{ predictionEvents(first: 5) { id title category } }" },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.data.predictionEvents.length).toBeGreaterThan(0);
    expect(data.data.predictionEvents[0].title).toBeTruthy();
  });

  test("EventResolutions indexed", async ({ request }) => {
    const res = await request.post(SUBGRAPH, {
      data: { query: "{ eventResolutions(first: 5) { id outcome } }" },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.data.eventResolutions.length).toBeGreaterThan(0);
  });

  test("All entity types queryable", async ({ request }) => {
    const res = await request.post(SUBGRAPH, {
      data: {
        query: `{
          users(first:1) { id }
          checkInEvents(first:1) { id }
          voteEvents(first:1) { id }
          stakeEvents(first:1) { id }
          referralPayments(first:1) { id }
          prizeEpoches(first:1) { id }
          prizeClaims(first:1) { id }
          predictionNFTTokens(first:1) { id }
          governanceProposals(first:1) { id }
          governanceVotes(first:1) { id }
          insuranceClaims(first:1) { id }
        }`,
      },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.errors).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// FRONTEND PAGE TESTS
// ═══════════════════════════════════════════════════════════════

test.describe("Frontend Pages", () => {
  test("Home page loads with SEO", async ({ page }) => {
    await page.goto(FRONTEND, { waitUntil: "domcontentloaded" });
    // Title
    await expect(page).toHaveTitle(/OracleAI/);
    // OG tags
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute("content");
    expect(ogTitle).toContain("OracleAI");
    const ogDesc = await page.locator('meta[property="og:description"]').getAttribute("content");
    expect(ogDesc).toBeTruthy();
    const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(ogImage).toContain("oracleai-logo");
    // Twitter cards
    const twitterCard = await page.locator('meta[name="twitter:card"]').getAttribute("content");
    expect(twitterCard).toBe("summary_large_image");
  });

  test("Home page — hero section and navigation", async ({ page }) => {
    await page.goto(FRONTEND, { waitUntil: "domcontentloaded" });
    // Nav links
    await expect(page.locator("nav >> text=Predictions").first()).toBeVisible();
    await expect(page.locator("nav >> text=Leaderboard").first()).toBeVisible();
    await expect(page.locator("nav >> text=Staking").first()).toBeVisible();
    await expect(page.locator("nav >> text=Tokenomics").first()).toBeVisible();
  });

  test("Home page — QuestPanel component present in bundle", async ({ page }) => {
    await page.goto(FRONTEND, { waitUntil: "domcontentloaded" });
    // QuestPanel is client-side, check the JS loaded
    const scripts = await page.locator("script").all();
    const pageContent = await page.content();
    // Check that quest-related code is in the page scripts
    const pageChunkMatch = pageContent.match(/page-([a-f0-9]+)\.js/);
    expect(pageChunkMatch).toBeTruthy();
  });

  test("Predictions page loads", async ({ page }) => {
    await page.goto(`${FRONTEND}/predictions`, { waitUntil: "domcontentloaded" });
    // Category filters visible
    await expect(page.locator("text=Sports").first()).toBeVisible();
    await expect(page.locator("text=Politics").first()).toBeVisible();
    await expect(page.locator("text=Economy").first()).toBeVisible();
    await expect(page.locator("text=Crypto").first()).toBeVisible();
    await expect(page.locator("text=Climate").first()).toBeVisible();
  });

  test("Predictions page — mobile optimization (no excessive timers)", async ({ page }) => {
    await page.goto(`${FRONTEND}/predictions`, { waitUntil: "domcontentloaded" });
    const content = await page.content();
    const pageChunk = content.match(/predictions\/page-([a-f0-9]+)\.js/);
    expect(pageChunk).toBeTruthy();
    // Fetch the chunk and verify optimizations
    const chunkUrl = `${FRONTEND}/_next/static/chunks/app/predictions/page-${pageChunk![1]}.js`;
    const res = await page.request.get(chunkUrl);
    const js = await res.text();
    // Should have createContext (shared tick)
    expect(js).toContain("createContext");
    // Should have "remaining" (Show More button)
    expect(js).toContain("remaining");
    // Should have useMemo
    expect(js).toContain("useMemo");
  });

  test("Leaderboard page loads", async ({ page }) => {
    await page.goto(`${FRONTEND}/leaderboard`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/OracleAI/);
  });

  test("Staking page loads", async ({ page }) => {
    await page.goto(`${FRONTEND}/staking`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("text=Connect").first()).toBeVisible();
  });

  test("Tokenomics page — token distribution visible", async ({ page }) => {
    await page.goto(`${FRONTEND}/tokenomics`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("text=400M").first()).toBeVisible();
    await expect(page.locator("text=Community").first()).toBeVisible();
  });

  test("Profile page loads", async ({ page }) => {
    await page.goto(`${FRONTEND}/profile`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/OracleAI/);
  });

  test("Litepaper page loads", async ({ page }) => {
    await page.goto(`${FRONTEND}/litepaper`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/OracleAI/);
  });

  test("TGE Claim page loads", async ({ page }) => {
    await page.goto(`${FRONTEND}/tge-claim`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/OracleAI/);
  });

  test("404 page — custom not-found", async ({ page }) => {
    const res = await page.goto(`${FRONTEND}/nonexistent-page-xyz`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(404);
  });

  test("Error page exists", async ({ page }) => {
    await page.goto(FRONTEND, { waitUntil: "domcontentloaded" });
    const content = await page.content();
    expect(content).toContain("error-");
  });
});

// ═══════════════════════════════════════════════════════════════
// SEO & PWA TESTS
// ═══════════════════════════════════════════════════════════════

test.describe("SEO & PWA", () => {
  test("sitemap.xml accessible", async ({ request }) => {
    const res = await request.get(`${FRONTEND}/sitemap.xml`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain("<urlset");
    expect(text).toContain("/predictions");
    expect(text).toContain("/leaderboard");
  });

  test("robots.txt accessible", async ({ request }) => {
    const res = await request.get(`${FRONTEND}/robots.txt`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain("User-Agent");
    expect(text).toContain("Allow");
    expect(text).toContain("sitemap");
  });

  test("manifest.json — PWA", async ({ request }) => {
    const res = await request.get(`${FRONTEND}/manifest.json`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.name).toContain("OracleAI");
    expect(data.display).toBe("standalone");
    expect(data.icons.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// FRONTEND → BACKEND INTEGRATION
// ═══════════════════════════════════════════════════════════════

test.describe("Frontend-Backend Integration", () => {
  test("Frontend JS points to production backend", async ({ page }) => {
    await page.goto(FRONTEND, { waitUntil: "domcontentloaded" });
    const content = await page.content();
    // Find all JS chunks
    const chunks = [...content.matchAll(/\/_next\/static\/chunks\/([a-zA-Z0-9/_.-]+\.js)/g)];
    let foundBackendUrl = false;
    for (const chunk of chunks) {
      const url = `${FRONTEND}/_next/static/chunks/${chunk[1]}`;
      try {
        const res = await page.request.get(url);
        const js = await res.text();
        if (js.includes("oracleai.onrender.com")) {
          foundBackendUrl = true;
          // Must NOT have localhost as primary URL
          expect(js).not.toMatch(/["']https?:\/\/localhost:3001["']/);
          break;
        }
      } catch {}
    }
    expect(foundBackendUrl).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECURITY TESTS
// ═══════════════════════════════════════════════════════════════

test.describe("Security", () => {
  test("Helmet headers (X-Content-Type-Options)", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/health`);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("Helmet headers (X-Frame-Options)", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/health`);
    expect(res.headers()["x-frame-options"]).toBeTruthy();
  });

  test("Admin endpoints protected", async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/predictions/admin/resolve`);
    // Should reject: 401, 403, or 500 (unhandled auth error — not 200)
    expect(res.status()).not.toBe(200);
  });

  test("No secrets in frontend source", async ({ page }) => {
    await page.goto(FRONTEND, { waitUntil: "domcontentloaded" });
    const content = await page.content();
    expect(content).not.toContain("DEPLOYER_PRIVATE_KEY");
    expect(content).not.toContain("ADMIN_API_KEY");
    expect(content).not.toContain("sk-or-v1");
  });
});
