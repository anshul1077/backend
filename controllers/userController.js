import jwt from "jsonwebtoken";
import userService from "../services/userService.js";

const resolveUserId = (req) => {
  if (req.session && req.session.userId) {
    return req.session.userId;
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      return decoded.userId;
    } catch (error) {
      const err = new Error("Invalid or expired token.");
      err.status = 401;
      throw err;
    }
  }

  return null;
};

const userController = {
  async getHealthStatus(req, res) {
    try {
      const healthStatus = await userService.getHealthStatus();
      return res.status(200).json(healthStatus);
    } catch (error) {
      console.error("Health Check Error:", error);
      return res.status(500).json({
        status: "ERROR",
        message: error.message,
      });
    }
  },

  async getReadinessStatus(req, res) {
    try {
      const readinessStatus = await userService.getReadinessStatus();

      if (readinessStatus.status === "NOT_READY") {
        return res.status(503).json(readinessStatus);
      }

      return res.status(200).json(readinessStatus);
    } catch (error) {
      console.error("Readiness Check Error:", error);
      return res.status(503).json({
        status: "NOT_READY",
        message: error.message,
      });
    }
  },

  async signup(req, res, validatedData) {
    try {
      const response = await userService.signup(validatedData);
      return res.status(201).json(response);
    } catch (error) {
      console.error("Signup Error:", error);
      return res.status(error.status || 500).json({
        message: error.message || "Server error",
        error: error.error || error.message,
      });
    }
  },

  async createSignupAvatarUpload(req, res) {
    try {
      const result = await userService.createSignupAvatarUpload();
      return res.status(200).json(result);
    } catch (error) {
      console.error("Signup avatar upload error:", error);
      return res.status(error.status || 500).json({ message: error.message || "Server error" });
    }
  },

  async requestOTP(req, res, validatedData) {
    try {
      const response = await userService.requestOtp(validatedData.phone);
      return res.status(200).json(response);
    } catch (error) {
      console.error("OTP request error:", error);
      return res.status(error.status || 500).json({
        message: error.message || "Failed to send OTP via SMS",
      });
    }
  },

  async verifyOTP(req, res, validatedData) {
    try {
      const result = await userService.verifyOtp({
        phone: validatedData.phone,
        otp: validatedData.otp,
        req,
      });

      res.cookie("refreshToken", result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      if (req.session) {
        req.session.userId = result.userId;
        req.session.email = result.email;
      }

      return res.status(200).json({
        message: result.message,
        accessToken: result.accessToken,
        userId: result.userId,
        email: result.email,
        isVerified: result.isVerified,
      });
    } catch (error) {
      console.error("OTP verify error:", error);
      return res.status(error.status || 500).json({
        message: error.message || "Server error",
      });
    }
  },

  async login(req, res, validatedData) {
    try {
      const result = await userService.login({
        email: validatedData.email,
        password: validatedData.password,
        req,
      });

      res.cookie("refreshToken", result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      if (req.session) {
        req.session.userId = result.userId;
        req.session.email = result.email;
      }

      return res.status(200).json({
        message: result.message,
        accessToken: result.accessToken,
        sessionId: result.sessionId,
        userId: result.userId,
        email: result.email,
        isVerified: result.isVerified,
      });
    } catch (error) {
      console.error("Login Error:", error);
      return res.status(error.status || 500).json({
        message: error.message || "Server error",
      });
    }
  },

  async refreshToken(req, res) {
    try {
      const refreshToken = req.cookies.refreshToken;
      if (!refreshToken) {
        return res.status(401).json({ message: "Refresh token not found. Please log in again." });
      }

      const result = await userService.refreshAccessToken(refreshToken);

      res.cookie("refreshToken", result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return res.status(200).json({
        message: result.message,
        accessToken: result.accessToken,
      });
    } catch (error) {
      console.error("Refresh Token Error:", error);
      return res.status(error.status || 500).json({
        message: error.message || "Server error during token refresh",
      });
    }
  },

  async getCurrentUser(req, res) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized. Please log in with a valid token." });
      }

      const token = authHeader.split(" ")[1];
      const user = await userService.getCurrentUserByToken(token);
      return res.status(200).json(user);
    } catch (error) {
      console.error("Profile Fetch Error:", error);
      return res.status(error.status || 401).json({
        message: error.message || "Invalid or expired token.",
      });
    }
  },

  async updateProfile(req, res, validatedData) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized. Please log in first." });
      }

      const result = await userService.updateUserProfile(userId, validatedData);
      return res.status(200).json(result);
    } catch (error) {
      console.error("PUT Profile Error:", error);
      return res.status(error.status || 500).json({
        message: error.message || "Server error",
      });
    }
  },

  async patchProfile(req, res, validatedData) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized. Please log in first." });
      }

      const result = await userService.patchUserProfile(userId, validatedData);
      return res.status(200).json(result);
    } catch (error) {
      console.error("PATCH Profile Error:", error);
      return res.status(error.status || 500).json({
        message: error.message || "Server error",
      });
    }
  },

  async createAvatarUpload(req, res) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized. Please log in first." });
      }

      return res.status(200).json(await userService.createAvatarUpload(userId));
    } catch (error) {
      console.error("Avatar upload contract error:", error);
      return res.status(error.status || 500).json({ message: error.message || "Server error" });
    }
  },

  async confirmAvatarUpload(req, res) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized. Please log in first." });
      }

      if (!req.body.uploadId) {
        return res.status(400).json({ message: "uploadId is required" });
      }

      return res.status(200).json(
        await userService.confirmAvatarUpload(userId, req.body.uploadId)
      );
    } catch (error) {
      console.error("Avatar confirmation error:", error);
      return res.status(error.status || 500).json({ message: error.message || "Server error" });
    }
  },

  async deleteProfile(req, res) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized. Please log in first." });
      }

      await userService.deleteUserProfile(userId);

      if (req.session) {
        req.session.destroy((err) => {//
          if (err) {
            console.error("Session clean error upon user deletion:", err);
            return res.status(500).json({ message: "Account removed, but session clear failed." });
          }
          res.clearCookie("connect.sid");
          res.clearCookie("refreshToken");
          return res.status(200).json({ message: "Your account profile has been completely deleted." });
        });
        return;
      }

      res.clearCookie("refreshToken");
      return res.status(200).json({ message: "Your account profile has been completely deleted." });
    } catch (error) {
      console.error("DELETE Profile Error:", error);
      return res.status(error.status || 500).json({
        message: error.message || "Server error",
      });
    }
  },

  async getUserById(req, res) {
    try {
      const user = await userService.getUserById(req.params.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      return res.status(200).json(user);
    } catch (error) {
      console.error("Get User By ID Error:", error);
      return res.status(500).json({ message: "Server error" });
    }
  },

  async logout(req, res) {
    try {
      const result = await userService.logout(req);

      res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
      });

      if (req.session) {
        req.session.destroy((err) => {
          if (err) {
            console.error("Session destruction error:", err);
          }

          res.clearCookie("connect.sid");
          return res.status(200).json({ message: result.message });
        });
      } else {
        return res.status(200).json({ message: result.message });
      }
    } catch (error) {
      console.error("Logout Error:", error);
      return res.status(500).json({ message: "Server error during logout" });
    }
  },

  async getAuthActivity(req, res) {
    try {
      const { id } = req.params;
      const { event, startDate, endDate, success } = req.query;

      const result = await userService.getAuthActivities(id, { event, startDate, endDate, success });
      return res.status(200).json(result);
    } catch (error) {
      console.error("Auth Activity Error:", error);
      return res.status(500).json({ message: "Server error" });
    }
  },
};

export default userController;
