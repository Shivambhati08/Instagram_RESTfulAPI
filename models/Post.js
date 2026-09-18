const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    userId: { type: String, required: true },
    text: { type: String, required: true, maxlength: 500 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    legacyId: { type: String, required: true, unique: true, index: true },
    authorId: { type: String, required: true, index: true },
    imageUrl: { type: String, default: "" },
    caption: { type: String, required: true, maxlength: 220 },
    location: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now, index: true },
    likes: { type: [String], default: [] },
    comments: { type: [commentSchema], default: [] },
  },
  { versionKey: false }
);

postSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Post", postSchema);
