/**
 * OpenAPI 3.0 specification for OracleAI Predict API.
 * Served via swagger-ui-express at /api-docs.
 */
const spec = {
  openapi: "3.0.3",
  info: {
    title: "OracleAI Predict API",
    version: "1.0.0",
    description:
      "Backend API for the OracleAI decentralized prediction platform on BNB Chain. " +
      "Covers predictions, leaderboard, user profiles, quests, and platform stats.",
    contact: { name: "OracleAI Team" },
  },
  servers: [
    { url: "http://localhost:3001", description: "Local development" },
  ],
  tags: [
    { name: "Predictions", description: "Browse, create, vote, resolve prediction events" },
    { name: "Leaderboard", description: "Rankings and prize epochs" },
    { name: "Users", description: "User profiles, referrals, and onboarding" },
    { name: "Quests", description: "Daily/weekly quest progression and rewards" },
    { name: "Stats", description: "Platform-wide statistics" },
    { name: "Admin", description: "Protected admin operations (x-admin-key header)" },
    { name: "Insights", description: "AI insights marketplace — premium analytics" },
    { name: "Health", description: "Service health" },
  ],
  components: {
    securitySchemes: {
      AdminKey: {
        type: "apiKey",
        in: "header",
        name: "x-admin-key",
        description: "Admin API key for protected endpoints",
      },
    },
    schemas: {
      SuccessResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          data: {},
        },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: { type: "string" },
        },
      },
      PredictionEvent: {
        type: "object",
        properties: {
          eventId: { type: "integer" },
          title: { type: "string" },
          category: { type: "string", enum: ["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"] },
          aiProbability: { type: "integer", minimum: 0, maximum: 100 },
          deadline: { type: "string", format: "date-time" },
          resolved: { type: "boolean" },
          outcome: { type: "boolean" },
          totalVotesYes: { type: "integer" },
          totalVotesNo: { type: "integer" },
          creator: { type: "string" },
          isUserEvent: { type: "boolean" },
        },
      },
      Quest: {
        type: "object",
        properties: {
          questId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          category: { type: "string", enum: ["daily", "weekly", "onetime"] },
          target: { type: "integer" },
          rewardPoints: { type: "integer" },
          rewardLabel: { type: "string" },
          progress: { type: "integer" },
          completed: { type: "boolean" },
          claimed: { type: "boolean" },
        },
      },
      UserProfile: {
        type: "object",
        properties: {
          address: { type: "string" },
          totalPoints: { type: "integer" },
          weeklyPoints: { type: "integer" },
          streak: { type: "integer" },
          totalCheckIns: { type: "integer" },
          correctPredictions: { type: "integer" },
          totalPredictions: { type: "integer" },
        },
      },
      LeaderboardEntry: {
        type: "object",
        properties: {
          rank: { type: "integer" },
          address: { type: "string" },
          totalPoints: { type: "integer" },
          weeklyPoints: { type: "integer" },
          streak: { type: "integer" },
          tier: { type: "string" },
        },
      },
    },
    parameters: {
      AddressPath: {
        name: "address",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" },
        description: "Ethereum wallet address",
      },
      LangQuery: {
        name: "lang",
        in: "query",
        schema: { type: "string", default: "en" },
        description: "Language code for translated content",
      },
      LimitQuery: {
        name: "limit",
        in: "query",
        schema: { type: "integer", default: 50 },
        description: "Maximum number of results",
      },
    },
  },
  paths: {
    // ─── Health ────────────────────────────────────────────────
    "/api/health": {
      get: {
        tags: ["Health"],
        summary: "Deep health check",
        description: "Returns service status including database connectivity and RPC block number.",
        responses: {
          200: {
            description: "Healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    db: { type: "string", example: "connected" },
                    blockNumber: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ─── Predictions ───────────────────────────────────────────
    "/api/predictions": {
      get: {
        tags: ["Predictions"],
        summary: "Get active predictions",
        parameters: [
          { $ref: "#/components/parameters/LangQuery" },
          { name: "address", in: "query", schema: { type: "string" }, description: "Wallet address for vote status" },
        ],
        responses: {
          200: { description: "List of active prediction events", content: { "application/json": { schema: { $ref: "#/components/schemas/SuccessResponse" } } } },
        },
      },
    },
    "/api/predictions/all": {
      get: {
        tags: ["Predictions"],
        summary: "Get all predictions (paginated)",
        parameters: [
          { $ref: "#/components/parameters/LangQuery" },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { $ref: "#/components/parameters/LimitQuery" },
        ],
        responses: {
          200: { description: "Paginated list of all prediction events" },
        },
      },
    },
    "/api/predictions/resolved": {
      get: {
        tags: ["Predictions"],
        summary: "Get resolved predictions",
        parameters: [
          { $ref: "#/components/parameters/LangQuery" },
          { name: "address", in: "query", schema: { type: "string" } },
          { name: "includeArchived", in: "query", schema: { type: "boolean" } },
        ],
        responses: { 200: { description: "Resolved prediction events" } },
      },
    },
    "/api/predictions/voted/{address}": {
      get: {
        tags: ["Predictions"],
        summary: "Get predictions voted on by address",
        parameters: [
          { $ref: "#/components/parameters/AddressPath" },
          { $ref: "#/components/parameters/LangQuery" },
          { $ref: "#/components/parameters/LimitQuery" },
        ],
        responses: { 200: { description: "Events with user votes" } },
      },
    },
    "/api/predictions/scheduler": {
      get: {
        tags: ["Predictions"],
        summary: "Get scheduler status",
        responses: { 200: { description: "Scheduler state and runtime metrics" } },
      },
    },
    "/api/predictions/qa-report": {
      get: {
        tags: ["Predictions"],
        summary: "QA quality report",
        parameters: [{ $ref: "#/components/parameters/LimitQuery" }],
        responses: { 200: { description: "Quality assurance report rows" } },
      },
    },
    "/api/predictions/generate": {
      post: {
        tags: ["Predictions"],
        summary: "Trigger AI event generation",
        responses: { 200: { description: "Newly created events" } },
      },
    },
    "/api/predictions/{eventId}/resolve": {
      post: {
        tags: ["Predictions"],
        summary: "Resolve a prediction event",
        parameters: [{ name: "eventId", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: { outcome: { type: "boolean" } }, required: ["outcome"] } } },
        },
        responses: {
          200: { description: "Resolution result" },
          400: { description: "Invalid request" },
        },
      },
    },
    "/api/predictions/user/validate": {
      post: {
        tags: ["Predictions"],
        summary: "Validate a user-created prediction event",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  category: { type: "string" },
                  deadlineMs: { type: "integer" },
                  sourcePolicy: { type: "string" },
                  creator: { type: "string" },
                },
                required: ["title", "category", "deadlineMs", "sourcePolicy"],
              },
            },
          },
        },
        responses: {
          200: { description: "Validation result with AI analysis" },
          400: { description: "Validation failed" },
          429: { description: "Rate limited" },
        },
      },
    },
    "/api/predictions/user/ingest": {
      post: {
        tags: ["Predictions"],
        summary: "Ingest a validated user event into the system",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: { eventId: { type: "integer" } }, required: ["eventId"] } } },
        },
        responses: {
          200: { description: "Ingested event data" },
          400: { description: "Invalid event or not yet validated" },
        },
      },
    },

    // ─── Admin ─────────────────────────────────────────────────
    "/api/predictions/admin/scheduler/start": {
      post: {
        tags: ["Admin"],
        summary: "Start the prediction scheduler",
        security: [{ AdminKey: [] }],
        responses: { 200: { description: "Scheduler started" }, 403: { description: "Unauthorized" } },
      },
    },
    "/api/predictions/admin/scheduler/kick": {
      post: {
        tags: ["Admin"],
        summary: "Force a scheduler cycle",
        security: [{ AdminKey: [] }],
        responses: { 200: { description: "Kick result" }, 403: { description: "Unauthorized" } },
      },
    },
    "/api/predictions/admin/purge-generated": {
      post: {
        tags: ["Admin"],
        summary: "Purge AI-generated events",
        security: [{ AdminKey: [] }],
        responses: { 200: { description: "Purge result" } },
      },
    },
    "/api/predictions/admin/purge-all": {
      post: {
        tags: ["Admin"],
        summary: "Purge all events",
        security: [{ AdminKey: [] }],
        parameters: [{ name: "keepUser", in: "query", schema: { type: "boolean" } }],
        responses: { 200: { description: "Purge result" } },
      },
    },

    // ─── Leaderboard ───────────────────────────────────────────
    "/api/leaderboard": {
      get: {
        tags: ["Leaderboard"],
        summary: "Get top users leaderboard",
        parameters: [{ $ref: "#/components/parameters/LimitQuery" }],
        responses: {
          200: {
            description: "Leaderboard entries",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: { type: "array", items: { $ref: "#/components/schemas/LeaderboardEntry" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/leaderboard/user/{address}": {
      get: {
        tags: ["Leaderboard"],
        summary: "Get user rank on leaderboard",
        parameters: [{ $ref: "#/components/parameters/AddressPath" }],
        responses: { 200: { description: "User rank data" }, 404: { description: "User not found" } },
      },
    },
    "/api/leaderboard/accuracy": {
      get: {
        tags: ["Leaderboard"],
        summary: "Prediction accuracy ranking",
        parameters: [
          { $ref: "#/components/parameters/LimitQuery" },
          { name: "min", in: "query", schema: { type: "integer", default: 5 }, description: "Minimum predictions to qualify" },
        ],
        responses: { 200: { description: "Accuracy ranking list" } },
      },
    },
    "/api/leaderboard/epoch/current": {
      get: {
        tags: ["Leaderboard"],
        summary: "Get current prize epoch",
        responses: { 200: { description: "Current epoch info or null" } },
      },
    },
    "/api/leaderboard/claim-proof/{address}": {
      get: {
        tags: ["Leaderboard"],
        summary: "Get Merkle claim proof for address",
        parameters: [{ $ref: "#/components/parameters/AddressPath" }],
        responses: { 200: { description: "Merkle proof data or null" } },
      },
    },

    // ─── Users ─────────────────────────────────────────────────
    "/api/user/{address}": {
      get: {
        tags: ["Users"],
        summary: "Get user profile",
        parameters: [{ $ref: "#/components/parameters/AddressPath" }],
        responses: {
          200: {
            description: "User profile with on-chain data",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SuccessResponse" } } },
          },
        },
      },
    },
    "/api/user/{address}/history": {
      get: {
        tags: ["Users"],
        summary: "Get check-in history",
        parameters: [{ $ref: "#/components/parameters/AddressPath" }],
        responses: { 200: { description: "Check-in records" } },
      },
    },
    "/api/user/{address}/referral-code": {
      get: {
        tags: ["Users"],
        summary: "Get user referral code",
        parameters: [{ $ref: "#/components/parameters/AddressPath" }],
        responses: { 200: { description: "Referral code" } },
      },
    },
    "/api/user/{address}/referral-stats": {
      get: {
        tags: ["Users"],
        summary: "Get referral statistics",
        parameters: [{ $ref: "#/components/parameters/AddressPath" }],
        responses: { 200: { description: "Referral tree stats" } },
      },
    },
    "/api/user/{address}/creator-stats": {
      get: {
        tags: ["Users"],
        summary: "Get creator economy stats",
        parameters: [{ $ref: "#/components/parameters/AddressPath" }],
        responses: { 200: { description: "Creator stats with events and payouts" } },
      },
    },
    "/api/user/{address}/onboarding": {
      get: {
        tags: ["Users"],
        summary: "Get onboarding status",
        parameters: [{ $ref: "#/components/parameters/AddressPath" }],
        responses: { 200: { description: "Onboarding flags" } },
      },
    },
    "/api/user/{address}/referral": {
      post: {
        tags: ["Users"],
        summary: "Register referral",
        parameters: [{ $ref: "#/components/parameters/AddressPath" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  referrerCode: { type: "string" },
                  attribution: {
                    type: "object",
                    properties: {
                      utmSource: { type: "string" },
                      utmMedium: { type: "string" },
                      utmCampaign: { type: "string" },
                      utmContent: { type: "string" },
                      eventId: { type: "integer" },
                      landingPath: { type: "string" },
                    },
                  },
                },
                required: ["referrerCode"],
              },
            },
          },
        },
        responses: {
          200: { description: "Referral registered" },
          400: { description: "Invalid request" },
          404: { description: "Referrer not found" },
          429: { description: "Rate limited" },
        },
      },
    },

    // ─── Quests ────────────────────────────────────────────────
    "/api/quests/{address}": {
      get: {
        tags: ["Quests"],
        summary: "Get quests with progress for address",
        parameters: [{ $ref: "#/components/parameters/AddressPath" }],
        responses: {
          200: {
            description: "Quest list with user progress",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: { type: "array", items: { $ref: "#/components/schemas/Quest" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/quests/{address}/progress": {
      post: {
        tags: ["Quests"],
        summary: "Update quest progress",
        parameters: [{ $ref: "#/components/parameters/AddressPath" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  questId: { type: "string" },
                  increment: { type: "integer", default: 1 },
                },
                required: ["questId"],
              },
            },
          },
        },
        responses: {
          200: { description: "Updated progress" },
          400: { description: "Invalid quest" },
          404: { description: "Quest not found" },
        },
      },
    },
    "/api/quests/{address}/claim": {
      post: {
        tags: ["Quests"],
        summary: "Claim quest reward",
        parameters: [{ $ref: "#/components/parameters/AddressPath" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { questId: { type: "string" } },
                required: ["questId"],
              },
            },
          },
        },
        responses: {
          200: { description: "Reward claimed" },
          400: { description: "Not completed or already claimed" },
          404: { description: "Quest not found" },
        },
      },
    },

    // ─── Stats ─────────────────────────────────────────────────
    "/api/stats": {
      get: {
        tags: ["Stats"],
        summary: "Platform statistics",
        responses: { 200: { description: "Aggregate platform stats" } },
      },
    },
    "/api/stats/contracts": {
      get: {
        tags: ["Stats"],
        summary: "Deployed contract addresses",
        responses: { 200: { description: "Contract address map" } },
      },
    },
    "/api/stats/activity": {
      get: {
        tags: ["Stats"],
        summary: "Recent check-in activity",
        parameters: [{ $ref: "#/components/parameters/LimitQuery" }],
        responses: { 200: { description: "Recent activity entries" } },
      },
    },
    "/api/stats/tge-forecast": {
      get: {
        tags: ["Stats"],
        summary: "TGE airdrop forecast",
        responses: { 200: { description: "Token distribution scenarios" } },
      },
    },

    // ─── Insights ──────────────────────────────────────────────
    "/api/insights/top": {
      get: {
        tags: ["Insights"],
        summary: "Top confidence AI predictions",
        parameters: [
          { $ref: "#/components/parameters/LimitQuery" },
          { name: "minConfidence", in: "query", schema: { type: "number", default: 0.7 }, description: "Minimum confidence threshold" },
        ],
        responses: { 200: { description: "High-confidence AI insights with edge scores" } },
      },
    },
    "/api/insights/category/{category}": {
      get: {
        tags: ["Insights"],
        summary: "Category deep dive with accuracy stats",
        parameters: [
          { name: "category", in: "path", required: true, schema: { type: "string", enum: ["SPORTS", "POLITICS", "ECONOMY", "CRYPTO", "CLIMATE"] } },
          { $ref: "#/components/parameters/LimitQuery" },
          { name: "includeResolved", in: "query", schema: { type: "boolean" } },
        ],
        responses: { 200: { description: "Category events and AI accuracy breakdown" } },
      },
    },
    "/api/insights/accuracy": {
      get: {
        tags: ["Insights"],
        summary: "AI model accuracy breakdown by category",
        responses: { 200: { description: "Overall and per-category accuracy stats" } },
      },
    },
    "/api/insights/trending": {
      get: {
        tags: ["Insights"],
        summary: "Trending events by community engagement",
        parameters: [{ $ref: "#/components/parameters/LimitQuery" }],
        responses: { 200: { description: "Events ranked by vote count and sentiment" } },
      },
    },
    "/api/insights/contrarian": {
      get: {
        tags: ["Insights"],
        summary: "Events where AI and community disagree",
        parameters: [
          { $ref: "#/components/parameters/LimitQuery" },
          { name: "minVotes", in: "query", schema: { type: "integer", default: 5 } },
        ],
        responses: { 200: { description: "Contrarian opportunities ranked by disagreement" } },
      },
    },
  },
};

export default spec;
