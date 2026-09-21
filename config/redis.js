import { createClient } from "redis";

const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
});

redisClient.on("connect", () => {
  console.log("Redis connecting...");
});

redisClient.on("ready", () => {
  console.log("Redis connected successfully!");
});

redisClient.on("error", (error) => {
  console.error("Redis error:", error);
});

redisClient.on("end", () => {
  console.log("Redis connection closed");
});

export default redisClient;
