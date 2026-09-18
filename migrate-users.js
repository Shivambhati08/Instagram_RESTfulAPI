require("dotenv").config();

const mongoose = require("mongoose");
const { connectDatabase } = require("./database");
const { readDb } = require("./dataStore");
const User = require("./models/User");

function toUserDocument(user) {
  return {
    legacyId: user.id,
    username: user.username,
    email: user.email || null,
    name: user.name || user.username,
    bio: user.bio || "",
    avatar: user.avatar || "/assets/profile.png",
    passwordHash: user.passwordHash,
    authProvider: user.authProvider || (user.facebookId ? "facebook" : "local"),
    facebookId: user.facebookId,
    createdAt: user.createdAt || new Date(),
  };
}

async function migrateUsers() {
  const db = readDb();
  const users = Array.isArray(db.users) ? db.users : [];
  const report = { inserted: 0, skipped: 0, failed: 0 };

  await connectDatabase();

  for (const sourceUser of users) {
    try {
      if (!sourceUser.id || !sourceUser.username) {
        report.failed += 1;
        console.error("Skipped invalid user: missing id or username.");
        continue;
      }

      const existing = await User.findOne({
        $or: [
          { legacyId: sourceUser.id },
          { username: sourceUser.username },
          ...(sourceUser.email ? [{ email: sourceUser.email.toLowerCase() }] : []),
        ],
      }).lean();

      if (existing) {
        report.skipped += 1;
        console.log(`Skipped existing user: ${sourceUser.username}`);
        continue;
      }

      await User.create(toUserDocument(sourceUser));
      report.inserted += 1;
      console.log(`Migrated user: ${sourceUser.username}`);
    } catch (error) {
      report.failed += 1;
      console.error(`Failed user ${sourceUser.username || "unknown"}: ${error.message}`);
    }
  }

  console.log(`User migration complete: ${JSON.stringify(report)}`);
  process.exitCode = report.failed ? 1 : 0;
}

migrateUsers().catch((error) => {
  console.error(`User migration aborted: ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect();
});
