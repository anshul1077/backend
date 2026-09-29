import jwt from "jsonwebtoken";
import userService from "../services/userService.js";

const resolveUserId = (req) => {
  if (req.session && req.session.userId) {
    return req.session.userId;
  }

  const authHeader =
    req.headers.authorization;

  if (
    authHeader &&
    authHeader.startsWith("Bearer ")
  ) {
    const token =
      authHeader.split(" ")[1];

    try {
      const decoded =
        jwt.verify(
          token,
          process.env
            .ACCESS_TOKEN_SECRET
        );

      return decoded.userId;
    } catch {
      const error = new Error(
        "Invalid or expired token."
      );

      error.status = 401;

      throw error;
    }
  }

  return null;
};

const userController = {
  async getHealthStatus(req, res) {
    try {
      const result =
        await userService.getHealthStatus();

      return res
        .status(200)
        .json(result);
    } catch (error) {
      console.error(
        "Health Check Error:",
        error
      );

      return res
        .status(500)
        .json({
          status: "ERROR",
          message:
            error.message,
        });
    }
  },

  async getReadinessStatus(
    req,
    res
  ) {
    try {
      const result =
        await userService.getReadinessStatus();

      if (
        result.status ===
        "NOT_READY"
      ) {
        return res
          .status(503)
          .json(result);
      }

      return res
        .status(200)
        .json(result);
    } catch (error) {
      console.error(
        "Readiness Check Error:",
        error
      );

      return res
        .status(503)
        .json({
          status:
            "NOT_READY",
          message:
            error.message,
        });
    }
  },

  async signup(req, res) {
    try {
      const result =
        await userService.signup({
          ...req.body,
          avatar: req.file,
        });

      return res
        .status(201)
        .json(result);
    } catch (error) {
      console.error(
        "Signup Error:",
        error
      );

      return res
        .status(
          error.status || 500
        )
        .json({
          message:
            error.message ||
            "Server error",
        });
    }
  },

  async requestOTP(
    req,
    res
  ) {
    try {
      const result =
        await userService.requestOtp(
          req.body.phone
        );

      return res
        .status(200)
        .json(result);
    } catch (error) {
      console.error(
        "OTP request error:",
        error
      );

      return res
        .status(
          error.status || 500
        )
        .json({
          message:
            error.message ||
            "Failed to send OTP via SMS",
        });
    }
  },

  async verifyOTP(
    req,
    res
  ) {
    try {
      const result =
        await userService.verifyOtp({
          phone:
            req.body.phone,
          otp:
            req.body.otp,
          req,
        });

      res.cookie(
        "refreshToken",
        result.refreshToken,
        {
          httpOnly: true,
          secure:
            process.env.NODE_ENV ===
            "production",
          sameSite: "strict",
          maxAge:
            7 *
            24 *
            60 *
            60 *
            1000,
        }
      );

      if (req.session) {
        req.session.userId =
          result.userId;

        req.session.email =
          result.email;
      }

      return res
        .status(200)
        .json({
          message:
            result.message,
          accessToken:
            result.accessToken,
          userId:
            result.userId,
          email:
            result.email,
          isVerified:
            result.isVerified,
        });
    } catch (error) {
      console.error(
        "OTP verify error:",
        error
      );

      return res
        .status(
          error.status || 500
        )
        .json({
          message:
            error.message ||
            "Server error",
        });
    }
  },

  async presignAvatar(req, res) {
  try {
    const userId = resolveUserId(req);

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized. Please log in first.",
      });
    }

    const {
      contentType,
      size,
    } = req.body || {};

    const result =
      await userService.createAvatarPresign(
        userId,
        {
          contentType,
          size,
        }
      );

    return res.status(200).json(result);

  } catch (error) {
    console.error(
      "Avatar presign error:",
      error
    );

    return res.status(
      error.status || 500
    ).json({
      message:
        error.message ||
        "Failed to create avatar upload signature.",
    });
  }
},

async confirmAvatar(req, res) {
  try {
    const userId =
      resolveUserId(req);

    if (!userId) {
      return res
        .status(401)
        .json({
          message:
            "Unauthorized. Please log in first.",
        });
    }

    const {
      uploadId,
    } = req.body;

    const result =
      await userService.confirmAvatar(
        userId,
        uploadId
      );

    return res
      .status(200)
      .json(result);
  } catch (error) {
    console.error(
      "Avatar confirmation error:",
      error
    );

    return res
      .status(
        error.status || 500
      )
      .json({
        message:
          error.message ||
          "Failed to confirm avatar.",
      });
  }
},

  async login(req, res) {
    try {
      const result =
        await userService.login({
          email:
            req.body.email,
          password:
            req.body.password,
          req,
        });

      res.cookie(
        "refreshToken",
        result.refreshToken,
        {
          httpOnly: true,
          secure:
            process.env.NODE_ENV ===
            "production",
          sameSite: "strict",
          maxAge:
            7 *
            24 *
            60 *
            60 *
            1000,
        }
      );

      if (req.session) {
        req.session.userId =
          result.userId;

        req.session.email =
          result.email;
      }

      return res
        .status(200)
        .json({
          message:
            result.message,
          accessToken:
            result.accessToken,
          sessionId:
            result.sessionId,
          userId:
            result.userId,
          email:
            result.email,
          isVerified:
            result.isVerified,
        });
    } catch (error) {
      console.error(
        "Login Error:",
        error
      );

      return res
        .status(
          error.status || 500
        )
        .json({
          message:
            error.message ||
            "Server error",
        });
    }
  },

  async refreshToken(
    req,
    res
  ) {
    try {
      const refreshToken =
        req.cookies?.refreshToken;

      if (!refreshToken) {
        return res
          .status(401)
          .json({
            message:
              "Refresh token not found. Please log in again.",
          });
      }

      const result =
        await userService.refreshAccessToken(
          refreshToken
        );

      res.cookie(
        "refreshToken",
        result.refreshToken,
        {
          httpOnly: true,
          secure:
            process.env.NODE_ENV ===
            "production",
          sameSite: "strict",
          maxAge:
            7 *
            24 *
            60 *
            60 *
            1000,
        }
      );

      return res
        .status(200)
        .json({
          message:
            result.message,
          accessToken:
            result.accessToken,
        });
    } catch (error) {
      console.error(
        "Refresh Token Error:",
        error
      );

      return res
        .status(
          error.status || 500
        )
        .json({
          message:
            error.message ||
            "Server error during token refresh",
        });
    }
  },

  async getCurrentUser(
    req,
    res
  ) {
    try {
      const authHeader =
        req.headers.authorization;

      if (
        !authHeader ||
        !authHeader.startsWith(
          "Bearer "
        )
      ) {
        return res
          .status(401)
          .json({
            message:
              "Unauthorized. Please log in with a valid token.",
          });
      }

      const token =
        authHeader.split(" ")[1];

      const user =
        await userService.getCurrentUserByToken(
          token
        );

      return res
        .status(200)
        .json(user);
    } catch (error) {
      console.error(
        "Profile Fetch Error:",
        error
      );

      return res
        .status(
          error.status || 401
        )
        .json({
          message:
            error.message ||
            "Invalid or expired token.",
        });
    }
  },

  async updateProfile(
    req,
    res
  ) {
    try {
      const userId =
        resolveUserId(req);

      if (!userId) {
        return res
          .status(401)
          .json({
            message:
              "Unauthorized. Please log in first.",
          });
      }

      const result =
        await userService.updateUserProfile(
          userId,
          req.body,
          req.file
        );

      return res
        .status(200)
        .json(result);
    } catch (error) {
      console.error(
        "PUT Profile Error:",
        error
      );

      return res
        .status(
          error.status || 500
        )
        .json({
          message:
            error.message ||
            "Server error",
        });
    }
  },

  async patchProfile(
    req,
    res
  ) {
    try {
      const userId =
        resolveUserId(req);

      if (!userId) {
        return res
          .status(401)
          .json({
            message:
              "Unauthorized. Please log in first.",
          });
      }

      const result =
        await userService.patchUserProfile(
          userId,
          req.body,
          req.file
        );

      return res
        .status(200)
        .json(result);
    } catch (error) {
      console.error(
        "PATCH Profile Error:",
        error
      );

      return res
        .status(
          error.status || 500
        )
        .json({
          message:
            error.message ||
            "Server error",
        });
    }
  },

  async deleteProfile(
    req,
    res
  ) {
    try {
      const userId =
        resolveUserId(req);

      if (!userId) {
        return res
          .status(401)
          .json({
            message:
              "Unauthorized. Please log in first.",
          });
      }

      await userService.deleteUserProfile(
        userId
      );

      if (req.session) {
        req.session.destroy(
          (err) => {
            if (err) {
              console.error(
                "Session clean error:",
                err
              );

              return res
                .status(500)
                .json({
                  message:
                    "Account removed, but session clear failed.",
                });
            }

            res.clearCookie(
              "connect.sid"
            );

            res.clearCookie(
              "refreshToken"
            );

            return res
              .status(200)
              .json({
                message:
                  "Your account profile has been completely deleted.",
              });
          }
        );

        return;
      }

      res.clearCookie(
        "refreshToken"
      );

      return res
        .status(200)
        .json({
          message:
            "Your account profile has been completely deleted.",
        });
    } catch (error) {
      console.error(
        "DELETE Profile Error:",
        error
      );

      return res
        .status(
          error.status || 500
        )
        .json({
          message:
            error.message ||
            "Server error",
        });
    }
  },

  async getUserById(
    req,
    res
  ) {
    try {
      const user =
        await userService.getUserById(
          req.params.id
        );

      if (!user) {
        return res
          .status(404)
          .json({
            message:
              "User not found",
          });
      }

      return res
        .status(200)
        .json(user);
    } catch (error) {
      console.error(
        "Get User By ID Error:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Server error",
        });
    }
  },

  async logout(req, res) {
    try {
      const result =
        await userService.logout(req);

      res.clearCookie(
        "refreshToken",
        {
          httpOnly: true,
          secure:
            process.env.NODE_ENV ===
            "production",
          sameSite: "strict",
        }
      );

      if (req.session) {
        req.session.destroy(
          (err) => {
            if (err) {
              console.error(
                "Session destruction error:",
                err
              );
            }

            res.clearCookie(
              "connect.sid"
            );

            return res
              .status(200)
              .json({
                message:
                  result.message,
              });
          }
        );

        return;
      }

      return res
        .status(200)
        .json({
          message:
            result.message,
        });
    } catch (error) {
      console.error(
        "Logout Error:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Server error during logout",
        });
    }
  },

  async getAuthActivity(
    req,
    res
  ) {
    try {
      const {
        id,
      } = req.params;

      const {
        event,
        startDate,
        endDate,
        success,
      } = req.query;

      const result =
        await userService.getAuthActivities(
          id,
          {
            event,
            startDate,
            endDate,
            success,
          }
        );

      return res
        .status(200)
        .json(result);
    } catch (error) {
      console.error(
        "Auth Activity Error:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Server error",
        });
    }
  },
};

export default userController;
