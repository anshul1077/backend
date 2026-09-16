import mongoose from "mongoose"

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
    dateofBirth: {
        type: Date,
    },
    status: {
        type: String,
        default: "active",
    },

},
{
    timestamps: true,
});

const User = mongoose.model("User", userSchema);
export default User;