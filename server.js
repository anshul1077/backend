import "dotenv/config";


import express from "express";
import mongoose from "mongoose";
import session from "express-session";
import cookieParser from "cookie-parser";
import redisClient from "./config/redis.js";
import userRouter from "./routes/userRouter.js";
import MongoStore from "connect-mongo";
import User from "./models/user.js";


const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

app.use(express.urlencoded({
  extended: true,
  limit: "10mb"
}));


// --- ADDED SESSION MIDDLEWARE HERE ---
app.use(
  session({
    secret: process.env.SESSION_SECRET || "a_secure_fallback_secret_key",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI, // your MongoDB connection string
      collectionName: "sessions", // creates the 'sessions' collection automatically
      ttl: 14 * 24 * 60 * 60, // 14 days expiration
    }),
    cookie: {
      httpOnly: true,
      secure: false, // Set to true if you are using HTTPS production servers
      maxAge: 14 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use("/api/v1", userRouter);

app.get("/", (req, res) => {
  res.send("API is Running!");
});

// Start application
const startServer = async () => {
  try {
    // Connect Redis
    await redisClient.connect();

    console.log("Connected to Redis successfully!");

    // Connect MongoDB
    await mongoose.connect(process.env.MONGO_URI);

    console.log("Connected to MongoDB successfully!");
    const existingIndexes = await User.collection.indexes();
    for (const field of ["email", "phone"]) {
      const legacyIndex = existingIndexes.find((index) =>
        index.unique && !index.partialFilterExpression &&
        Object.keys(index.key).length === 1 && index.key[field] === 1
      );
      if (legacyIndex) {
        await User.collection.dropIndex(legacyIndex.name);
      }
    }
    await User.createIndexes();

    // Start Express
    app.listen(process.env.PORT, () => {
      console.log(`Server running on port ${process.env.PORT}`);
    });

  } catch (error) {
    console.error("Server startup error:", error);
    process.exit(1);
  }
};

startServer();
