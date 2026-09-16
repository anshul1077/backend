import mongoose from "mongoose";

const authActivities = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId, // References the User model ID
    ref: "User"
  },
  event: {
    type: String // e.g., "login", "logout", "failed_login", "refresh_token"
  },
  success: {
    type: Boolean 
  },
  ipAddress: {
    type: String 
  },
  userAgent: {
    type: String 
  }
}, {
  timestamps: { createdAt: true, updatedAt: false } 
});

const Auth = mongoose.model("auth", authActivities);
export default Auth;
