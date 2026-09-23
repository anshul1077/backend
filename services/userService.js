import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import redisClient from "../config/redis.js";
import User from "../models/user.js";
import Auth from "../models/authActivities.js";
import Session from "../models/session.js";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const userService = {
  async getHealthStatus() {
    const dbState = mongoose.connection.readyState;
    const isDbConnected = dbState === 1;

    let isRedisConnected = false;
    try {
      const pong = await redisClient.ping();
      isRedisConnected = pong === "PONG" || pong === true;
    } catch (redisErr) {
      isRedisConnected = false;
    }

    return {
      status: "OK",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        server: "up",
        database: isDbConnected ? "connected" : "disconnected",
        redis: isRedisConnected ? "connected" : "disconnected",
      },
    };
  },

  async getReadinessStatus() {
    const dbState = mongoose.connection.readyState;
    const isDbConnected = dbState === 1;

    let isRedisConnected = false;
    try {
      const pong = await redisClient.ping();
      isRedisConnected = pong === "PONG" || pong === true;
    } catch (redisErr) {
      isRedisConnected = false;
    }

    const isReady = isDbConnected && isRedisConnected;

    return {
      status: isReady ? "READY" : "NOT_READY",
      timestamp: new Date().toISOString(),
      services: {
        database: isDbConnected ? "connected" : "disconnected",
        redis: isRedisConnected ? "connected" : "disconnected",
      },
    };
  },

  async signup({
    name,
    email,
    password,
    address,
    countryCode,
    phone,
    dateOfBirth,
    image,
  }) {
    const userExists = await User.findOne({
      email: email.toLowerCase(),
    });

    if (userExists) {
      const error = new Error("User already exists");
      error.status = 400;
      throw error;
    }

    let cloudinaryImageUrl = null;

    if (image && image.trim() !== "") {
      try {
        const result = await cloudinary.uploader.upload(image, {
          folder: "user_avatars",
          resource_type: "image",
        });

        cloudinaryImageUrl = result.secure_url;
      } catch (cloudinaryError) {
        console.error("========== CLOUDINARY ERROR ==========");
        console.error(cloudinaryError);
        console.error("======================================");

        const error = new Error("Failed to upload image");
        error.status = 500;
        error.error = cloudinaryError?.message || "Cloudinary upload failed";
        throw error;
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      address,
      countryCode,
      phone,
      dateOfBirth,
      avtarKey: cloudinaryImageUrl,
      isVerified: false,
    });

    return {
      message: "User sign-up successfully!",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        address: user.address,
        countryCode: user.countryCode,
        phone: user.phone,
        dateOfBirth: user.dateOfBirth,
        avtarKey: user.avtarKey,
        isVerified: user.isVerified,
      },
    };
  },

  async requestOtp(phone) {
    const cooldownKey = `cooldown:${phone}`;
    const otpKey = `otp:${phone}`;

    const existingCooldown = await redisClient.get(cooldownKey);
    if (existingCooldown) {
      const error = new Error("Please wait before requesting another OTP.");
      error.status = 429;
      throw error;
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHashed = crypto.createHash("sha256").update(otp).digest("hex");

    await redisClient.hSet(otpKey, {
      hash: otpHashed,
      attempts: 0,
    });

    await redisClient.expire(otpKey, 300);
    await redisClient.set(cooldownKey, "active", { EX: 30 });

    return {
      message: "OTP sent successfully via SMS",
      otp,
    };
  },

  async verifyOtp({ phone, otp, req }) {
    const otpKey = `otp:${phone}`;
    const otpData = await redisClient.hGetAll(otpKey);

    if (!otpData || !otpData.hash) {
      const error = new Error("OTP expired or not found");
      error.status = 400;
      throw error;
    }

    const attempts = parseInt(otpData.attempts, 10) || 0;
    if (attempts >= 5) {
      await redisClient.del(otpKey);
      const error = new Error("Too many failed attempts. Please request a new OTP.");
      error.status = 400;
      throw error;
    }

    const incomingHashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    if (otpData.hash !== incomingHashedOtp) {
      await redisClient.hIncrBy(otpKey, "attempts", 1);
      const remainingAttempts = 5 - (attempts + 1);
      const error = new Error(`Invalid OTP. ${remainingAttempts} attempts remaining.`);
      error.status = 401;
      throw error;
    }

    await redisClient.del(otpKey);

    const user = await User.findOneAndUpdate(
      { phone },
      { isVerified: true },
      { returnDocument: "after" }
    );

    if (!user) {
      const error = new Error("User not found");
      error.status = 404;
      throw error;
    }

    const accessToken = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "15m" }
    );

    const refreshToken = jwt.sign(
      { userId: user._id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRY || "7d" }
    );

    if (req.session) {
      req.session.userId = user._id;
      req.session.email = user.email;
    }

    await Auth.create({
      userId: user._id,
      event: "login",
      success: true,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return {
      message: "OTP Verified, Login successful",
      accessToken,
      refreshToken,
      userId: user._id,
      email: user.email,
      isVerified: true,
    };
  },

  async login({ email, password, req }) {
    const user = await User.findOne({ email });
    if (!user) {
      const error = new Error("Invalid email or password");
      error.status = 401;
      throw error;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      const error = new Error("Invalid email or password");
      error.status = 401;
      throw error;
    }

    if (!user.isVerified) {
      const error = new Error("Account not verified. Please request and verify your OTP before logging in.");
      error.status = 403;
      throw error;
    }

    const accessToken = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "15m" }
    );

    const refreshToken = jwt.sign(
      { userId: user._id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRY || "7d" }
    );

    if (req.session) {
      req.session.userId = user._id;
      req.session.email = user.email;
    }

    const familyId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const sessionDoc = await Session.create({
      userId: user._id,
      tokenId,
      familyId,
      issuedAt,
      expiresAt,
      userAgent: req.headers["user-agent"],
    });

    await Auth.create({
      userId: user._id,
      event: "login",
      success: true,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return {
      message: "Login successful",
      accessToken,
      refreshToken,
      sessionId: sessionDoc._id,
      userId: user._id,
      email: user.email,
      isVerified: user.isVerified,
    };
  },

  async refreshAccessToken(refreshToken) {
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    } catch (err) {
      const error = new Error("Invalid or expired refresh token.");
      error.status = 403;
      throw error;
    }

    const userId = decoded.userId;
    const user = await User.findById(userId);

    if (!user) {
      const error = new Error("User no longer exists.");
      error.status = 401;
      throw error;
    }

    const newAccessToken = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "15m" }
    );

    const newRefreshToken = jwt.sign(
      { userId: user._id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRY || "7d" }
    );

    return {
      message: "Token refreshed successfully",
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  },

  async getCurrentUserByToken(token) {
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    } catch (error) {
      const err = new Error("Invalid or expired token.");
      err.status = 401;
      throw err;
    }

    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      const err = new Error("User profile not found");
      err.status = 404;
      throw err;
    }

    return user;
  },

  async updateUserProfile(userId, value) {
    console.log("Updating user profile for userId:", userId, "with value:", value);

    const updatePayload = { ...value };

    if (Object.prototype.hasOwnProperty.call(updatePayload, "image")) {
      if (typeof updatePayload.image === "string" && updatePayload.image.trim() !== "") {
        try {
          const result = await cloudinary.uploader.upload(updatePayload.image, {
            folder: "user_avatars",
            resource_type: "image",
          });
          updatePayload.avtarKey = result.secure_url;
        } catch (cloudinaryError) {
          console.error("========== CLOUDINARY ERROR ==========");
          console.error(cloudinaryError);
          console.error("======================================");

          const error = new Error("Failed to upload image");
          error.status = 500;
          error.error = cloudinaryError?.message || "Cloudinary upload failed";
          throw error;
        }
      }
      delete updatePayload.image;
    }

    if (updatePayload.email) {
      updatePayload.email = updatePayload.email.toLowerCase();
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updatePayload,
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedUser) {
      const error = new Error("User profile not found");
      error.status = 404;
      throw error;
    }

    return {
      message: "Profile updated completely successfully",
      user: updatedUser,
    };
  },

  async patchUserProfile(userId, value) {
    const updatePayload = { ...value };

    if (Object.prototype.hasOwnProperty.call(updatePayload, "image")) {
      if (typeof updatePayload.image === "string" && updatePayload.image.trim() !== "") {
        try {
          const result = await cloudinary.uploader.upload(updatePayload.image, {
            folder: "user_avatars",
            resource_type: "image",
          });
          updatePayload.avtarKey = result.secure_url;
        } catch (cloudinaryError) {
          console.error("========== CLOUDINARY ERROR ==========");
          console.error(cloudinaryError);
          console.error("======================================");

          const error = new Error("Failed to upload image");
          error.status = 500;
          error.error = cloudinaryError?.message || "Cloudinary upload failed";
          throw error;
        }
      }
      delete updatePayload.image;
    }

    if (updatePayload.email) {
      updatePayload.email = updatePayload.email.toLowerCase();
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updatePayload },
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedUser) {
      const error = new Error("User profile not found");
      error.status = 404;
      throw error;
    }

    return {
      message: "Profile updated partially successfully",
      user: updatedUser,
    };
  },

  async deleteUserProfile(userId) {
    const deletedUser = await User.findByIdAndDelete(userId);
    if (!deletedUser) {
      const error = new Error("User profile not found");
      error.status = 404;
      throw error;
    }
  },

  async getUserById(id) {
    return User.findById(id).select("-password");
  },

  async logout(req) {
    let userId = null;

    const refreshToken = req.cookies?.refreshToken;

    if (refreshToken) {
      try {
        const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
        userId = decoded.userId;
        await Session.deleteMany({ userId: decoded.userId });
      } catch (err) {
        console.log("Refresh token invalid/expired during logout");
      }
    }

    if (!userId && req.session?.userId) {
      userId = req.session.userId;
    }

    if (userId) {
      await Auth.create({
        userId: userId,
        event: "logout",
        success: true,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      console.log("Logout activity saved for user:", userId);
    } else {
      console.log("Logout activity NOT saved: userId not found");
    }

    return { message: "Logged out successfully" };
  },

  async getAuthActivities(id, { event, startDate, endDate, success }) {
    const matchCriteria = {
      userId: new mongoose.Types.ObjectId(id),
    };

    if (success !== undefined) {
      matchCriteria.success = success === "true";
    }

    if (event) {
      matchCriteria.event = event;
    }

    if (startDate || endDate) {
      matchCriteria.createdAt = {};

      if (startDate) {
        matchCriteria.createdAt.$gte = new Date(startDate);
      }

      if (endDate) {
        matchCriteria.createdAt.$lte = new Date(endDate);
      }
    }

    const activities = await Auth.find(matchCriteria)
      .sort({ createdAt: -1 })
      .select("-__v");

    return {
      message: "Auth activity fetched successfully",
      totalActivities: activities.length,
      data: activities,
    };
  },
};

export default userService;
