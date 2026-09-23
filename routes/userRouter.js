import express from "express";
import mongoose from "mongoose";
import Joi from "joi";
import userController from "../controllers/userController.js";

const router = express.Router();

const signupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(50).required(),
  email: Joi.string().trim().email().required(),
  password: Joi.string().min(6).required(),
  phone: Joi.string().trim().pattern(/^[0-9]+$/).min(7).max(15).required(),
  countryCode: Joi.string().trim().pattern(/^\+[0-9]+$/).min(2).max(5).required(),
  address: Joi.string().trim().required(),
  dateOfBirth: Joi.date().iso().max("now").required(),
  image: Joi.string().optional(),
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
  countryCode: Joi.string().trim().pattern(/^\+[0-9]+$/).min(2).max(5).optional(),
  image: Joi.string().allow("").optional(),
  dateOfBirth: Joi.date().iso().max("now").required(),
});

const partialUpdateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(50).optional(),
  email: Joi.string().trim().email().optional(),
  phone: Joi.string().trim().pattern(/^[0-9]+$/).min(7).max(15).optional(),
  address: Joi.string().trim().optional(),
  countryCode: Joi.string().trim().pattern(/^\+[0-9]+$/).min(2).max(5).optional(),
  image: Joi.string().allow("").optional(),
  dateOfBirth: Joi.date().iso().max("now").optional(),
  password: Joi.any().forbidden().messages({
    "any.unknown": "Password updates cannot be processed via this profile route.",
  }),
});

const otpRequestSchema = Joi.object({
  phone: Joi.string().trim().pattern(/^[0-9]+$/).min(7).max(15).required(),
});

const otpVerifySchema = Joi.object({
  phone: Joi.string().trim().pattern(/^[0-9]+$/).min(7).max(15).required(),
  otp: Joi.string().trim().length(6).required(),
  isVerified: Joi.boolean(),
});

router.get("/healthz", userController.getHealthStatus);
router.get("/readiz", userController.getReadinessStatus);

router.post("/users", async (req, res) => {
  const { error, value } = signupSchema.validate(req.body, { abortEarly: false });

  if (error) {
    return res.status(400).json({
      message: "Validation error",
      errors: error.details.map((detail) => detail.message),
    });
  }

  return userController.signup(req, res, value);
});

router.post("/auth/otp/request", async (req, res) => {
  const { error, value } = otpRequestSchema.validate(req.body, { abortEarly: false });

  if (error) {
    return res.status(400).json({
      message: "Validation error",
      errors: error.details.map((detail) => detail.message),
    });
  }

  return userController.requestOTP(req, res, value);
});

router.post("/auth/otp/verify", async (req, res) => {
  const { error, value } = otpVerifySchema.validate(req.body, { abortEarly: false });

  if (error) {
    return res.status(400).json({
      message: "Validation error",
      errors: error.details.map((detail) => detail.message),
    });
  }

  return userController.verifyOTP(req, res, value);
});

router.post("/auth/login", async (req, res) => {
  const { error, value } = loginSchema.validate(req.body, { abortEarly: false });

  if (error) {
    return res.status(400).json({
      message: "Validation error",
      errors: error.details.map((detail) => detail.message),
    });
  }

  return userController.login(req, res, value);
});

router.post("/auth/refresh", userController.refreshToken);

router.get("/users/me", userController.getCurrentUser);

router.put("/users/me", async (req, res) => {
  console.log("Received request to update user profile with data:", req.body);
  const { error, value } = fullUpdateSchema.validate(req.body, { abortEarly: false });

  if (error) {
    return res.status(400).json({
      message: "Validation error",
      errors: error.details.map((detail) => detail.message),
    });
  }

  return userController.updateProfile(req, res, value);
});

router.patch("/users/me", async (req, res) => {
  const { error, value } = partialUpdateSchema.validate(req.body, { abortEarly: false });

  if (error) {
    return res.status(400).json({
      message: "Validation error",
      errors: error.details.map((detail) => detail.message),
    });
  }

  return userController.patchProfile(req, res, value);
});

router.delete("/users/me", userController.deleteProfile);

router.get("/users/:id", userController.getUserById);

router.post("/auth/logout", userController.logout);

router.get("/users/:id/auth-activity", userController.getAuthActivity);

export default router;