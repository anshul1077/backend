import express from "express";
import Auth from "../models/authActivities.js";
import mongoose from "mongoose";
import session from "express-session";
import User from "../models/user.js";
import multer from "multer";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { v2 as cloudinary } from "cloudinary"
import redisClient from "../config/redis.js";
// import admin from "../config/firebase.js";
import { auth } from "../config/firebase.js"
// import app from "../config/firebase.js"
import Joi from "joi";
import Session from "../models/session.js";
// import twilio from "twilio";

const router = express.Router();
// const upload = multer({ dest: "uploads/" });

console.log("Cloudinary environment check:", {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY ? "LOADED" : "MISSING",
  api_secret: process.env.CLOUDINARY_API_SECRET ? "LOADED" : "MISSING",
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// const twilioClient = twilio(
//   process.env.TWILIO_ACCOUNT_SID, 
//   process.env.TWILIO_AUTH_TOKEN
// );


const signupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(50).required(),
  email: Joi.string().trim().email().required(),
  password: Joi.string().min(6).required(),
  phone: Joi.string().trim().pattern(/^[0-9]+$/).min(7).max(15).required(),
  countryCode: Joi.string().trim().pattern(/^\+[0-9]+$/).min(2).max(5).required(),
  address: Joi.string().trim().required(),
  dateOfBirth: Joi.date().iso().max("now").required(),
  image: Joi.string().optional()
});

const loginSchema = Joi.object({
  email: Joi.string().trim().email().required(),
  password: Joi.string().min(6).required(),
});

const fullUpdateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(50).required(),
  email: Joi.string().trim().email().required(),
  phone: Joi.string().trim().pattern(/^[0-9]+$/).min(7).max(15).required(),
  address: Joi.string().trim().required(),
});

const partialUpdateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(50).optional(),
  email: Joi.string().trim().email().optional(),
  phone: Joi.string().trim().pattern(/^[0-9]+$/).min(7).max(15).optional(),
  address: Joi.string().trim().optional(),
  // countryCode: Joi.string().trim().pattern(/^\+[0-9]+$/).min(2).max(5).optional(),
  dateOfBirth: Joi.date().iso().max("now").optional(),
  password: Joi.any().forbidden().messages({
    "any.unknown": "Password updates cannot be processed via this profile route.",
  }),
});

const firebaseVerifySchema = Joi.object({
  idToken: Joi.string().required(),
  phone: Joi.string().trim().pattern(/^[0-9]+$/).min(7).max(15).required(),
});

const otpRequestSchema = Joi.object({
  phone: Joi.string().trim().pattern(/^[0-9]+$/).min(7).max(15).required(),

});

const otpVerifySchema = Joi.object({
  phone: Joi.string().trim().pattern(/^[0-9]+$/).min(7).max(15).required(),
  otp: Joi.string().trim().length(6).required(),
  isVerified: Joi.boolean(),
});

// 0. HEALTH CHECK / LIVENESS ROUTE
router.get("/healthz", async (req, res) => {
  try {
    // Check MongoDB connection state (1 = connected)
    const dbState = mongoose.connection.readyState;
    const isDbConnected = dbState === 1;

    // Check Redis connection status
    let isRedisConnected = false;
    try {
      const pong = await redisClient.ping();
      isRedisConnected = pong === "PONG" || pong === true;
    } catch (redisErr) {
      isRedisConnected = false;
    }

    const healthStatus = {
      status: "OK",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        server: "up",
        database: isDbConnected ? "connected" : "disconnected",
        redis: isRedisConnected ? "connected" : "disconnected",
      },
    };

    // Return 200 OK for liveness
    return res.status(200).json(healthStatus);
  } catch (error) {
    console.error("Health Check Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: error.message,
    });
  }
});

// 0. READINESS CHECK ROUTE
router.get("/readiz", async (req, res) => {
  try {
    // 1. Check MongoDB connection state (1 = connected)
    const dbState = mongoose.connection.readyState;
    const isDbConnected = dbState === 1;

    // 2. Check Redis connection status
    let isRedisConnected = false;
    try {
      const pong = await redisClient.ping();
      isRedisConnected = pong === "PONG" || pong === true;
    } catch (redisErr) {
      isRedisConnected = false;
    }

    // 3. Determine if app is ready for traffic
    const isReady = isDbConnected && isRedisConnected;

    const readinessStatus = {
      status: isReady ? "READY" : "NOT_READY",
      timestamp: new Date().toISOString(),
      services: {
        database: isDbConnected ? "connected" : "disconnected",
        redis: isRedisConnected ? "connected" : "disconnected",
      },
    };

    // Return 503 if critical dependencies are not ready
    if (!isReady) {
      return res.status(503).json(readinessStatus);
    }

    // Return 200 OK when fully ready
    return res.status(200).json(readinessStatus);
  } catch (error) {
    console.error("Readiness Check Error:", error);
    return res.status(503).json({
      status: "NOT_READY",
      message: error.message,
    });
  }
});



router.post("/users", async (req, res) => {
  try {
    const { error, value } = signupSchema.validate(req.body, {
      abortEarly: false,
    });

    if (error) {
      return res.status(400).json({
        message: "Validation error",
        errors: error.details.map((detail) => detail.message),
      });
    }

    const {
      name,
      email,
      password,
      address,
      countryCode,
      phone,
      dateOfBirth,
      image,
    } = value;

    // Check existing user
    const userExists = await User.findOne({
      email: email.toLowerCase(),
    });

    if (userExists) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    // =========================
    // CLOUDINARY IMAGE UPLOAD
    // =========================

    let cloudinaryImageUrl = null;

    if (image && image.trim() !== "") {
      try {
        const result = await cloudinary.uploader.upload(image, {
          folder: "user_avatars",
          resource_type: "image",
        });

        cloudinaryImageUrl = result.secure_url;

        console.log("Cloudinary image URL:", cloudinaryImageUrl);

      } catch (cloudinaryError) {
        console.error("========== CLOUDINARY ERROR ==========");
        console.error(cloudinaryError);
        console.error("======================================");

        return res.status(500).json({
          message: "Failed to upload image",
          error: cloudinaryError?.message || "Cloudinary upload failed",
        });
      }
    }

    // =========================
    // PASSWORD HASH
    // =========================

    const hashedPassword = await bcrypt.hash(password, 10);

    // =========================
    // CREATE USER
    // =========================

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

    return res.status(201).json({
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
    });

  } catch (error) {
    console.error("Signup Error:", error);

    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

router.post("/auth/otp/request", async (req, res) => {
  try {
    const { error, value } = otpRequestSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        message: "Validation error",
        errors: error.details.map((detail) => detail.message),
      });
    }

    const { phone } = value;
    const cooldownKey = `cooldown:${phone}`;
    const otpKey = `otp:${phone}`;

    
    const existingCooldown = await redisClient.get(cooldownKey);
    if (existingCooldown) {
      return res.status(429).json({ 
        message: "Please wait before requesting another OTP." 
      });
    }

    const otp = crypto.randomInt(100000, 1000000).toString();

    
    const otpHashed = crypto.createHash("sha256").update(otp).digest("hex");

    
    await redisClient.hSet(otpKey, {
      hash: otpHashed,
      attempts: 0,
    });
    
    await redisClient.expire(otpKey, 300);

    
    await redisClient.set(cooldownKey, "active", { EX: 30 });

   
    // await twilioClient.messages.create({
    //   body: `Your verification code is: ${otp}. It expires in 5 minutes.`,
    //   from: process.env.TWILIO_PHONE_NUMBER,
    //   to: phone,
    // });

      return res.status(200).json({ 
        message: "OTP sent successfully via SMS", 
        otp 
      });

  
  } catch (error) {
    console.error("OTP request error:", error);
    return res.status(500).json({ message: "Failed to send OTP via SMS" });
  }
});


router.post("/auth/otp/verify", async (req, res) => {
  try {
    const { error, value } = otpVerifySchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        message: "Validation error",
        errors: error.details.map((detail) => detail.message),
      });
    }

    const { phone, otp } = value;
    const otpKey = `otp:${phone}`;

    
    const otpData = await redisClient.hGetAll(otpKey);
    if (!otpData || !otpData.hash) {
      return res.status(400).json({ message: "OTP expired or not found" });
    }

    
    const attempts = parseInt(otpData.attempts, 10) || 0;
    if (attempts >= 5) {
      await redisClient.del(otpKey);
      return res.status(400).json({ message: "Too many failed attempts. Please request a new OTP." });
    }

    
    const incomingHashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    if (otpData.hash !== incomingHashedOtp) {
      await redisClient.hIncrBy(otpKey, "attempts", 1);
      const remainingAttempts = 5 - (attempts + 1);
      
      return res.status(401).json({ 
        message: `Invalid OTP. ${remainingAttempts} attempts remaining.` 
      });
    }

    
    await redisClient.del(otpKey);

    
    const user = await User.findOneAndUpdate(
      { phone },
      { isVerified: true },
      { returnDocument: 'after' }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
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

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

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

      return res.status(200).json({
      message: "OTP Verified, Login successful",
      accessToken,
      userId: user._id,
      email: user.email,
      isVerified: true
    });
  } catch (error) {
    console.error("OTP verify error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        message: "Validation error",
        errors: error.details.map((detail) => detail.message),
      });
    }

    const { email, password} = value;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid email or password" });

    }

    if (!user.isVerified) {
      return res.status(403).json({ 
        message: "Account not verified. Please request and verify your OTP before logging in." 
      });
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

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    if (req.session) {
      req.session.userId = user._id;
      req.session.email = user.email;
    }

    
    const familyId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days


    const sessionDoc = await Session.create({
    userId: user._id,
    tokenId,
    familyId,
    issuedAt,
    expiresAt,
    userAgent: req.headers["user-agent"],
  });

    // await Session.create({
    //   userId: user._id,
    //   tokenId,
    //   familyId,
    //   expiresAt,
    //   userAgent: req.headers["user-agent"],
    // });

    await Auth.create({
      userId: user._id,
      event: "login",
      success: true,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

      return res.status(200).json({
      message: "Login successful",
      accessToken,
      sessionId: sessionDoc._id, 
      userId: user._id,
      email: user.email,
      isVerified: user.isVerified
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/auth/refresh", async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ message: "Refresh token not found. Please log in again." });
    }

    // Verify Refresh Token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    } catch (err) {
      return res.status(403).json({ message: "Invalid or expired refresh token." });
    }

    const userId = decoded.userId;

    // Optional: Check if a corresponding session exists in MongoDB
    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({ message: "User no longer exists." });
    }

    // Generate new Token Pair (Rotation)
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

    // Update refresh token cookie
    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      message: "Token refreshed successfully",
      accessToken: newAccessToken,
    });
  } catch (error) {
    console.error("Refresh Token Error:", error);
    return res.status(500).json({ message: "Server error during token refresh" });
  }
});

router.get("/users/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized. Please log in with a valid token." });
    }

    const token = authHeader.split(" ")[1];
    
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User profile not found" });
    }

    return res.status(200).json(user);
  } catch (error) {
    console.error("Profile Fetch Error:", error);
    return res.status(401).json({ message: "Invalid or expired token." });
  }
});


router.put("/users/me", async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ message: "Unauthorized. Please log in first." });
    }

    const { error, value } = fullUpdateSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        message: "Validation error",
        errors: error.details.map((detail) => detail.message),
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.session.userId,
      value,
      { returnDocument: true, runValidators: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ message: "User profile not found" });
    }

    return res.status(200).json({
      message: "Profile updated completely successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("PUT Profile Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// 6. PARTIAL UPDATE PROFILE
router.patch("/users/me", async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ message: "Unauthorized. Please log in first." });
    }

    const { error, value } = partialUpdateSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        message: "Validation error",
        errors: error.details.map((detail) => detail.message),
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.session.userId,
      { $set: value },
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ message: "User profile not found" });
    }

    return res.status(200).json({
      message: "Profile updated partially successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("PATCH Profile Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// 7. DELETE PROFILE
router.delete("/users/me", async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ message: "Unauthorized. Please log in first." });
    }

    const deletedUser = await User.findByIdAndDelete(req.session.userId);
    if (!deletedUser) {
      return res.status(404).json({ message: "User profile not found" });
    }

    req.session.destroy((err) => {
      if (err) {
        console.error("Session clean error upon user deletion:", err);
        return res.status(500).json({ message: "Account removed, but session clear failed." });
      }
      res.clearCookie("connect.sid");
      res.clearCookie("refreshToken");
      return res.status(200).json({ message: "Your account profile has been completely deleted." });
    });
  } catch (error) {
    console.error("DELETE Profile Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// 8. DYNAMIC GET BY ID
router.get("/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(200).json(user);
  } catch (error) {
    console.error("Get User By ID Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/auth/logout", async (req, res) => {
  try {
    let userId = null;

    // 1. First try refresh token
    const refreshToken = req.cookies?.refreshToken;

    if (refreshToken) {
      try {
        const decoded = jwt.verify(
          refreshToken,
          process.env.REFRESH_TOKEN_SECRET
        );

        userId = decoded.userId;

        // Delete user's sessions
        await Session.deleteMany({
          userId: decoded.userId,
        });

      } catch (err) {
        console.log("Refresh token invalid/expired during logout");
      }
    }

    // 2. If refresh token is not available,
    // use express session userId
    if (!userId && req.session?.userId) {
      userId = req.session.userId;
    }

    // 3. Save logout activity in MongoDB
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

    // 4. Clear refresh token
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    // 5. Destroy express session
    if (req.session) {
      req.session.destroy((err) => {
        if (err) {
          console.error("Session destruction error:", err);
        }

        res.clearCookie("connect.sid");

        return res.status(200).json({
          message: "Logged out successfully",
        });
      });
    } else {
      return res.status(200).json({
        message: "Logged out successfully",
      });
    }

  } catch (error) {
    console.error("Logout Error:", error);

    return res.status(500).json({
      message: "Server error during logout",
    });
  }
});




// 11. GET USER AUTHENTICATION ACTIVITY
router.get("/users/:id/auth-activity", async (req, res) => {
  try {
    const { id } = req.params;
    const { event, startDate, endDate, success } = req.query;

    const matchCriteria = {
      userId: new mongoose.Types.ObjectId(id),
    };

    // Optional success filter
    if (success !== undefined) {
      matchCriteria.success = success === "true";
    }

    // Optional event filter
    // ?event=login
    // ?event=logout
    if (event) {
      matchCriteria.event = event;
    }

    // Optional date filter
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

    return res.status(200).json({
      message: "Auth activity fetched successfully",
      totalActivities: activities.length,
      data: activities,
    });

  } catch (error) {
    console.error("Auth Activity Error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
});

export default router;