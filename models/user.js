import mongoose from "mongoose"
import { type } from "os";

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        
    },
    email: {
        type: String,
        required: true,
    },
    password: {
        type: String,
        required: true,
        
    },
    address: {
        type: String,
        required: true,
       
    },
    phone: {
        type: String,
        required: true,
    },
    // avtarKey: {
    //     type: String,
    // },

    // Cloudinary public_id
    avatarPublicId: {
      type: String,
      default: null,
    },

    avatarFormat: {
      type: String,
      enum: [
        "jpg",
        "jpeg",
        "png",
        "webp",
        null,
      ],
      default: null,
    },

    /*
     * Actual file size reported by Cloudinary.
     */
    avatarBytes: {
      type: Number,
      default: null,
    },

    avatarUploadedAt: {
      type: Date,
      default: null,
    },

    countryCode: {
        type: String,
        required: true
    },
    dateOfBirth: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        default: "active",
    },
    isVerified: {
        type: Boolean,
        default: false
    }

},
{
    timestamps: true,
});

const User = mongoose.model("User", userSchema);
export default User;