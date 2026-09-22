import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId, // Fixed: Better practice to reference the User model ID directly
        ref: "User",
        required: true
    },
    tokenId: {
        type: String,
        unique: true,
        required: true
    },
    familyId: { 
        type: String,
        required: true
    },
    issuedAt: {
        type: Date,
        default: Date.now 
    },
    expiresAt: {
        type: Date,
        required: true
    },
    revokedAt: {
        type: Date,
        default: null // Stays null unless the session is manually terminated or logged out
    },
    userAgent: {
        type: String 
    }
}, {
    timestamps: true 
});

const Session = mongoose.model("Session", sessionSchema);
export default Session;
