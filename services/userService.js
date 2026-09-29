import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import redisClient from "../config/redis.js";
import User from "../models/user.js";
import Auth from "../models/authActivities.js";
import Session from "../models/session.js";


import {
  uploadAvatarToCloudinary,
  deleteCloudinaryAvatar,
  createAvatarUpload,
  confirmAvatarUpload,
} from "./avatarService.js";


const userCacheKey = (userId) =>
  `user:${userId}`;

const signupUserKey = (userId) =>
  `signup:user:${userId}`;

const signupPhoneKey = (phone) =>
  `signup:phone:${phone}`;

const otpRequestKey = (
  userId,
  requestId
) =>
  `otp:request:${userId}:${requestId}`;

const otpLoginKey = (
  userId,
  loginId
) =>
  `otp:login:${userId}:${loginId}`;


/*
|--------------------------------------------------------------------------
| Public User
|--------------------------------------------------------------------------
*/

const toPublicUser = (user) => {
  const publicUser = user.toObject
    ? user.toObject()
    : { ...user };

  delete publicUser.password;
  delete publicUser.__v;

  return publicUser;
};


/*
|--------------------------------------------------------------------------
| Cache User
|--------------------------------------------------------------------------
*/

const cacheUser = async (user) => {
  const publicUser =
    toPublicUser(user);

  const cacheTtl =
    Number.parseInt(
      process.env.USER_CACHE_TTL,
      10
    );

  const cacheKey =
    userCacheKey(
      publicUser._id.toString()
    );

  try {
    if (!redisClient.isReady) {
      throw new Error(
        "Redis client is not ready"
      );
    }

    const serializedUser =
      JSON.stringify(publicUser);

    if (
      Number.isInteger(cacheTtl) &&
      cacheTtl > 0
    ) {
      await redisClient.set(
        cacheKey,
        serializedUser,
        {
          EX: cacheTtl,
        }
      );
    } else {
      await redisClient.set(
        cacheKey,
        serializedUser
      );
    }
  } catch (error) {
    console.error(
      "Failed to cache user:",
      error.message
    );
  }

  return publicUser;
};


const getCachedUser =
  async (userId) => {
    try {
      if (!redisClient.isReady) {
        return null;
      }

      const cachedUser =
        await redisClient.get(
          userCacheKey(userId)
        );

      if (!cachedUser) {
        return null;
      }

      return JSON.parse(
        cachedUser
      );
    } catch (error) {
      console.error(
        "Failed to read user cache:",
        error.message
      );

      return null;
    }
  };


const invalidateUserCache =
  async (userId) => {
    try {
      if (!redisClient.isReady) {
        return;
      }

      await redisClient.del(
        userCacheKey(userId)
      );
    } catch (error) {
      console.error(
        "Failed to invalidate user cache:",
        error.message
      );
    }
  };


/*
|--------------------------------------------------------------------------
| Signup Redis
|--------------------------------------------------------------------------
*/

const saveSignupRecord =
  async (
    userId,
    record,
    ttlSeconds = null
  ) => {
    if (!redisClient.isReady) {
      throw new Error(
        "Redis client is not ready; signup data was not stored"
      );
    }

    const key =
      signupUserKey(userId);

    const serializedRecord =
      JSON.stringify(record);

    if (ttlSeconds) {
      await redisClient.set(
        key,
        serializedRecord,
        {
          EX: ttlSeconds,
        }
      );
    } else {
      await redisClient.set(
        key,
        serializedRecord
      );
    }

    await redisClient.set(
      signupPhoneKey(
        record.phone
      ),
      userId.toString()
    );
  };


const getSignupRecordByPhone =
  async (phone) => {
    if (!redisClient.isReady) {
      throw new Error(
        "Redis client is not ready"
      );
    }

    const userId =
      await redisClient.get(
        signupPhoneKey(phone)
      );

    if (!userId) {
      return null;
    }

    const record =
      await redisClient.get(
        signupUserKey(userId)
      );

    return record
      ? {
          userId,

          record:
            JSON.parse(record),
        }
      : null;
  };


const saveOtpHistory =
  async (
    key,
    record,
    ttlSeconds =
      30 * 24 * 60 * 60
  ) => {
    if (!redisClient.isReady) {
      throw new Error(
        "Redis is not connected; OTP history was not stored"
      );
    }

    await redisClient.set(
      key,
      JSON.stringify(record),
      {
        EX: ttlSeconds,
      }
    );
  };


/*
|--------------------------------------------------------------------------
| User Service
|--------------------------------------------------------------------------
*/

const userService = {

  /*
  |--------------------------------------------------------------------------
  | Health
  |--------------------------------------------------------------------------
  */

  async getHealthStatus() {
    const dbState =
      mongoose.connection.readyState;

    const isDbConnected =
      dbState === 1;

    let isRedisConnected =
      false;

    try {
      const pong =
        await redisClient.ping();

      isRedisConnected =
        pong === "PONG" ||
        pong === true;
    } catch {
      isRedisConnected = false;
    }

    return {
      status: "OK",

      timestamp:
        new Date().toISOString(),

      uptime:
        process.uptime(),

      services: {
        server: "up",

        database:
          isDbConnected
            ? "connected"
            : "disconnected",

        redis:
          isRedisConnected
            ? "connected"
            : "disconnected",
      },
    };
  },


  async getReadinessStatus() {
    const dbState =
      mongoose.connection.readyState;

    const isDbConnected =
      dbState === 1;

    let isRedisConnected =
      false;

    try {
      const pong =
        await redisClient.ping();

      isRedisConnected =
        pong === "PONG" ||
        pong === true;
    } catch {
      isRedisConnected = false;
    }

    const isReady =
      isDbConnected &&
      isRedisConnected;

    return {
      status:
        isReady
          ? "READY"
          : "NOT_READY",

      timestamp:
        new Date().toISOString(),

      services: {
        database:
          isDbConnected
            ? "connected"
            : "disconnected",

        redis:
          isRedisConnected
            ? "connected"
            : "disconnected",
      },
    };
  },


  /*
  |--------------------------------------------------------------------------
  | SIGNUP
  |--------------------------------------------------------------------------
  */

  async signup({
    name,
    email,
    password,
    address,
    countryCode,
    phone,
    dateOfBirth,
    avatar,
  }) {
    const normalizedEmail =
      email.trim().toLowerCase();

    const normalizedPhone =
      phone.trim();

    const existingUser =
      await User.findOne({
        $or: [
          {
            email:
              normalizedEmail,
          },
          {
            phone:
              normalizedPhone,
          },
        ],
      });

    if (existingUser) {
      const error =
        new Error(
          "A user with this email or phone already exists."
        );

      error.status = 409;

      throw error;
    }

    let avatarData = null;
    let user = null;

    try {

      /*
       * Upload avatar first.
       */
      if (avatar) {
        avatarData =
          await uploadAvatarToCloudinary(
            avatar,
            "signup"
          );
      }

      const hashedPassword =
        await bcrypt.hash(
          password,
          10
        );

      user =
        await User.create({
          name:
            name.trim(),

          email:
            normalizedEmail,

          password:
            hashedPassword,

          address:
            address.trim(),

          countryCode:
            countryCode.trim(),

          phone:
            normalizedPhone,

          dateOfBirth,

          avatarUrl:
            avatarData?.url ||
            null,

          avatarPublicId:
            avatarData?.publicId ||
            null,

          isVerified:
            false,
        });

      /*
       * Save signup record.
       */
      try {
        await saveSignupRecord(
          user._id,
          {
            userId:
              user._id.toString(),

            phone:
              user.phone,

            hasOtp:
              false,

            hashOtp:
              null,

            otpExpiresAt:
              null,

            attempts:
              0,

            isVerified:
              false,
          }
        );
      } catch (redisError) {

        await User.findByIdAndDelete(
          user._id
        );

        if (
          avatarData?.publicId
        ) {
          await deleteCloudinaryAvatar(
            avatarData.publicId
          );
        }

        avatarData = null;

        throw redisError;
      }

      await cacheUser(user);

      return {
        message:
          "User sign-up successfully!",

        user:
          toPublicUser(user),
      };

    } catch (error) {

      /*
       * Only cleanup avatar if signup
       * failed before Redis cleanup.
       */
      if (
        avatarData?.publicId
      ) {
        await deleteCloudinaryAvatar(
          avatarData.publicId
        );
      }

      throw error;
    }
  },


  /*
  |--------------------------------------------------------------------------
  | REQUEST OTP
  |--------------------------------------------------------------------------
  */

  async requestOtp(phone) {

    const normalizedPhone =
      phone.trim();

    const cooldownKey =
      `cooldown:${normalizedPhone}`;

    if (!redisClient.isReady) {
      const error =
        new Error(
          "Redis is not connected"
        );

      error.status = 503;

      throw error;
    }

    if (
      await redisClient.get(
        cooldownKey
      )
    ) {
      const error =
        new Error(
          "Please wait before requesting another OTP."
        );

      error.status = 429;

      throw error;
    }

    const signupData =
      await getSignupRecordByPhone(
        normalizedPhone
      );

    if (!signupData) {
      const error =
        new Error(
          "User signup record not found"
        );

      error.status = 404;

      throw error;
    }

    const otp =
      crypto
        .randomInt(
          100000,
          1000000
        )
        .toString();

    const hashOtp =
      crypto
        .createHash("sha256")
        .update(otp)
        .digest("hex");

    const otpRequestId =
      crypto.randomUUID();

    const otpExpiresAt =
      new Date(
        Date.now() +
          5 * 60 * 1000
      ).toISOString();

    await saveSignupRecord(
      signupData.userId,
      {
        ...signupData.record,

        hasOtp: true,

        hashOtp,

        otpRequestId,

        otpExpiresAt,

        attempts: 0,
      }
    );

    await saveOtpHistory(
      otpRequestKey(
        signupData.userId,
        otpRequestId
      ),
      {
        userId:
          signupData.userId,

        phone:
          normalizedPhone,

        hashOtp,

        otpRequestId,

        requestedAt:
          new Date().toISOString(),

        expiresAt:
          otpExpiresAt,

        status:
          "requested",
      }
    );

    await redisClient.set(
      cooldownKey,
      "active",
      {
        EX: 30,
      }
    );

    return {
      message:
        "OTP sent successfully via SMS",

      /*
       * DEV ONLY.
       *
       * Remove this in production.
       */
      otp,
    };
  },


  /*
  |--------------------------------------------------------------------------
  | VERIFY OTP
  |--------------------------------------------------------------------------
  */

  async verifyOtp({
    phone,
    otp,
    req,
  }) {
    const normalizedPhone =
      phone.trim();

    const signupData =
      await getSignupRecordByPhone(
        normalizedPhone
      );

    const otpData =
      signupData?.record;

    if (
      !otpData ||
      !otpData.hasOtp ||
      !otpData.hashOtp
    ) {
      const error =
        new Error(
          "OTP expired or not found. Please request a new OTP."
        );

      error.status = 400;

      throw error;
    }

    const attempts =
      Number(
        otpData.attempts
      ) || 0;

    if (
      attempts >= 5 ||
      Date.now() >
        new Date(
          otpData.otpExpiresAt
        ).getTime()
    ) {
      await saveSignupRecord(
        signupData.userId,
        {
          ...otpData,

          hasOtp: false,

          hashOtp: null,

          otpExpiresAt: null,

          attempts: 0,
        }
      );

      const error =
        new Error(
          "OTP expired or too many attempts. Please request a new OTP."
        );

      error.status = 400;

      throw error;
    }

    const incomingHashOtp =
      crypto
        .createHash("sha256")
        .update(otp)
        .digest("hex");

    if (
      otpData.hashOtp !==
      incomingHashOtp
    ) {

      await saveSignupRecord(
        signupData.userId,
        {
          ...otpData,

          attempts:
            attempts + 1,
        }
      );

      const error =
        new Error(
          `Invalid OTP. ${
            5 -
            (attempts + 1)
          } attempts remaining.`
        );

      error.status = 401;

      throw error;
    }

    const user =
      await User.findOneAndUpdate(
        {
          phone:
            normalizedPhone,
        },
        {
          isVerified:
            true,
        },
        {
          new: true,
        }
      );

    if (!user) {
      const error =
        new Error(
          "User not found"
        );

      error.status = 404;

      throw error;
    }

    await saveSignupRecord(
      signupData.userId,
      {
        ...otpData,

        hasOtp: false,

        otpExpiresAt: null,

        attempts: 0,

        isVerified: true,

        otpVerifiedAt:
          new Date().toISOString(),
      }
    );

    await saveOtpHistory(
      otpLoginKey(
        signupData.userId,
        crypto.randomUUID()
      ),
      {
        userId:
          signupData.userId,

        phone:
          normalizedPhone,

        hashOtp:
          otpData.hashOtp,

        otpRequestId:
          otpData.otpRequestId,

        loggedInAt:
          new Date().toISOString(),

        status:
          "login_success",
      }
    );

    await invalidateUserCache(
      user._id
    );

    const accessToken =
      jwt.sign(
        {
          userId:
            user._id,

          email:
            user.email,
        },

        process.env
          .ACCESS_TOKEN_SECRET,

        {
          expiresIn:
            process.env
              .ACCESS_TOKEN_EXPIRY ||
            "15m",
        }
      );

    const refreshToken =
      jwt.sign(
        {
          userId:
            user._id,
        },

        process.env
          .REFRESH_TOKEN_SECRET,

        {
          expiresIn:
            process.env
              .REFRESH_TOKEN_EXPIRY ||
            "7d",
        }
      );

    if (req?.session) {
      req.session.userId =
        user._id;

      req.session.email =
        user.email;
    }

    await Auth.create({
      userId:
        user._id,

      event:
        "login",

      success:
        true,

      ipAddress:
        req.ip,

      userAgent:
        req.headers[
          "user-agent"
        ],
    });

    return {
      message:
        "OTP Verified, Login successful",

      accessToken,

      refreshToken,

      userId:
        user._id,

      email:
        user.email,

      isVerified:
        true,
    };
  },


  /*
  |--------------------------------------------------------------------------
  | LOGIN
  |--------------------------------------------------------------------------
  */

  async login({
    email,
    password,
    req,
  }) {
    const user =
      await User.findOne({
        email:
          email.trim().toLowerCase(),
      });

    if (!user) {
      const error =
        new Error(
          "Invalid email or password"
        );

      error.status = 401;

      throw error;
    }

    const isPasswordValid =
      await bcrypt.compare(
        password,
        user.password
      );

    if (!isPasswordValid) {
      const error =
        new Error(
          "Invalid email or password"
        );

      error.status = 401;

      throw error;
    }

    if (!user.isVerified) {
      const error =
        new Error(
          "Account not verified. Please request and verify your OTP before logging in."
        );

      error.status = 403;

      throw error;
    }

    const accessToken =
      jwt.sign(
        {
          userId:
            user._id,

          email:
            user.email,
        },

        process.env
          .ACCESS_TOKEN_SECRET,

        {
          expiresIn:
            process.env
              .ACCESS_TOKEN_EXPIRY ||
            "15m",
        }
      );

    const refreshToken =
      jwt.sign(
        {
          userId:
            user._id,
        },

        process.env
          .REFRESH_TOKEN_SECRET,

        {
          expiresIn:
            process.env
              .REFRESH_TOKEN_EXPIRY ||
            "7d",
        }
      );

    if (req?.session) {
      req.session.userId =
        user._id;

      req.session.email =
        user.email;
    }

    const familyId =
      crypto.randomUUID();

    const tokenId =
      crypto.randomUUID();

    const issuedAt =
      new Date();

    const expiresAt =
      new Date(
        Date.now() +
          7 *
            24 *
            60 *
            60 *
            1000
      );

    const sessionDoc =
      await Session.create({
        userId:
          user._id,

        tokenId,

        familyId,

        issuedAt,

        expiresAt,

        userAgent:
          req.headers[
            "user-agent"
          ],
      });

    await Auth.create({
      userId:
        user._id,

      event:
        "login",

      success:
        true,

      ipAddress:
        req.ip,

      userAgent:
        req.headers[
          "user-agent"
        ],
    });

    return {
      message:
        "Login successful",

      accessToken,

      refreshToken,

      sessionId:
        sessionDoc._id,

      userId:
        user._id,

      email:
        user.email,

      isVerified:
        user.isVerified,
    };
  },


  /*
  |--------------------------------------------------------------------------
  | REFRESH ACCESS TOKEN
  |--------------------------------------------------------------------------
  */

  async refreshAccessToken(
    refreshToken
  ) {
    let decoded;

    try {
      decoded =
        jwt.verify(
          refreshToken,

          process.env
            .REFRESH_TOKEN_SECRET
        );
    } catch {
      const error =
        new Error(
          "Invalid or expired refresh token."
        );

      error.status = 403;

      throw error;
    }

    const user =
      await User.findById(
        decoded.userId
      );

    if (!user) {
      const error =
        new Error(
          "User no longer exists."
        );

      error.status = 401;

      throw error;
    }

    const newAccessToken =
      jwt.sign(
        {
          userId:
            user._id,

          email:
            user.email,
        },

        process.env
          .ACCESS_TOKEN_SECRET,

        {
          expiresIn:
            process.env
              .ACCESS_TOKEN_EXPIRY ||
            "15m",
        }
      );

    const newRefreshToken =
      jwt.sign(
        {
          userId:
            user._id,
        },

        process.env
          .REFRESH_TOKEN_SECRET,

        {
          expiresIn:
            process.env
              .REFRESH_TOKEN_EXPIRY ||
            "7d",
        }
      );

    return {
      message:
        "Token refreshed successfully",

      accessToken:
        newAccessToken,

      refreshToken:
        newRefreshToken,
    };
  },


  /*
  |--------------------------------------------------------------------------
  | CURRENT USER
  |--------------------------------------------------------------------------
  */

  async getCurrentUserByToken(
    token
  ) {
    let decoded;

    try {
      decoded =
        jwt.verify(
          token,

          process.env
            .ACCESS_TOKEN_SECRET
        );
    } catch {
      const error =
        new Error(
          "Invalid or expired token."
        );

      error.status = 401;

      throw error;
    }

    const user =
      await User.findById(
        decoded.userId
      ).select("-password");

    if (!user) {
      const error =
        new Error(
          "User profile not found"
        );

      error.status = 404;

      throw error;
    }

    return toPublicUser(
      user
    );
  },


  /*
  |--------------------------------------------------------------------------
  | PUT /users/me
  |--------------------------------------------------------------------------
  */

  async updateUserProfile(
    userId,
    value,
    avatar
  ) {
    const user =
      await User.findById(
        userId
      );

    if (!user) {
      const error =
        new Error(
          "User profile not found."
        );

      error.status = 404;

      throw error;
    }

    const normalizedEmail =
      value.email
        ?.trim()
        .toLowerCase();

    const normalizedPhone =
      value.phone
        ?.trim();

    const duplicateConditions = [];

    if (normalizedEmail) {
      duplicateConditions.push({
        email:
          normalizedEmail,
      });
    }

    if (normalizedPhone) {
      duplicateConditions.push({
        phone:
          normalizedPhone,
      });
    }

    if (
      duplicateConditions.length
    ) {
      const duplicateUser =
        await User.findOne({
          _id: {
            $ne: userId,
          },

          $or:
            duplicateConditions,
        });

      if (duplicateUser) {
        const error =
          new Error(
            "Another user already uses this email or phone."
          );

        error.status = 409;

        throw error;
      }
    }

    const updatePayload = {
      name:
        value.name.trim(),

      email:
        normalizedEmail,

      phone:
        normalizedPhone,

      address:
        value.address.trim(),

      countryCode:
        value.countryCode,

      dateOfBirth:
        value.dateOfBirth,
    };

    let newAvatar = null;

    try {

      if (avatar) {
        newAvatar =
          await uploadAvatarToCloudinary(
            avatar,
            userId
          );

        updatePayload.avatarUrl =
          newAvatar.url;

        updatePayload.avatarPublicId =
          newAvatar.publicId;
      }

      const updatedUser =
        await User.findByIdAndUpdate(
          userId,

          {
            $set:
              updatePayload,
          },

          {
            new: true,

            runValidators:
              true,
          }
        ).select("-password");

      if (!updatedUser) {
        throw Object.assign(
          new Error(
            "User profile not found."
          ),
          {
            status: 404,
          }
        );
      }

      /*
       * Delete old avatar only after
       * MongoDB successfully points
       * to the new avatar.
       */
      if (
        newAvatar &&
        user.avatarPublicId
      ) {
        await deleteCloudinaryAvatar(
          user.avatarPublicId
        );
      }

      await invalidateUserCache(
        userId
      );

      return {
        message:
          "Profile updated successfully.",

        user:
          toPublicUser(
            updatedUser
          ),
      };

    } catch (error) {

      /*
       * If DB update failed,
       * delete only NEW avatar.
       */
      if (
        newAvatar?.publicId
      ) {
        await deleteCloudinaryAvatar(
          newAvatar.publicId
        );
      }

      throw error;
    }
  },


  /*
  |--------------------------------------------------------------------------
  | PATCH /users/me
  |--------------------------------------------------------------------------
  */

  async patchUserProfile(
    userId,
    value,
    avatar
  ) {
    const user =
      await User.findById(
        userId
      );

    if (!user) {
      const error =
        new Error(
          "User profile not found."
        );

      error.status = 404;

      throw error;
    }

    const updatePayload = {};

    if (
      value.name !== undefined
    ) {
      updatePayload.name =
        value.name.trim();
    }

    if (
      value.email !== undefined
    ) {
      updatePayload.email =
        value.email
          .trim()
          .toLowerCase();
    }

    if (
      value.phone !== undefined
    ) {
      updatePayload.phone =
        value.phone.trim();
    }

    if (
      value.address !== undefined
    ) {
      updatePayload.address =
        value.address.trim();
    }

    if (
      value.countryCode !==
      undefined
    ) {
      updatePayload.countryCode =
        value.countryCode;
    }

    if (
      value.dateOfBirth !==
      undefined
    ) {
      updatePayload.dateOfBirth =
        value.dateOfBirth;
    }

    const duplicateConditions = [];

    if (
      updatePayload.email
    ) {
      duplicateConditions.push({
        email:
          updatePayload.email,
      });
    }

    if (
      updatePayload.phone
    ) {
      duplicateConditions.push({
        phone:
          updatePayload.phone,
      });
    }

    if (
      duplicateConditions.length
    ) {
      const duplicateUser =
        await User.findOne({
          _id: {
            $ne: userId,
          },

          $or:
            duplicateConditions,
        });

      if (duplicateUser) {
        const error =
          new Error(
            "Another user already uses this email or phone."
          );

        error.status = 409;

        throw error;
      }
    }

    let newAvatar = null;

    try {

      if (avatar) {
        newAvatar =
          await uploadAvatarToCloudinary(
            avatar,
            userId
          );

        updatePayload.avatarUrl =
          newAvatar.url;

        updatePayload.avatarPublicId =
          newAvatar.publicId;
      }

      /*
       * Nothing supplied.
       */
      if (
        Object.keys(
          updatePayload
        ).length === 0
      ) {
        return {
          message:
            "No profile fields were supplied.",

          user:
            toPublicUser(user),
        };
      }

      const updatedUser =
        await User.findByIdAndUpdate(
          userId,

          {
            $set:
              updatePayload,
          },

          {
            new: true,

            runValidators:
              true,
          }
        ).select("-password");

      if (!updatedUser) {
        throw Object.assign(
          new Error(
            "User profile not found."
          ),
          {
            status: 404,
          }
        );
      }

      /*
       * Delete old avatar after
       * successful MongoDB update.
       */
      if (
        newAvatar &&
        user.avatarPublicId
      ) {
        await deleteCloudinaryAvatar(
          user.avatarPublicId
        );
      }

      await invalidateUserCache(
        userId
      );

      return {
        message:
          "Profile updated successfully.",

        user:
          toPublicUser(
            updatedUser
          ),
      };

    } catch (error) {

      if (
        newAvatar?.publicId
      ) {
        await deleteCloudinaryAvatar(
          newAvatar.publicId
        );
      }

      throw error;
    }
  },


  /*
  |--------------------------------------------------------------------------
  | DELETE USER
  |--------------------------------------------------------------------------
  */

  async deleteUserProfile(
    userId
  ) {
    const deletedUser =
      await User.findByIdAndDelete(
        userId
      );

    if (!deletedUser) {
      const error =
        new Error(
          "User profile not found."
        );

      error.status = 404;

      throw error;
    }

    await invalidateUserCache(
      userId
    );

    if (
      deletedUser.avatarPublicId
    ) {
      await deleteCloudinaryAvatar(
        deletedUser.avatarPublicId
      );
    }

    return {
      message:
        "User profile deleted successfully.",
    };
  },


  async createAvatarPresign(
  userId,
  {
    contentType,
    size,
  }
) {
  return await createAvatarUpload({
    userId,
    contentType,
    size,
  });
},

async confirmAvatar(
  userId,
  uploadId
) {
  const user =
    await User.findById(userId);

  if (!user) {
    const error =
      new Error(
        "User profile not found."
      );

    error.status = 404;

    throw error;
  }

  const avatar =
    await confirmAvatarUpload({
      userId,
      uploadId,
    });

  const oldAvatarPublicId =
    user.avatarPublicId;

  const updatedUser =
    await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          avatarUrl:
            avatar.url,

          avatarPublicId:
            avatar.publicId,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    ).select("-password");

  if (!updatedUser) {
    throw Object.assign(
      new Error(
        "User profile not found."
      ),
      {
        status: 404,
      }
    );
  }

  /*
   * Delete old avatar only after
   * MongoDB successfully points to
   * the newly confirmed avatar.
   */
  if (
    oldAvatarPublicId &&
    oldAvatarPublicId !==
      avatar.publicId
  ) {
    await deleteCloudinaryAvatar(
      oldAvatarPublicId
    );
  }

  await invalidateUserCache(
    userId
  );

  return {
    message:
      "Avatar uploaded and confirmed successfully.",

    user:
      toPublicUser(
        updatedUser
      ),
  };
},

  /*
  |--------------------------------------------------------------------------
  | GET USER BY ID
  |--------------------------------------------------------------------------
  */

  async getUserById(id) {
    const user =
      await User.findById(id)
        .select("-password");

    return user
      ? toPublicUser(user)
      : null;
  },


  /*
  |--------------------------------------------------------------------------
  | LOGOUT
  |--------------------------------------------------------------------------
  */

  async logout(req) {
    let userId = null;

    const refreshToken =
      req.cookies?.refreshToken;

    if (refreshToken) {
      try {
        const decoded =
          jwt.verify(
            refreshToken,

            process.env
              .REFRESH_TOKEN_SECRET
          );

        userId =
          decoded.userId;

        await Session.deleteMany({
          userId:
            decoded.userId,
        });

      } catch {
        console.log(
          "Refresh token invalid/expired during logout"
        );
      }
    }

    if (
      !userId &&
      req.session?.userId
    ) {
      userId =
        req.session.userId;
    }

    if (userId) {
      await Auth.create({
        userId,

        event:
          "logout",

        success:
          true,

        ipAddress:
          req.ip,

        userAgent:
          req.headers[
            "user-agent"
          ],
      });
    }

    return {
      message:
        "Logged out successfully",
    };
  },


  /*
  |--------------------------------------------------------------------------
  | AUTH ACTIVITIES
  |--------------------------------------------------------------------------
  */

  async getAuthActivities(
    id,
    {
      event,
      startDate,
      endDate,
      success,
    }
  ) {
    const matchCriteria = {
      userId:
        new mongoose.Types.ObjectId(
          id
        ),
    };

    if (
      success !== undefined
    ) {
      matchCriteria.success =
        success === "true";
    }

    if (event) {
      matchCriteria.event =
        event;
    }

    if (
      startDate ||
      endDate
    ) {
      matchCriteria.createdAt = {};

      if (startDate) {
        matchCriteria.createdAt.$gte =
          new Date(startDate);
      }

      if (endDate) {
        matchCriteria.createdAt.$lte =
          new Date(endDate);
      }
    }

    const activities =
      await Auth.find(
        matchCriteria
      )
        .sort({
          createdAt: -1,
        })
        .select("-__v");

    return {
      message:
        "Auth activity fetched successfully",

      totalActivities:
        activities.length,

      data:
        activities,
    };
  },
};

export default userService;