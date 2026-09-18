const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    legacyId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      minlength: 3,
      maxlength: 40,
    },
    email: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    bio: {
      type: String,
      default: "",
      maxlength: 160,
    },
    avatar: {
      type: String,
      default: "/assets/profile.png",
    },
    passwordHash: {
      type: String,
      select: false,
    },
    authProvider: {
      type: String,
      enum: ["local", "facebook"],
      default: "local",
    },
    facebookId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false }
);

module.exports = mongoose.model("User", userSchema);
