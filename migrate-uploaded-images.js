const fs = require("fs");
const path = require("path");

(async () => {
  // This migration uploads existing local images to Cloudinary
  // and replaces /uploads/... paths in MongoDB with Cloudinary URLs.

  const cloudinary = require("cloudinary").v2;

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  const db = require("./database");
  const Post = require("./models/Post");

  let User = null;
  try {
    User = require("./models/User");
  } catch (_) {}

  const uploadsDir = path.join(__dirname, "public", "uploads");

  const uploadToCloudinary = async (filePath, folder) => {
    return await cloudinary.uploader.upload(filePath, {
      folder,
      resource_type: "image",
    });
  };

  const convert = async (Model, fields) => {
    if (!Model) return 0;

    const docs = await Model.find({});
    let count = 0;

    for (const doc of docs) {
      let changed = false;

      for (const field of fields) {
        const value = doc[field];

        if (
          typeof value !== "string" ||
          !value.startsWith("/uploads/")
        ) {
          continue;
        }

        const fileName = path.basename(value);
        const filePath = path.join(uploadsDir, fileName);

        if (!fs.existsSync(filePath)) {
          console.log(`File not found: ${filePath}`);
          continue;
        }

        try {
          const folder = Model === Post
            ? "instagram-clone/posts"
            : "instagram-clone/avatars";

          console.log(`Uploading ${fileName} to Cloudinary...`);

          const result = await uploadToCloudinary(
            filePath,
            folder
          );

          doc[field] = result.secure_url;
          changed = true;

          console.log(`Uploaded: ${result.secure_url}`);
        } catch (error) {
          console.error(
            `Failed to upload ${fileName}:`,
            error.message
          );
        }
      }

      if (changed) {
        await doc.save();
        count++;
      }
    }

    return count;
  };

  const posts = await convert(Post, ["imageUrl"]);

  const users = await convert(
    User,
    ["avatar", "profileImage", "profilePicture"]
  );

  console.log(
    `Migration complete. Posts: ${posts}, users: ${users}.`
  );

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});