import express from "express";
import User from "../models/user.js";
import multer from "multer";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import redisClient from "../config/redis.js";


const router = express.Router();
const upload = multer({ 
    dest: "uploads/" 
});


router.post("/users", upload.single("image"), async (req, res) => {
  try {
    const { name, email, password, address, phone } = req.body;
    
    if (!name || !email || !password || !address || !phone ) {
      
      return res.status(400).json({ 
        message: "All fields are required" 
    });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    let imagePath = null;
    if (req.file) {
      imagePath = req.file.path;
    }

    const hashedPassword = await bcrypt.hash(password, 10);


    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      address,
      phone,
      avtarKey: imagePath,
    });
    console.log("register successfully");
    return res.status(201).json({
      message: "User sign-up successfully!",
      user: {
        name: user.name,
        email: user.email,
        address: user.address,
        phone: user.phone,
        avtarKey: user.avtarKey,
        
      }
      ,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ 
      message: "Server error" 
    });
  }
});

router.get("/users/me", async (req, res) => {
  try {
    // 1. Check if the user has an active session
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ 
        message: "Unauthorized. Please log in first." 
      });
    }

    // Find the user in the database using the session ID
    // .select("-password") ensures we don't leak the hashed password to the frontend
    const user = await User.findById(req.session.userId);

    if (!user) {
      return res.status(404).json({ 
        message: "User profile not found" 
      });
    }

    // Return the user profile data
    return res.status(200).json(user);

  } catch (error) {
    console.error("Profile Fetch Error:", error);
    return res.status(500).json({ 
      message: "Server error" 
    });
  }
});

router.get("/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ 
        message: "User not found" 
      });
    }
    return res.status(200).json(user);
  } catch (error) {
    return res.status(500).json({ 
      message: "Server error" 
    });
  }
});

router.put("/users/me", async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ message: "Unauthorized. Please log in first." });
    }

    const { name, email, address, phone } = req.body;

    // Validate that all required core fields are present for a full update
    if (!name || !email || !address || !phone) {
      return res.status(400).json({ message: "All fields (name, email, address, phone) are required for a full update." });
    }

    // Update the record
    const updatedUser = await User.findByIdAndUpdate(
      req.session.userId,
      { name, email, address, phone },
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ message: "User profile not found" });
    }

    return res.status(200).json({
      message: "Profile updated completely successfully",
      user: updatedUser
    });

  } catch (error) {
    console.error("PUT Profile Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.patch("/users/me", async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ message: "Unauthorized. Please log in first." });
    }

    // Prevent password modification through this standard profile editing block
    if (req.body.password) {
      return res.status(400).json({ message: "Password updates cannot be processed via this profile route." });
    }

    // Dynamically update only the fields present in the request body payload
    const updatedUser = await User.findByIdAndUpdate(
      req.session.userId,
      { $set: req.body }, 
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ message: "User profile not found" });
    }

    return res.status(200).json({
      message: "Profile updated partially successfully",
      user: updatedUser
    });

  } catch (error) {
    console.error("PATCH Profile Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.delete("/users/me", async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ message: "Unauthorized. Please log in first." });
    }

    // 1. Permanently remove user from the database
    const deletedUser = await User.findByIdAndDelete(req.session.userId);

    if (!deletedUser) {
      return res.status(404).json({ message: "User profile not found" });
    }

    // 2. Clear out server-side session allocations and wipe cookies cleanly
    req.session.destroy((err) => {
      if (err) {
        console.error("Session clean error upon user deletion:", err);
        return res.status(500).json({ message: "Account removed, but session clear failed." });
      }
      res.clearCookie('connect.sid');
      res.clearCookie('refreshToken');
      return res.status(200).json({ message: "Your account profile has been completely deleted." });
    });

  } catch (error) {
    console.error("DELETE Profile Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/auth/otp/request", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        message: "Phone number is required",
      });
    }

    // Generate secure 6-digit OTP
    const otp = crypto
      .randomInt(100000, 1000000)
      .toString();

    // Redis key
    const otpKey = `otp:${phone}`;

    // Store OTP in Redis
    // EX = expiration time in seconds
    await redisClient.set(otpKey, otp, {
      EX: 300, // 5 minutes
    });

    console.log(`OTP for ${phone}: ${otp}`);

    // TODO:
    // Send OTP through SMS provider here
    //
    // await sendOtpSMS(phone, otp);

    return res.status(200).json({
      message: "OTP sent successfully",
    });

  } catch (error) {
    console.error("OTP request error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
});

router.post("/auth/otp/verify", async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        message: "Phone number and OTP are required",
      });
    }

    // Redis key
    const otpKey = `otp:${phone}`;

    // Get OTP from Redis
    const storedOtp = await redisClient.get(otpKey);

    // OTP doesn't exist
    if (!storedOtp) {
      return res.status(400).json({
        message: "OTP expired or not found",
      });
    }

    // Compare OTP
    if (storedOtp !== otp) {
      return res.status(401).json({
        message: "Invalid OTP",
      });
    }

    // OTP is correct
    // Delete it immediately so it cannot be reused
    await redisClient.del(otpKey);

    // Find user
    const user = await User.findOne({ phone });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // Generate access token
    const accessToken = jwt.sign(
      {
        userId: user._id,
        email: user.email,
      },
      process.env.ACCESS_TOKEN_SECRET,
      {
        expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
      }
    );

    // Generate refresh token
    const refreshToken = jwt.sign(
      {
        userId: user._id,
      },
      process.env.REFRESH_TOKEN_SECRET,
      {
        expiresIn: process.env.REFRESH_TOKEN_EXPIRY,
      }
    );

    // Store refresh token in HttpOnly cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,

      secure: process.env.NODE_ENV === "production",

      sameSite: "strict",

      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Create session
    req.session.userId = user._id;
    req.session.email = user.email;

    return res.status(200).json({
      message: "OTP verified successfully",

      accessToken,

      userId: user._id,

      email: user.email,
    });

  } catch (error) {
    console.error("OTP verification error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
});


router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log("email", email);
    
    if (!email || !password) {
      return res.status(400).json({ 
        message: "Email and password are required" 
      });
    }

    
    const user = await User.findOne({ email });

    
    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({ 
        message: "Invalid email or password" 
      });
    }

    // ------------------------------------------------------

    return res.status(200).json({ 
        message: "Login successful",
        accessToken,
        userId: user._id,
        email: user.email
        
    });
    
  } catch (error) {
    console.error(error);
    return res.status(500).json({ 
        message: "Server error" 
    });
  }
});

router.post("/auth/refresh", async (req, res) => {
  try {
    // 1. Get the refresh token from cookies
    // Note: If using Express cookies, you might need 'cookie-parser' middleware installed
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ message: "Refresh token missing" });
    }

    // 2. Verify the refresh token
    jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, async (err, decoded) => {
      if (err) {
        return res.status(403).json({ message: "Invalid or expired refresh token" });
      }

      // 3. Find user from decoded payload
      const user = await User.findById(decoded.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // 4. Issue a new short-lived Access Token
      const newAccessToken = jwt.sign(
        { userId: user._id, email: user.email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: process.env.ACCESS_TOKEN_EXPIRY }
      );

      return res.status(200).json({ accessToken: newAccessToken });
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/auth/logout", (req, res) => {
  // Destroys session data in MongoDB and clears the browser cookie
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "Could not log out" });
    }
    res.clearCookie('connect.sid'); // Clears default express-session cookie name
    return res.status(200).json({ message: "Logged out successfully" });
  });
});









export default router;
