require("dotenv").config();

const mongoose = require("mongoose");
const { connectDatabase } = require("./database");
const { readDb } = require("./dataStore");
const User = require("./models/User");
const Post = require("./models/Post");

const demoPosts = [
  ["demo-post-01", "A quiet morning, a good playlist, and a new idea.", "/assets/post1.jpeg", "City lights"],
  ["demo-post-02", "Weekend reset with a little sunshine.", "/assets/post2.jpeg", "Weekend escape"],
  ["demo-post-03", "Small details make the biggest stories.", "/assets/post3.jpg", "Everyday moments"],
  ["demo-post-04", "Building, learning, and sharing the process.", "/assets/post4.jpg", "Studio notes"],
  ["demo-post-05", "Travel light. Come home full of stories.", "/assets/post5.jpeg", "On the road"],
  ["demo-post-06", "A little color for the middle of the week.", "/assets/pic1.jpeg", "Afternoon"],
  ["demo-post-07", "The best views are usually worth the walk.", "/assets/pic2.jpeg", "Outside"],
  ["demo-post-08", "Making room for curiosity.", "/assets/pic3.jpeg", "New perspective"],
  ["demo-post-09", "Good energy, better company.", "/assets/pic4.jpeg", "Good days"],
  ["demo-post-10", "A reminder to slow down and look around.", "/assets/pic5.jpeg", "Take it in"],
  ["demo-post-11", "Notes from a day well spent.", "/assets/pic6.jpeg", "Day notes"],
  ["demo-post-12", "The next version starts with one small step.", "/assets/pic7.jpeg", "Forward"],
];

async function seedPosts() {
  const db = readDb();
  await connectDatabase();

  const users = await User.find({}, { legacyId: 1 }).sort({ createdAt: 1 }).lean();
  if (!users.length) throw new Error("No MongoDB users found. Run npm run migrate:users first.");

  const validUserIds = new Set(users.map((user) => user.legacyId));
  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const post of db.posts || []) {
    if (!validUserIds.has(post.authorId)) {
      skipped += 1;
      console.log(`Skipped orphan JSON post: ${post.id}`);
      continue;
    }
    const result = await Post.updateOne(
      { legacyId: post.id },
      {
        $setOnInsert: {
          legacyId: post.id,
          authorId: post.authorId,
          imageUrl: post.imageUrl || "",
          caption: post.caption || "",
          createdAt: post.createdAt || new Date(),
          likes: Array.isArray(post.likes) ? post.likes : [],
          comments: Array.isArray(post.comments) ? post.comments : [],
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount) inserted += 1;
    else skipped += 1;
  }

  for (let index = 0; index < demoPosts.length; index += 1) {
    const [legacyId, caption, imageUrl, location] = demoPosts[index];
    const authorId = users[index % users.length].legacyId;
    try {
      const result = await Post.updateOne(
        { legacyId },
        {
          $setOnInsert: {
            legacyId,
            authorId,
            imageUrl,
            caption,
            location,
            createdAt: new Date(Date.now() - index * 45 * 60 * 1000),
            likes: [],
            comments: [],
          },
        },
        { upsert: true }
      );
      if (result.upsertedCount) inserted += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      console.error(`Failed demo post ${legacyId}: ${error.message}`);
    }
  }

  console.log(`Post seed complete: ${JSON.stringify({ inserted, skipped, failed })}`);
  process.exitCode = failed ? 1 : 0;
}

seedPosts().catch((error) => {
  console.error(`Post seed aborted: ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect();
});
