import mongoose from "mongoose"
import { type } from "os";

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        
    },
    email: {
        type: String,
        unique: true,
        required: true,
        lowercase: true,
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
        unique: true,
    },
    avtarKey: {
        type: String,
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