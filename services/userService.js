import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import redisClient from "../config/redis.js";
import User from "../models/user.js";
import Auth from "../models/authActivities.js";
import Session from "../models/session.js";

const userCacheKey = (userId) => `user:${userId}`;
const signupUserKey = (userId) => `signup:user:${userId}`;
const signupPhoneKey = (phone) => `signup:phone:${phone}`;
const otpRequestKey = (userId, requestId) => `otp:request:${userId}:${requestId}`;
const otpLoginKey = (userId, loginId) => `otp:login:${userId}:${loginId}`;
const avatarUploadKey = (uploadId) => `avatar-upload:${uploadId}`;
const signupAvatarUploadKey = (uploadId) => `signup-avatar-upload:${uploadId}`;
const avatarFolder = "user_avatars";
const avatarMaxBytes = 5 * 1024 * 1024;
const avatarFormats = new Set(["jpg", "jpeg", "png", "webp"]);
const avatarUrlTtlSeconds = 5 * 60;

const createAvatarUrl = (publicId) => {
  if (!publicId) {
    return null;
  }

  if (!process.env.CLOUDINARY_AUTH_TOKEN_KEY) {
    throw new Error("CLOUDINARY_AUTH_TOKEN_KEY is required for avatar URLs");
  }

  return cloudinary.url(publicId, {
    resource_type: "image",
    type: "authenticated",
    secure: true,
    sign_url: true,
    auth_token: {
      key: process.env.CLOUDINARY_AUTH_TOKEN_KEY,
      duration: avatarUrlTtlSeconds,
    },
  });
};

const toPublicUser = (user, includeAvatarId = false) => {
  const publicUser = user.toObject ? user.toObject() : { ...user };
  delete publicUser.password;
  delete publicUser.__v;
  delete publicUser.avtarKey;
  if (!includeAvatarId) {
    delete publicUser.avtarPublicId;
  }
  publicUser.avatarUrl = createAvatarUrl(publicUser.avtarPublicId);
  return publicUser;
};

const cacheUser = async (user) => {
  const publicUser = toPublicUser(user);
  const cachedUser = toPublicUser(user, true);
  const cacheTtl = Number.parseInt(process.env.USER_CACHE_TTL, 10);
  const cacheKey = userCacheKey(publicUser._id.toString());

  try {
    if (!redisClient.isReady) {
      throw new Error("Redis client is not ready");
    }

    const serializedUser = JSON.stringify(cachedUser);
    if (Number.isInteger(cacheTtl) && cacheTtl > 0) {
      await redisClient.set(cacheKey, serializedUser, { EX: cacheTtl });
    } else {
      await redisClient.set(cacheKey, serializedUser);
    }

    console.log(`User cached in Redis: ${cacheKey}`);
  } catch (error) {
    console.error("Failed to cache user:", error.message);
  }

  return publicUser;
};

const getCachedUser = async (userId) => {
  try {
    const cachedUser = await redisClient.get(userCacheKey(userId));
    if (!cachedUser) {
      return null;
    }

    const parsedUser = JSON.parse(cachedUser);
    parsedUser.avatarUrl = createAvatarUrl(parsedUser.avtarPublicId);
    delete parsedUser.avtarPublicId;
    return parsedUser;
  } catch (error) {
    console.error("Failed to read user cache:", error.message);
    return null;
  }
};

const invalidateUserCache = async (userId) => {
  if (!redisClient.isReady) {
    throw new Error("Redis client is not ready; user cache was not invalidated");
  }

  await redisClient.del(userCacheKey(userId));
  console.log(`User cache invalidated: ${userCacheKey(userId)}`);
};

const saveSignupRecord = async (userId, record, ttlSeconds = null) => {
  if (!redisClient.isReady) {
    throw new Error("Redis client is not ready; signup data was not stored");
  }

  const key = signupUserKey(userId);
  const serializedRecord = JSON.stringify(record);
  if (ttlSeconds) {
    await redisClient.set(key, serializedRecord, { EX: ttlSeconds });
  } else {
    await redisClient.set(key, serializedRecord);
  }
  await redisClient.set(signupPhoneKey(record.phone), userId.toString());
};

const getSignupRecordByPhone = async (phone) => {
  const userId = await redisClient.get(signupPhoneKey(phone));
  if (!userId) {
    return null;
  }

  const record = await redisClient.get(signupUserKey(userId));
  return record ? { userId, record: JSON.parse(record) } : null;
};

const saveOtpHistory = async (key, record, ttlSeconds = 30 * 24 * 60 * 60) => {
  if (!redisClient.isReady) {
    throw new Error("Redis is not connected; OTP history was not stored");
  }

  await redisClient.set(key, JSON.stringify(record), { EX: ttlSeconds });
};

const deleteCloudinaryAvatar = async (publicId) => {
  if (!publicId) {
    return;
  }

  await cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    type: "authenticated",
    invalidate: true,
  });
};

const createDirectAvatarUpload = async (keyFactory, ownerId = null) => {
  const uploadId = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `${ownerId ? `${ownerId}/` : "signup/"}${uploadId}`;
  const uploadParams = {
    folder: avatarFolder,
    public_id: publicId,
    type: "authenticated",
    timestamp,
  };
  const signature = cloudinary.utils.api_sign_request(
    uploadParams,
    process.env.CLOUDINARY_API_SECRET
  );

  await redisClient.set(
    keyFactory(uploadId),
    JSON.stringify({ userId: ownerId?.toString() || null, publicId }),
    { EX: 10 * 60 }
  );

  return {
    uploadId,
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    fields: {
      api_key: process.env.CLOUDINARY_API_KEY,
      folder: avatarFolder,
      public_id: publicId,
      type: "authenticated",
      timestamp,
      signature,
    },
    allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: avatarMaxBytes,
    expiresInSeconds: 600,
  };
};

const getVerifiedAvatarObject = async (publicId) => {
  let uploadedObject;
  try {
    uploadedObject = await cloudinary.api.resource(publicId, {
      resource_type: "image",
      type: "authenticated",
    });
  } catch (cloudinaryError) {
    const error = new Error("Uploaded avatar was not found");
    error.status = 400;
    throw error;
  }

  if (
    uploadedObject.public_id !== publicId ||
    uploadedObject.resource_type !== "image" ||
    uploadedObject.type !== "authenticated" ||
    !avatarFormats.has(uploadedObject.format?.toLowerCase()) ||
    uploadedObject.bytes > avatarMaxBytes
  ) {
    await deleteCloudinaryAvatar(publicId);
    const error = new Error("Avatar content type or size is not permitted");
    error.status = 400;
    throw error;
  }

  return uploadedObject;
};

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
    avatarUploadId,
    image,
  }) {
    let avatarPublicId = null;
    if (avatarUploadId) {
      const pendingUploadJson = await redisClient.get(signupAvatarUploadKey(avatarUploadId));
      if (!pendingUploadJson) {
        const error = new Error("Avatar upload is missing or expired");
        error.status = 400;
        throw error;
      }
      const pendingUpload = JSON.parse(pendingUploadJson);
      const uploadedObject = await getVerifiedAvatarObject(pendingUpload.publicId);
      avatarPublicId = uploadedObject.public_id;
    }

    if (image) {
      const error = new Error("Use avatarUploadId after direct Cloudinary upload; do not send base64 image data");
      error.status = 400;
      throw error;
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
      avtarKey: null,
      avtarPublicId: avatarPublicId,
      isVerified: false,
    });

    if (avatarUploadId) {
      await redisClient.del(signupAvatarUploadKey(avatarUploadId));
    }

    await saveSignupRecord(user._id, {
      userId: user._id.toString(),
      phone: user.phone,
      hasOtp: false,
      hashOtp: null,
      otpExpiresAt: null,
      attempts: 0,
      isVerified: false,
    });

    const publicUser = await cacheUser(user);

    return {
      message: "User sign-up successfully!",
      user: toPublicUser(user),
    };
  },

  async createAvatarUpload(userId) {
    return createDirectAvatarUpload(avatarUploadKey, userId);
  },

  async createSignupAvatarUpload() {
    return createDirectAvatarUpload(signupAvatarUploadKey);
  },

  async confirmAvatarUpload(userId, uploadId) {
    const pendingUploadJson = await redisClient.get(avatarUploadKey(uploadId));
    if (!pendingUploadJson) {
      const error = new Error("Avatar upload is missing or expired");
      error.status = 400;
      throw error;
    }

    const pendingUpload = JSON.parse(pendingUploadJson);
    if (pendingUpload.userId !== userId.toString()) {
      const error = new Error("Avatar upload does not belong to this user");
      error.status = 403;
      throw error;
    }

    const uploadedObject = await getVerifiedAvatarObject(pendingUpload.publicId);

    const user = await User.findById(userId).select("-password");
    if (!user) {
      const error = new Error("User profile not found");
      error.status = 404;
      throw error;
    }

    const previousPublicId = user.avtarPublicId;
    if (previousPublicId && previousPublicId !== uploadedObject.public_id) {
      await deleteCloudinaryAvatar(previousPublicId);
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        avtarPublicId: uploadedObject.public_id,
      },
      { new: true, runValidators: true }
    ).select("-password");

    await redisClient.del(avatarUploadKey(uploadId));
    await invalidateUserCache(userId);

    return {
      message: "Avatar uploaded and confirmed successfully",
      user: toPublicUser(updatedUser),
    };
  },

  async requestOtp(phone) {
    const cooldownKey = `cooldown:${phone}`;
    if (!redisClient.isReady) {
      const error = new Error("Redis is not connected");
      error.status = 503;
      throw error;
    }

    if (await redisClient.get(cooldownKey)) {
      const error = new Error("Please wait before requesting another OTP.");
      error.status = 429;
      throw error;
    }

    const signupData = await getSignupRecordByPhone(phone);
    if (!signupData) {
      const error = new Error("User signup record not found");
      error.status = 404;
      throw error;
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const hashOtp = crypto.createHash("sha256").update(otp).digest("hex");
    await saveSignupRecord(signupData.userId, {
      ...signupData.record,
      hasOtp: true,
      hashOtp,
      otpRequestId: crypto.randomUUID(),
      otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      attempts: 0,
    });
    const activeRecord = await getSignupRecordByPhone(phone);
    await saveOtpHistory(
      otpRequestKey(signupData.userId, activeRecord.record.otpRequestId),
      {
        userId: signupData.userId,
        phone,
        hashOtp,
        otpRequestId: activeRecord.record.otpRequestId,
        requestedAt: new Date().toISOString(),
        expiresAt: activeRecord.record.otpExpiresAt,
        status: "requested",
      }
    );
    await redisClient.set(cooldownKey, "active", { EX: 30 });

    return { message: "OTP sent successfully via SMS", otp };
  },

  async verifyOtp({ phone, otp, req }) {
    const signupData = await getSignupRecordByPhone(phone);
    const otpData = signupData?.record;

    if (!otpData || !otpData.hasOtp || !otpData.hashOtp) {
      const error = new Error("OTP expired or not found. Please request a new OTP.");
      error.status = 400;
      throw error;
    }

    const attempts = Number(otpData.attempts) || 0;
    if (attempts >= 5 || Date.now() > new Date(otpData.otpExpiresAt).getTime()) {
      await saveSignupRecord(signupData.userId, {
        ...otpData,
        hasOtp: false,
        hashOtp: null,
        otpExpiresAt: null,
        attempts: 0,
      });
      const error = new Error("OTP expired or too many attempts. Please request a new OTP.");
      error.status = 400;
      throw error;
    }

    const incomingHashOtp = crypto.createHash("sha256").update(otp).digest("hex");
    if (otpData.hashOtp !== incomingHashOtp) {
      await saveSignupRecord(signupData.userId, {
        ...otpData,
        attempts: attempts + 1,
      });
      const error = new Error(`Invalid OTP. ${5 - (attempts + 1)} attempts remaining.`);
      error.status = 401;
      throw error;
    }

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

    await saveSignupRecord(signupData.userId, {
      ...otpData,
      hasOtp: false,
      hashOtp: otpData.hashOtp,
      otpExpiresAt: null,
      attempts: 0,
      isVerified: true,
      otpVerifiedAt: new Date().toISOString(),
    });
    await saveOtpHistory(
      otpLoginKey(signupData.userId, crypto.randomUUID()),
      {
        userId: signupData.userId,
        phone,
        hashOtp: otpData.hashOtp,
        otpRequestId: otpData.otpRequestId,
        loggedInAt: new Date().toISOString(),
        status: "login_success",
      }
    );
    await invalidateUserCache(user._id);

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

    // const cachedUser = await getCachedUser(decoded.userId);
    // if (cachedUser) {
    //   return cachedUser;
    // }

    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      const err = new Error("User profile not found");
      err.status = 404;
      throw err;
    }

    return toPublicUser(user);
  },

  async updateUserProfile(userId, value) {
    console.log("Updating user profile for userId:", userId, "with value:", value);

    const updatePayload = { ...value };

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

    await invalidateUserCache(updatedUser._id);

    return {
      message: "Profile updated completely successfully",
      user: toPublicUser(updatedUser),
    };
  },

  async patchUserProfile(userId, value) {
    const updatePayload = { ...value };

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

    await invalidateUserCache(updatedUser._id);

    return {
      message: "Profile updated partially successfully",
      user: toPublicUser(updatedUser),
    };
  },

  async deleteUserProfile(userId) {
    const deletedUser = await User.findByIdAndDelete(userId);
    if (!deletedUser) {
      const error = new Error("User profile not found");
      error.status = 404;
      throw error;
    }

    await invalidateUserCache(userId);
    await deleteCloudinaryAvatar(deletedUser.avtarPublicId);
  },

  async getUserById(id) {
  const user = await User.findById(id).select("-password");

  return user ? toPublicUser(user) : null;
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
