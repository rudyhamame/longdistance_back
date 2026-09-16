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
    isLoggedIn: {
      type: Boolean,
      default: false,
    },
    lastLoginAt: {
      type: Date,
      default: null,
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

const touchHistorySchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      default: SESSION_ID,
    },
    connectedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  },
);

const TouchHistory = mongoose.model("TouchHistory", touchHistorySchema);

const audioStateSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      default: SESSION_ID,
    },
    isPlaying: {
      type: Boolean,
      default: false,
    },
    pausedAtSeconds: {
      type: Number,
      default: 0,
    },
    startedFromSeconds: {
      type: Number,
      default: 0,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    completionLogged: {
      type: Boolean,
      default: false,
    },
  },
  {
    versionKey: false,
  },
);

const AudioState = mongoose.model("AudioState", audioStateSchema);

const createDefaultLover = (loverId) => ({
  loverId,
  displayName: loverId,
  partnerId: loverId === "Rod" ? "Nog" : "Rod",
  hand: "unknown",
  touches: 0,
  isTouching: false,
  hasReachedConnection: false,
  connected: false,
  isLoggedIn: false,
  lastLoginAt: null,
  updatedAt: null,
});

const createDefaultAudioState = () => ({
  sessionId: SESSION_ID,
  isPlaying: false,
  pausedAtSeconds: 0,
  startedFromSeconds: 0,
  startedAt: null,
  updatedAt: null,
  completionLogged: false,
});

const getAudioCurrentTime = (audioState, now = Date.now()) => {
  if (!audioState) return 0;
  if (!audioState.isPlaying || !audioState.startedAt) {
    return Math.max(0, Number(audioState.pausedAtSeconds) || 0);
  }

  const elapsedSeconds = Math.max(0, now - new Date(audioState.startedAt).getTime()) / 1000;
  return Math.max(0, (Number(audioState.startedFromSeconds) || 0) + elapsedSeconds);
};

const buildSessionState = (users, audioState) => {
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
      isLoggedIn: user.isLoggedIn,
      lastLoginAt: user.lastLoginAt,
      updatedAt: user.updatedAt,
    };
  }

  const readyLovers = REQUIRED_LOVERS.filter((loverId) => loverMap[loverId]?.isTouching === true);
  const connectedLovers = REQUIRED_LOVERS.filter((loverId) => loverMap[loverId]?.connected === true);
  const isConnected = REQUIRED_LOVERS.every((loverId) => loverMap[loverId]?.connected === true);
  const updatedAt = REQUIRED_LOVERS
    .map((loverId) => loverMap[loverId]?.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const normalizedAudioState = audioState || createDefaultAudioState();

  return {
    sessionId: SESSION_ID,
    lovers: loverMap,
    connection: {
      isConnected,
      readyLovers,
      connectedLovers,
      requiredFingers: CONNECTED_FINGER_COUNT,
      loggedInLovers: REQUIRED_LOVERS.filter((loverId) => loverMap[loverId]?.isLoggedIn === true),
      updatedAt,
    },
    audio: {
      isPlaying: normalizedAudioState.isPlaying === true,
      currentTime: getAudioCurrentTime(normalizedAudioState),
      pausedAtSeconds: Math.max(0, Number(normalizedAudioState.pausedAtSeconds) || 0),
      startedAt: normalizedAudioState.startedAt,
      updatedAt: normalizedAudioState.updatedAt,
      completionLogged: normalizedAudioState.completionLogged === true,
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

const ensureAudioStateExists = async () => {
  await AudioState.updateOne(
    { sessionId: SESSION_ID },
    {
      $setOnInsert: createDefaultAudioState(),
    },
    { upsert: true },
  );
};

const syncAudioState = async (wasConnected, isConnected) => {
  await ensureAudioStateExists();
  const audioState = await AudioState.findOne({ sessionId: SESSION_ID }).lean();
  const now = new Date();

  if (!audioState) {
    return createDefaultAudioState();
  }

  if (!wasConnected && isConnected) {
    await AudioState.updateOne(
      { sessionId: SESSION_ID },
      {
        $set: {
          isPlaying: true,
          startedFromSeconds: Math.max(0, Number(audioState.pausedAtSeconds) || 0),
          startedAt: now,
          updatedAt: now,
          completionLogged: false,
        },
      },
    );
  } else if (wasConnected && !isConnected) {
    const pausedAtSeconds = getAudioCurrentTime(audioState, now.getTime());
    await AudioState.updateOne(
      { sessionId: SESSION_ID },
      {
        $set: {
          isPlaying: false,
          pausedAtSeconds,
          startedFromSeconds: pausedAtSeconds,
          startedAt: null,
          updatedAt: now,
        },
      },
    );
  }

  return AudioState.findOne({ sessionId: SESSION_ID }).lean();
};

const refreshConnectionState = async () => {
  const users = await LoverStatus.find({ loverId: { $in: REQUIRED_LOVERS } }).lean();
  const everyoneTouching = REQUIRED_LOVERS.every((loverId) => users.find((user) => user.loverId === loverId)?.isTouching === true);
  const wasConnected = REQUIRED_LOVERS.every((loverId) => users.find((user) => user.loverId === loverId)?.connected === true);

  await LoverStatus.updateMany(
    { loverId: { $in: REQUIRED_LOVERS } },
    {
      $set: { connected: everyoneTouching },
    },
  );

  const refreshedUsers = await LoverStatus.find({ loverId: { $in: REQUIRED_LOVERS } }).lean();
  const audioState = await syncAudioState(wasConnected, everyoneTouching);

  return {
    users: refreshedUsers,
    audioState,
  };
};

const isConnectionLive = (users) => REQUIRED_LOVERS.every(
  (loverId) => users.find((user) => user.loverId === loverId)?.isTouching === true,
);

app.get("/api/health", async (_request, response) => {
  response.json({
    ok: true,
    service: "ld_back",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/auth/login", async (request, response) => {
  try {
    const loverId = normalizeLoverId(request.body?.loverId);
    if (!loverId) {
      response.status(400).json({ ok: false, error: "loverId must be Rod or Nog" });
      return;
    }

    await ensureUsersExist();

    await LoverStatus.updateOne(
      { loverId },
      {
        $set: {
          isLoggedIn: true,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    const { users, audioState } = await refreshConnectionState();

    response.json({
      ok: true,
      lover: users.find((user) => user.loverId === loverId) ?? null,
      session: buildSessionState(users, audioState),
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown server error",
    });
  }
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
    const usersBeforeUpdate = await LoverStatus.find({ loverId: { $in: REQUIRED_LOVERS } }).lean();
    const wasConnected = isConnectionLive(usersBeforeUpdate);

    const isTouching = touches >= CONNECTED_FINGER_COUNT;

    await LoverStatus.updateOne(
      { loverId },
      {
        $set: {
          displayName: loverId,
          partnerId: loverId === "Rod" ? "Nog" : "Rod",
          hand,
          touches,
          isTouching,
          hasReachedConnection: isTouching,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );

    const { users, audioState } = await refreshConnectionState();
    const isConnected = isConnectionLive(users);

    response.json({
      ok: true,
      session: buildSessionState(users, audioState),
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown server error",
    });
  }
});

app.post("/api/sessions/:sessionId/complete", async (request, response) => {
  try {
    await ensureUsersExist();
    await ensureAudioStateExists();

    const currentTime = Math.max(0, Number(request.body?.currentTime) || 0);
    const users = await LoverStatus.find({ loverId: { $in: REQUIRED_LOVERS } }).lean();
    const audioState = await AudioState.findOne({ sessionId: SESSION_ID }).lean();
    const isConnected = REQUIRED_LOVERS.every((loverId) => users.find((user) => user.loverId === loverId)?.connected === true);

    if (!isConnected || !audioState || audioState.completionLogged === true) {
      response.json({
        ok: true,
        session: buildSessionState(users, audioState),
      });
      return;
    }

    const now = new Date();

    await TouchHistory.create({
      sessionId: SESSION_ID,
      connectedAt: now,
    });

    await AudioState.updateOne(
      { sessionId: SESSION_ID },
      {
        $set: {
          isPlaying: false,
          pausedAtSeconds: 0,
          startedFromSeconds: 0,
          startedAt: null,
          updatedAt: now,
          completionLogged: true,
        },
      },
    );

    const refreshedAudioState = await AudioState.findOne({ sessionId: SESSION_ID }).lean();

    response.json({
      ok: true,
      session: buildSessionState(users, refreshedAudioState),
      completedAtSeconds: currentTime,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown server error",
    });
  }
});

app.get("/api/sessions/:sessionId/history", async (_request, response) => {
  try {
    const items = await TouchHistory.find({ sessionId: SESSION_ID })
      .sort({ connectedAt: -1 })
      .limit(50)
      .lean();

    response.json({
      ok: true,
      history: items,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown server error",
    });
  }
});

app.delete("/api/sessions/:sessionId/history", async (_request, response) => {
  try {
    await TouchHistory.deleteMany({ sessionId: SESSION_ID });

    response.json({
      ok: true,
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
    const { users, audioState } = await refreshConnectionState();

    response.json({
      ok: true,
      session: buildSessionState(users, audioState),
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
    await ensureAudioStateExists();

    app.listen(port, '127.0.0.1', () => {
      console.log(`ld_back listening on http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to start ld_back", error);
    process.exit(1);
  }
};

start();
