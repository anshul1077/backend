import mongoose from "mongoose"
import { type } from "os";

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        
    },
    email: {
        type: String,
        unique: true
    },
    password: {
        type: String,
        
    },
    address: {
        type: String,
       
    },
    phone: {
        type: String,
       
    },
    avtarKey: {
        type: String,
       
    },
    countryCode: {
        type: String,
    },
    dateOfBirth: {
        type: Date,
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