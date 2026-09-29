import express from "express";
import Joi from "joi";
import multer from "multer";

import userController from "../controllers/userController.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| MULTER CONFIGURATION
|--------------------------------------------------------------------------
|
| We use memoryStorage() because avatarService.js uploads:
|
|     file.buffer
|
| directly to Cloudinary.
|
*/

const AVATAR_MAX_BYTES = Number.parseInt(
  process.env.AVATAR_MAX_BYTES || "5242880",
  10
);

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: AVATAR_MAX_BYTES,
    files: 1,
  },

  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      const error = new Error(
        "Only JPG, JPEG, PNG and WEBP images are allowed."
      );

      error.status = 400;

      return cb(error);
    }

    cb(null, true);
  },
});

/*
|--------------------------------------------------------------------------
| COMMON VALIDATORS
|--------------------------------------------------------------------------
*/

/*
 * Phone:
 * Example:
 * 9876543210
 */
const phoneSchema = Joi.string()
  .trim()
  .pattern(/^[0-9]+$/)
  .min(7)
  .max(15);

/*
 * Country code:
 * Example:
 * +91
 * +1
 * +44
 */
const countryCodeSchema = Joi.string()
  .trim()
  .pattern(/^\+[0-9]+$/)
  .min(2)
  .max(5);

/*
|--------------------------------------------------------------------------
| SIGNUP VALIDATION
|--------------------------------------------------------------------------
|
| POST /users
|
| Content-Type:
| multipart/form-data
|
| Fields:
| name
| email
| password
| phone
| countryCode
| address
| dateOfBirth
| avatar
|
*/

const signupSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .required(),

  email: Joi.string()
    .trim()
    .email()
    .required(),

  password: Joi.string()
    .min(6)
    .max(128)
    .required(),

  phone: phoneSchema.required(),

  countryCode: countryCodeSchema.required(),

  address: Joi.string()
    .trim()
    .min(3)
    .max(500)
    .required(),

  dateOfBirth: Joi.date()
    .iso()
    .max("now")
    .required(),
}).unknown(false);

/*
|--------------------------------------------------------------------------
| LOGIN VALIDATION
|--------------------------------------------------------------------------
|
| POST /auth/login
|
| Content-Type:
| application/json
|
*/

const loginSchema = Joi.object({
  email: Joi.string()
    .trim()
    .email()
    .required(),

  password: Joi.string()
    .min(6)
    .max(128)
    .required(),
}).unknown(false);

/*
|--------------------------------------------------------------------------
| FULL PROFILE UPDATE VALIDATION
|--------------------------------------------------------------------------
|
| PUT /users/me
|
| All profile fields are required.
| Avatar is optional and handled by multer.
|
*/

const fullUpdateSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .required(),

  email: Joi.string()
    .trim()
    .email()
    .required(),

  phone: phoneSchema.required(),

  address: Joi.string()
    .trim()
    .min(3)
    .max(500)
    .required(),

  countryCode: countryCodeSchema.required(),

  dateOfBirth: Joi.date()
    .iso()
    .max("now")
    .required(),
}).unknown(false);

/*
|--------------------------------------------------------------------------
| PARTIAL PROFILE UPDATE VALIDATION
|--------------------------------------------------------------------------
|
| PATCH /users/me
|
| Every field is optional, but at least one field
| must be supplied.
|
*/

const partialUpdateSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .optional(),

  email: Joi.string()
    .trim()
    .email()
    .optional(),

  phone: phoneSchema.optional(),

  address: Joi.string()
    .trim()
    .min(3)
    .max(500)
    .optional(),

  countryCode: countryCodeSchema.optional(),

  dateOfBirth: Joi.date()
    .iso()
    .max("now")
    .optional(),

  /*
   * Password updates are intentionally not allowed
   * through this profile endpoint.
   */
  password: Joi.any()
    .forbidden()
    .messages({
      "any.unknown":
        "Password updates cannot be processed via this profile route.",

      "any.invalid":
        "Password updates cannot be processed via this profile route.",
    }),
})
  .min(1)
  .unknown(false);

/*
|--------------------------------------------------------------------------
| OTP REQUEST VALIDATION
|--------------------------------------------------------------------------
|
| POST /auth/otp/request
|
*/

const otpRequestSchema = Joi.object({
  phone: phoneSchema.required(),
}).unknown(false);

/*
|--------------------------------------------------------------------------
| OTP VERIFY VALIDATION
|--------------------------------------------------------------------------
|
| POST /auth/otp/verify
|
*/

const otpVerifySchema = Joi.object({
  phone: phoneSchema.required(),

  otp: Joi.string()
    .trim()
    .pattern(/^[0-9]{6}$/)
    .required(),
}).unknown(false);

/*
|--------------------------------------------------------------------------
| VALIDATION MIDDLEWARE
|--------------------------------------------------------------------------
*/

const validateBody = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        message: "Validation error",

        errors: error.details.map(
          (detail) => detail.message
        ),
      });
    }

    req.body = value;

    next();
  };
};

/*
|--------------------------------------------------------------------------
| HEALTH
|--------------------------------------------------------------------------
*/

/*
 * GET /healthz
 */
router.get(
  "/healthz",
  userController.getHealthStatus
);

/*
 * GET /readyz
 *
 * Correct conventional spelling.
 */
router.get(
  "/readyz",
  userController.getReadinessStatus
);

/*
 * Backward compatibility for your old endpoint.
 *
 * GET /readiz
 */
router.get(
  "/readiz",
  userController.getReadinessStatus
);

/*
|--------------------------------------------------------------------------
| SIGNUP
|--------------------------------------------------------------------------
|
| POST /users
|
| multipart/form-data
|
| avatar = image file
|
*/

router.post(
  "/users",

  upload.single("avatar"),

  validateBody(signupSchema),

  userController.signup
);

/*
|--------------------------------------------------------------------------
| OTP REQUEST
|--------------------------------------------------------------------------
|
| POST /auth/otp/request
|
| application/json
|
*/

router.post(
  "/auth/otp/request",

  validateBody(otpRequestSchema),

  userController.requestOTP
);

/*
|--------------------------------------------------------------------------
| OTP VERIFY
|--------------------------------------------------------------------------
|
| POST /auth/otp/verify
|
| application/json
|
*/

router.post(
  "/auth/otp/verify",

  validateBody(otpVerifySchema),

  userController.verifyOTP
);

/*
|--------------------------------------------------------------------------
| LOGIN
|--------------------------------------------------------------------------
|
| POST /auth/login
|
| application/json
|
*/

router.post(
  "/auth/login",

  validateBody(loginSchema),

  userController.login
);

/*
|--------------------------------------------------------------------------
| REFRESH TOKEN
|--------------------------------------------------------------------------
|
| POST /auth/refresh
|
*/

router.post(
  "/auth/refresh",

  userController.refreshToken
);

/*
|--------------------------------------------------------------------------
| CURRENT USER
|--------------------------------------------------------------------------
|
| GET /users/me
|
| Access token required.
|
*/

router.get(
  "/users/me",

  userController.getCurrentUser
);

/*
|--------------------------------------------------------------------------
| FULL PROFILE UPDATE
|--------------------------------------------------------------------------
|
| PUT /users/me
|
| multipart/form-data
|
| Required:
| name
| email
| phone
| address
| countryCode
| dateOfBirth
|
| Optional:
| avatar
|
*/

router.put(
  "/users/me",

  upload.single("avatar"),

  validateBody(fullUpdateSchema),

  userController.updateProfile
);

/*
|--------------------------------------------------------------------------
| PARTIAL PROFILE UPDATE
|--------------------------------------------------------------------------
|
| PATCH /users/me
|
| multipart/form-data
|
| Any profile field can be supplied.
| avatar is optional.
|
*/

router.patch(
  "/users/me",

  upload.single("avatar"),

  validateBody(partialUpdateSchema),

  userController.patchProfile
);

/*
|--------------------------------------------------------------------------
| DELETE CURRENT USER
|--------------------------------------------------------------------------
|
| DELETE /users/me
|
*/

router.delete(
  "/users/me",

  userController.deleteProfile
);

/*
|--------------------------------------------------------------------------
| GET USER BY ID
|--------------------------------------------------------------------------
|
| GET /users/:id
|
*/

router.get(
  "/users/:id",

  userController.getUserById
);

/*
|--------------------------------------------------------------------------
| LOGOUT
|--------------------------------------------------------------------------
|
| POST /auth/logout
|
*/

router.post(
  "/auth/logout",

  userController.logout
);

/*
|--------------------------------------------------------------------------
| AUTH ACTIVITY
|--------------------------------------------------------------------------
|
| GET /users/:id/auth-activity
|
*/

router.post(
  "/users/me/avatar/presign",
  userController.presignAvatar
);

router.post(
  "/users/me/avatar/confirm",
  userController.confirmAvatar
);

router.get(
  "/users/:id/auth-activity",

  userController.getAuthActivity
);

/*
|--------------------------------------------------------------------------
| MULTER / UPLOAD ERROR HANDLER
|--------------------------------------------------------------------------
|
| This must be after the routes.
|
*/

router.use(
  (error, req, res, next) => {
    /*
     * Multer-specific errors
     */
    if (error instanceof multer.MulterError) {
      if (
        error.code === "LIMIT_FILE_SIZE"
      ) {
        return res.status(400).json({
          message: `Avatar image must be ${
            AVATAR_MAX_BYTES / 1024 / 1024
          } MB or smaller.`,
        });
      }

      if (
        error.code === "LIMIT_UNEXPECTED_FILE"
      ) {
        return res.status(400).json({
          message:
            "Only one avatar file is allowed. Use the field name 'avatar'.",
        });
      }

      if (
        error.code === "LIMIT_FILE_COUNT"
      ) {
        return res.status(400).json({
          message:
            "Only one avatar file is allowed.",
        });
      }

      return res.status(400).json({
        message:
          error.message ||
          "Avatar upload failed.",
      });
    }

    /*
     * Custom fileFilter error
     */
    if (
      error?.message?.includes(
        "Only JPG"
      ) ||
      error?.message?.includes(
        "Only JPEG"
      ) ||
      error?.message?.includes(
        "WEBP"
      )
    ) {
      return res.status(400).json({
        message: error.message,
      });
    }

    /*
     * If another middleware already
     * provided a status code.
     */
    if (error?.status) {
      return res.status(error.status).json({
        message: error.message,
      });
    }

    /*
     * Pass unknown errors to the
     * application's global error handler.
     */
    next(error);
  }
);

export default router;