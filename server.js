import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";

dotenv.config();

const app = express();
const port = process.env.PORT || 4010;
const CONNECTED_FINGER_COUNT = 5;
const SESSION_ID = "main";
const REQUIRED_LOVERS = ["Rod", "Nog"];

app.use(cors());
app.use(express.json());

const userSchema = new mongoose.Schema(
  {
    loverId: {
      type: String,
      enum: REQUIRED_LOVERS,
      required: true,
      unique: true,
    },
    displayName: {
      type: String,
      required: true,
    },
    partnerId: {
      type: String,
      enum: REQUIRED_LOVERS,
      required: true,
    },
    hand: {
      type: String,
      default: "unknown",
    },
    touches: {
      type: Number,
      default: 0,
    },
    isTouching: {
      type: Boolean,
      default: false,
    },
    hasReachedConnection: {
      type: Boolean,
      default: false,
    },
    connected: {
      type: Boolean,
      default: false,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  },
);

const LoverStatus = mongoose.model("LoverStatus", userSchema);

const createDefaultLover = (loverId) => ({
  loverId,
  displayName: loverId,
  partnerId: loverId === "Rod" ? "Nog" : "Rod",
  hand: "unknown",
  touches: 0,
  isTouching: false,
  hasReachedConnection: false,
  connected: false,
  updatedAt: null,
});

const buildSessionState = (users) => {
  const loverMap = Object.fromEntries(REQUIRED_LOVERS.map((loverId) => [loverId, createDefaultLover(loverId)]));

  for (const user of users) {
    loverMap[user.loverId] = {
      loverId: user.loverId,
      displayName: user.displayName,
      partnerId: user.partnerId,
      hand: user.hand,
      touches: user.touches,
      isTouching: user.isTouching,
      hasReachedConnection: user.hasReachedConnection,
      connected: user.connected,
      updatedAt: user.updatedAt,
    };
  }

  const readyLovers = REQUIRED_LOVERS.filter((loverId) => loverMap[loverId]?.hasReachedConnection === true);
  const connectedLovers = REQUIRED_LOVERS.filter((loverId) => loverMap[loverId]?.connected === true);
  const isConnected = REQUIRED_LOVERS.every((loverId) => loverMap[loverId]?.connected === true);
  const updatedAt = REQUIRED_LOVERS
    .map((loverId) => loverMap[loverId]?.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null;

  return {
    sessionId: SESSION_ID,
    lovers: loverMap,
    connection: {
      isConnected,
      readyLovers,
      connectedLovers,
      requiredFingers: CONNECTED_FINGER_COUNT,
      updatedAt,
    },
  };
};

const normalizeLoverId = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "rod") return "Rod";
  if (normalized === "nog") return "Nog";
  return null;
};

const ensureUsersExist = async () => {
  for (const loverId of REQUIRED_LOVERS) {
    await LoverStatus.updateOne(
      { loverId },
      {
        $setOnInsert: createDefaultLover(loverId),
      },
      { upsert: true },
    );
  }
};

const refreshConnectionState = async () => {
  const users = await LoverStatus.find({ loverId: { $in: REQUIRED_LOVERS } }).lean();
  const everyoneReady = REQUIRED_LOVERS.every((loverId) => users.find((user) => user.loverId === loverId)?.hasReachedConnection === true);

  if (everyoneReady) {
    await LoverStatus.updateMany(
      { loverId: { $in: REQUIRED_LOVERS } },
      {
        $set: { connected: true },
      },
    );
  }

  return LoverStatus.find({ loverId: { $in: REQUIRED_LOVERS } }).lean();
};

app.get("/api/health", async (_request, response) => {
  response.json({
    ok: true,
    service: "ld_back",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/sessions/:sessionId/touch", async (request, response) => {
  try {
    const loverId = normalizeLoverId(request.body?.loverId);
    const { hand = "unknown" } = request.body ?? {};
    const touches = Math.max(0, Number(request.body?.touches) || 0);

    if (!loverId) {
      response.status(400).json({ error: "loverId must be Rod or Nog" });
      return;
    }

    await ensureUsersExist();

    const existingUser = await LoverStatus.findOne({ loverId }).lean();
    const hasReachedConnection = existingUser?.hasReachedConnection === true || touches >= CONNECTED_FINGER_COUNT;

    await LoverStatus.updateOne(
      { loverId },
      {
        $set: {
          displayName: loverId,
          partnerId: loverId === "Rod" ? "Nog" : "Rod",
          hand,
          touches,
          isTouching: touches > 0,
          hasReachedConnection,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );

    const users = await refreshConnectionState();

    response.json({
      ok: true,
      session: buildSessionState(users),
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown server error",
    });
  }
});

app.get("/api/sessions/:sessionId", async (_request, response) => {
  try {
    await ensureUsersExist();
    const users = await refreshConnectionState();

    response.json({
      ok: true,
      session: buildSessionState(users),
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown server error",
    });
  }
});

const start = async () => {
  try {
    if (!process.env.DB_CONNECTION) {
      throw new Error("DB_CONNECTION is missing in .env");
    }

    await mongoose.connect(process.env.DB_CONNECTION, {
      dbName: process.env.DB_NAME || "longdistance",
    });
    await ensureUsersExist();

    app.listen(port, () => {
      console.log(`ld_back listening on http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to start ld_back", error);
    process.exit(1);
  }
};

start();
