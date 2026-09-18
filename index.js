const express = require("express");
const path = require("path");
require("dotenv").config();
const bcrypt = require("bcryptjs");
const session = require("express-session");
const multer = require("multer");
const methodOverride = require("method-override");
const passport = require("passport");
const FacebookStrategy = require("passport-facebook").Strategy;
const { connectDatabase } = require("./database");
const User = require("./models/User");
const Post = require("./models/Post");
const { v4: uuidv4 } = require("uuid");
const { readDb, writeDb, seedDemoData } = require("./dataStore");
const cloudinary = require("cloudinary").v2;


const app = express();
const port = Number(process.env.PORT) || 8080;
const facebookConfigured = Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);

// Render terminates HTTPS at its proxy/load balancer. Trust the proxy so
// express-session can correctly set Secure cookies in production.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride("_method"));

const sessionSecret = process.env.SESSION_SECRET;

if (process.env.NODE_ENV === "production" && !sessionSecret) {
  throw new Error("SESSION_SECRET is required in production. Add it in Render Environment Variables.");
}

app.use(
  session({
    secret: sessionSecret || "instagram-demo-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production" && process.env.RENDER === "true",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);
app.use(passport.initialize());

async function createFacebookUsername(displayName) {
  const base = String(displayName || "facebook_user")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24) || "facebook_user";
  let username = base;
  let suffix = 1;
  while (await User.exists({ username })) {
    username = `${base}_${suffix++}`;
  }
  return username;
}

if (facebookConfigured) {
  passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL: process.env.FACEBOOK_CALLBACK_URL || `http://localhost:${port}/auth/facebook/callback`,
    profileFields: ["id", "displayName", "name", "emails", "photos"],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.trim().toLowerCase() || null;
      const existingFacebookUser = await User.findOne({ facebookId: profile.id });
      if (existingFacebookUser) return done(null, existingFacebookUser);

      const existingEmailUser = email && await User.findOne({ email });
      if (existingEmailUser) {
        return done(null, false, {
          message: "An account already uses this email. Log in with your password before linking Facebook.",
        });
      }

      const displayName = profile.displayName || [profile.name?.givenName, profile.name?.familyName]
        .filter(Boolean)
        .join(" ") || "Facebook user";
      const newUser = {
        legacyId: uuidv4(),
        username: await createFacebookUsername(displayName),
        name: displayName.slice(0, 80),
        email,
        facebookId: profile.id,
        authProvider: "facebook",
        avatar: profile.photos?.[0]?.value || "/assets/profile.png",
        bio: "",
        createdAt: new Date().toISOString(),
      };
      return done(null, await User.create(newUser));
    } catch (error) {
      return done(error);
    }
  }));
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed."));
    }
    cb(null, true);
  },
});

seedDemoData();

function getDb() {
  const db = readDb();
  if (!Array.isArray(db.notifications)) db.notifications = [];
  return db;
}

function saveDb(data) {
  writeDb(data);
}

function getCurrentUser(req) {
  return req.currentUser || null;
}

async function requireAuth(req, res, next) {
  if (!req.session.userId) {
    req.session.destroy(() => {});
    return res.redirect("/login");
  }

  try {
    const user = await User.findOne({ legacyId: req.session.userId }).lean();
    if (!user) {
      req.session.destroy(() => {});
      return res.redirect("/login");
    }
    req.currentUser = normalizeUser(user);
    return next();
  } catch (error) {
    return next(error);
  }
}

function normalizeUser(user) {
  if (!user) return null;
  const plainUser = typeof user.toObject === "function" ? user.toObject() : { ...user };
  const { passwordHash, _id, ...safeUser } = plainUser;
  return {
    ...safeUser,
    id: safeUser.legacyId || safeUser.id,
    name: safeUser.name || safeUser.username,
  };
}

const sanitizeUser = normalizeUser;

async function findUserByLegacyId(legacyId) {
  if (!legacyId) return null;
  return User.findOne({ legacyId }).lean();
}

async function findUsersByLegacyIds(legacyIds) {
  const ids = [...new Set(legacyIds.filter(Boolean))];
  if (!ids.length) return [];
  return User.find({ legacyId: { $in: ids } }).lean();
}

async function buildPostView(post, currentUserId) {
  const author = await findUserByLegacyId(post.authorId);
  const likes = Array.isArray(post.likes) ? post.likes : [];
  const comments = Array.isArray(post.comments) ? post.comments : [];
  const safeAuthor = author
    ? sanitizeUser(author)
    : { id: post.authorId, username: "Deleted user", avatar: "/assets/profile.png" };

  return {
    ...post,
    id: post.legacyId,
    createdAt: new Date(post.createdAt).toISOString(),
    author: safeAuthor,
    location: post.location || "",
    likesCount: likes.length,
    liked: currentUserId ? likes.includes(currentUserId) : false,
    isOwner: currentUserId === post.authorId,
    formattedTimestamp: formatTimestamp(post.createdAt),
    comments: await Promise.all(comments.map(async (comment) => {
      const commenter = await findUserByLegacyId(comment.userId);
      return {
        ...comment,
        commenter: commenter ? sanitizeUser(commenter) : null,
        canDelete: Boolean(
          currentUserId && (comment.userId === currentUserId || post.authorId === currentUserId)
        ),
        formattedTimestamp: formatTimestamp(comment.createdAt),
      };
    })),
  };
}

function formatTimestamp(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Just now";

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;

  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(timestamp);
}

async function getFeedPosts(currentUserId) {
  const db = getDb();
  const followingIds = db.follows
    .filter((follow) => follow.followerId === currentUserId)
    .map((follow) => follow.followingId);
  const feedAuthorIds = new Set([currentUserId, ...followingIds]);

  const posts = await Post.find({ authorId: { $in: [...feedAuthorIds] } })
    .sort({ createdAt: -1 })
    .lean();
  const postViews = posts.map((post) => buildPostView(post, currentUserId));
  return Promise.all(postViews);
}

async function getSuggestions(currentUserId) {
  const db = getDb();
  const followingIds = db.follows
    .filter((follow) => follow.followerId === currentUserId)
    .map((follow) => follow.followingId);

  const users = await User.find({ legacyId: { $ne: currentUserId } }).sort({ createdAt: -1 }).limit(20).lean();
  return users.filter((user) => !followingIds.includes(user.legacyId)).slice(0, 5).map(sanitizeUser);
}

async function getProfileStats(userId) {
  const db = getDb();
  const followerIds = db.follows
    .filter((follow) => follow.followingId === userId)
    .map((follow) => follow.followerId);
  const followingIds = db.follows
    .filter((follow) => follow.followerId === userId)
    .map((follow) => follow.followingId);
  const validUsers = await findUsersByLegacyIds([...followerIds, ...followingIds]);
  const validIds = new Set(validUsers.map((user) => user.legacyId));
  const followers = followerIds.filter((id) => validIds.has(id)).length;
  const following = followingIds.filter((id) => validIds.has(id)).length;
  const postCount = await Post.countDocuments({ authorId: userId });

  return { followers, following, postCount };
}

async function getProfileConnections(userId) {
  const db = getDb();
  const followerIds = db.follows
    .filter((follow) => follow.followingId === userId)
    .map((follow) => follow.followerId);
  const followingIds = db.follows
    .filter((follow) => follow.followerId === userId)
    .map((follow) => follow.followingId);
  const users = await findUsersByLegacyIds([...followerIds, ...followingIds]);
  const byId = new Map(users.map((user) => [user.legacyId, sanitizeUser(user)]));

  return {
    followers: followerIds.map((id) => byId.get(id)).filter(Boolean),
    following: followingIds.map((id) => byId.get(id)).filter(Boolean),
  };
}

function createNotification(db, { recipientId, actorId, type, postId = null, commentId = null }) {
  if (!recipientId || !actorId || recipientId === actorId) return null;
  if (!Array.isArray(db.notifications)) db.notifications = [];

  const duplicate = db.notifications.find((notification) =>
    notification.recipientId === recipientId &&
    notification.actorId === actorId &&
    notification.type === type &&
    notification.postId === postId &&
    notification.commentId === commentId
  );

  if (duplicate) return duplicate;

  const notification = {
    id: uuidv4(),
    recipientId,
    actorId,
    type,
    postId,
    commentId,
    read: false,
    createdAt: new Date().toISOString(),
  };
  db.notifications.unshift(notification);
  return notification;
}

async function buildNotificationView(notification) {
  const actor = await findUserByLegacyId(notification.actorId);
  const post = notification.postId
    ? await Post.findOne({ legacyId: notification.postId }).lean()
    : null;

  return {
    ...notification,
    actor: actor
      ? sanitizeUser(actor)
      : { id: notification.actorId, username: "Deleted user", name: "Deleted user", avatar: "/assets/profile.png" },
    postExists: Boolean(post),
    postImage: post?.imageUrl || null,
    formattedTimestamp: formatTimestamp(notification.createdAt),
  };
}

async function getUserNotifications(userId) {
  const notifications = getDb().notifications
    .filter((notification) => notification.recipientId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return Promise.all(notifications.map(buildNotificationView));
}

function getUnreadNotificationCount(userId) {
  return getDb().notifications.filter(
    (notification) => notification.recipientId === userId && !notification.read
  ).length;
}

function renderProfileEdit(res, user, error = null, status = 200) {
  return res.status(status).render("profile-edit.ejs", {
    currentUser: sanitizeUser(user),
    error,
  });
}
function uploadToCloudinary(fileBuffer, mimetype, folder = "instagram-clone") {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }

        resolve(result);
      }
    );

    uploadStream.end(fileBuffer);
  });
}

app.get("/", (req, res) => {
  if (req.session.userId) {
    return res.redirect("/home");
  }
  return res.redirect("/login");
});

app.get("/login", (req, res) => {
  if (req.session.userId) {
    return res.redirect("/home");
  }
  const errors = {
    facebook_cancelled: "Facebook sign-in was cancelled.",
    facebook_not_configured: "Facebook sign-in is not configured on this server.",
    facebook_failed: "Facebook sign-in failed. Please try again.",
    facebook_email_conflict: "An account already uses this email. Log in with your password before linking Facebook.",
  };
  res.render("login.ejs", { error: errors[req.query.error] || null });
});

app.get("/auth/facebook", (req, res, next) => {
  if (!facebookConfigured) {
    return res.redirect("/login?error=facebook_not_configured");
  }
  return passport.authenticate("facebook", { scope: ["email"], state: true })(req, res, next);
});

app.get("/auth/facebook/callback", (req, res, next) => {
  if (req.query.error === "access_denied") {
    return res.redirect("/login?error=facebook_cancelled");
  }
  if (!facebookConfigured) {
    return res.redirect("/login?error=facebook_not_configured");
  }

  return passport.authenticate("facebook", { session: false }, (error, user, info) => {
    if (error) {
      console.error("Facebook OAuth failed:", error.message);
      return res.redirect("/login?error=facebook_failed");
    }
    if (!user) {
      return res.redirect(info?.message?.includes("already uses this email")
        ? "/login?error=facebook_email_conflict"
        : "/login?error=facebook_failed");
    }

    req.session.regenerate((sessionError) => {
      if (sessionError) {
        console.error("Facebook session creation failed:", sessionError.message);
        return res.redirect("/login?error=facebook_failed");
      }
      req.session.userId = user.legacyId;
      return res.redirect("/home");
    });
  })(req, res, next);
});

app.post("/login", async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).render("login.ejs", {
      error: "Please enter both your username/email and password.",
    });
  }

  const normalizedIdentifier = String(identifier).trim().toLowerCase();
  const user = await User.findOne({
    $or: [{ username: normalizedIdentifier }, { email: normalizedIdentifier }],
  }).select("+passwordHash");

  if (!user || !user.passwordHash || !(await bcrypt.compare(String(password), user.passwordHash))) {
    return res.status(400).render("login.ejs", {
      error: "Invalid credentials. Please try again.",
    });
  }

  
  req.session.regenerate((sessionError) => {
  if (sessionError) {
    console.error("Login session creation failed:", sessionError);
    return res.status(500).render("login.ejs", {
      error: "Unable to create login session. Please try again.",
    });
  }

  req.session.userId = user.legacyId;

  req.session.save((saveError) => {
    if (saveError) {
      console.error("Login session save failed:", saveError);
      return res.status(500).render("login.ejs", {
        error: "Unable to save login session. Please try again.",
      });
    }

    return res.redirect("/home");
  });
});
});
// app.post("/login", async (req, res) => {
//   const { identifier, password } = req.body;

//   console.log("========== LOGIN DEBUG ==========");
//   console.log("Identifier received:", identifier);
//   console.log("Password received:", password ? "YES" : "NO");

//   if (!identifier || !password) {
//     console.log("LOGIN FAILED: missing identifier/password");
//     return res.status(400).render("login.ejs", {
//       error: "Please enter both your username/email and password.",
//     });
//   }

//   const normalizedIdentifier = String(identifier).trim().toLowerCase();

//   console.log("Normalized identifier:", normalizedIdentifier);

//   const user = await User.findOne({
//     $or: [
//       { username: normalizedIdentifier },
//       { email: normalizedIdentifier }
//     ],
//   }).select("+passwordHash");

//   console.log("MongoDB user found:", !!user);

//   if (user) {
//     console.log("Username:", user.username);
//     console.log("Email:", user.email);
//     console.log("Legacy ID:", user.legacyId);
//     console.log("Password hash exists:", !!user.passwordHash);
//   }

//   if (!user) {
//     console.log("LOGIN FAILED: user not found");
//     console.log("================================");
//     return res.status(400).render("login.ejs", {
//       error: "Invalid credentials. Please try again.",
//     });
//   }

//   if (!user.passwordHash) {
//     console.log("LOGIN FAILED: passwordHash missing");
//     console.log("================================");
//     return res.status(400).render("login.ejs", {
//       error: "This account does not have a password configured.",
//     });
//   }

//   const passwordMatches = await bcrypt.compare(
//     String(password),
//     user.passwordHash
//   );

//   console.log("Password matches:", passwordMatches);

//   if (!passwordMatches) {
//     console.log("LOGIN FAILED: wrong password");
//     console.log("================================");
//     return res.status(400).render("login.ejs", {
//       error: "Invalid credentials. Please try again.",
//     });
//   }

//   console.log("LOGIN SUCCESS");
//   console.log("Setting session userId:", user.legacyId);

//   req.session.regenerate((sessionError) => {
//     if (sessionError) {
//       console.error("SESSION REGENERATE ERROR:", sessionError);
//       return res.status(500).render("login.ejs", {
//         error: "Unable to create login session.",
//       });
//     }

//     req.session.userId = user.legacyId;

//     req.session.save((saveError) => {
//       if (saveError) {
//         console.error("SESSION SAVE ERROR:", saveError);
//         return res.status(500).render("login.ejs", {
//           error: "Unable to save login session.",
//         });
//       }

//       console.log("SESSION SAVED SUCCESSFULLY");
//       console.log("================================");

//       return res.redirect("/home");
//     });
//   });
// });

app.get("/signup", (req, res) => {
  if (req.session.userId) {
    return res.redirect("/home");
  }
  res.render("signup.ejs", { error: null });
});

app.post("/signup", async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).render("signup.ejs", {
      error: "Please fill in all fields.",
    });
  }

  if (username.trim().length < 3) {
    return res.status(400).render("signup.ejs", {
      error: "Username must be at least 3 characters long.",
    });
  }

  if (password.length < 6) {
    return res.status(400).render("signup.ejs", {
      error: "Password must be at least 6 characters long.",
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).render("signup.ejs", {
      error: "Please enter a valid email address.",
    });
  }

  const normalizedUsername = username.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = await User.findOne({
    $or: [{ username: normalizedUsername }, { email: normalizedEmail }],
  });

  if (existingUser) {
    return res.status(400).render("signup.ejs", {
      error: "A user with that username or email already exists.",
    });
  }

  const newUser = {
    legacyId: uuidv4(),
    username: normalizedUsername,
    name: username.trim(),
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, 10),
    authProvider: "local",
    avatar: "/assets/profile.png",
    bio: "New to Instagram Clone.",
    createdAt: new Date().toISOString(),
  };

  let createdUser;
  try {
    createdUser = await User.create(newUser);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).render("signup.ejs", {
        error: "A user with that username or email already exists.",
      });
    }
    throw error;
  }
  req.session.userId = createdUser.legacyId;
  return res.redirect("/home");
});

app.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.delete("/account", requireAuth, async (req, res, next) => {
  const currentUser = getCurrentUser(req);

  try {
    const result = await User.deleteOne({ legacyId: currentUser.id });
    if (result.deletedCount !== 1) {
      return res.status(404).json({ error: "User account not found." });
    }

    req.session.destroy((sessionError) => {
      if (sessionError) return next(sessionError);
      return res.json({ success: true, redirect: "/login?deleted=1" });
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/notifications", requireAuth, async (req, res, next) => {
  const currentUser = getCurrentUser(req);
  try {
    return res.render("notifications.ejs", {
      currentUser: sanitizeUser(currentUser),
      notifications: await getUserNotifications(currentUser.id),
      unreadCount: getUnreadNotificationCount(currentUser.id),
      error: null,
    });
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/notifications/:id/read", requireAuth, (req, res) => {
  const db = getDb();
  const currentUser = getCurrentUser(req);
  const notification = db.notifications.find(
    (entry) => entry.id === req.params.id && entry.recipientId === currentUser.id
  );

  if (!notification) return res.status(404).json({ error: "Notification not found." });
  notification.read = true;
  saveDb(db);
  return res.json({ success: true, unreadCount: getUnreadNotificationCount(currentUser.id) });
});

app.post("/api/notifications/read-all", requireAuth, (req, res) => {
  const db = getDb();
  const currentUser = getCurrentUser(req);
  db.notifications.forEach((notification) => {
    if (notification.recipientId === currentUser.id) notification.read = true;
  });
  saveDb(db);
  return res.json({ success: true, unreadCount: 0 });
});

app.get("/home", requireAuth, async (req, res, next) => {
  const currentUser = getCurrentUser(req);
  try {
    res.render("home.ejs", {
      currentUser: sanitizeUser(currentUser),
      posts: await getFeedPosts(currentUser.id),
      suggestions: await getSuggestions(currentUser.id),
      unreadNotifications: getUnreadNotificationCount(currentUser.id),
      error: null,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/new", requireAuth, (req, res) => {
  const currentUser = getCurrentUser(req);
  res.render("new.ejs", {
    currentUser: sanitizeUser(currentUser),
    error: null,
  });
});

app.post("/home", requireAuth, (req, res, next) => {
  upload.single("image")(req, res, (error) => {
    if (error) {
      return res.status(400).render("new.ejs", {
        currentUser: sanitizeUser(getCurrentUser(req)),
        error: error.message,
      });
    }
    next();
  });
}, async (req, res, next) => {
  const currentUser = getCurrentUser(req);
  const caption = String(req.body.caption || "").trim();
  const imageUrl = String(req.body.imageUrl || "").trim();
  let uploadedImage = "";

if (req.file) {
  const cloudinaryResult = await uploadToCloudinary(
    req.file.buffer,
    req.file.mimetype,
    "instagram-clone/posts"
  );

  uploadedImage = cloudinaryResult.secure_url;
}

  if (!caption) {
    return res.status(400).render("new.ejs", {
      currentUser: sanitizeUser(currentUser),
      error: "Caption is required.",
    });
  }

  if (caption.length > 220) {
    return res.status(400).render("new.ejs", {
      currentUser: sanitizeUser(currentUser),
      error: "Caption must be 220 characters or fewer.",
    });
  }

  const finalImage = uploadedImage || imageUrl;
  if (!finalImage) {
    return res.status(400).render("new.ejs", {
      currentUser: sanitizeUser(currentUser),
      error: "Please add an image URL or upload an image.",
    });
  }

  try {
    await Post.create({
    legacyId: uuidv4(),
    authorId: currentUser.id,
    imageUrl: finalImage,
    caption,
    createdAt: new Date().toISOString(),
    likes: [],
    comments: [],
    });
  } catch (error) {
    return next(error);
  }

  return res.redirect("/home");
});

app.get("/home/:id/view", requireAuth, async (req, res, next) => {
  const currentUser = getCurrentUser(req);
  const post = await Post.findOne({ legacyId: req.params.id }).lean();

  if (!post) {
    return res.status(404).send("Post not found.");
  }

  try {
    const builtPost = await buildPostView(post, currentUser.id);
    res.render("view.ejs", {
      currentUser: sanitizeUser(currentUser),
      post: builtPost,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/home/:id/edit", requireAuth, async (req, res, next) => {
  const currentUser = getCurrentUser(req);
  const post = await Post.findOne({ legacyId: req.params.id }).lean();

  if (!post) {
    return res.status(404).send("Post not found.");
  }

  if (post.authorId !== currentUser.id) {
    return res.status(403).send("You are not allowed to edit this post.");
  }

  res.render("edit.ejs", {
    currentUser: sanitizeUser(currentUser),
    post,
    error: null,
  });
});

app.patch("/home/:id", requireAuth, (req, res, next) => {
  upload.single("image")(req, res, (error) => {
    if (error) {
      const currentUser = getCurrentUser(req);
      return Post.findOne({ legacyId: req.params.id }).lean().then((post) => {
        if (!post) return res.status(404).send("Post not found.");
        return res.status(400).render("edit.ejs", {
          currentUser: sanitizeUser(currentUser), post, error: error.message,
        });
      }).catch(next);
    }
    next();
  });
}, async (req, res, next) => {
  const currentUser = getCurrentUser(req);
  const post = await Post.findOne({ legacyId: req.params.id });

  if (!post) {
    return res.status(404).send("Post not found.");
  }

  if (post.authorId !== currentUser.id) {
    return res.status(403).send("You are not allowed to edit this post.");
  }

  const caption = String(req.body.caption || "").trim();
  const imageUrl = String(req.body.imageUrl || "").trim();
  let uploadedImage = "";

if (req.file) {
  const cloudinaryResult = await uploadToCloudinary(
    req.file.buffer,
    req.file.mimetype,
    "instagram-clone/posts"
  );

  uploadedImage = cloudinaryResult.secure_url;
}

  if (!caption) {
    return res.status(400).render("edit.ejs", {
      currentUser: sanitizeUser(currentUser),
      post,
      error: "Caption cannot be empty.",
    });
  }

  if (caption.length > 220) {
    return res.status(400).render("edit.ejs", {
      currentUser: sanitizeUser(currentUser),
      post,
      error: "Caption must be 220 characters or fewer.",
    });
  }

  post.caption = caption;
  if (uploadedImage) {
    post.imageUrl = uploadedImage;
  } else if (imageUrl) {
    post.imageUrl = imageUrl;
  }

  try {
    await post.save();
    return res.redirect(`/home/${post.legacyId}/view`);
  } catch (error) {
    return next(error);
  }
});

app.delete("/home/:id", requireAuth, async (req, res, next) => {
  const currentUser = getCurrentUser(req);
  const post = await Post.findOne({ legacyId: req.params.id });
  if (!post) {
    return res.status(404).send("Post not found.");
  }

  if (post.authorId !== currentUser.id) {
    return res.status(403).send("You are not allowed to delete this post.");
  }

  await Post.deleteOne({ _id: post._id });

  if (req.accepts("json")) {
    return res.json({ success: true, postId: post.legacyId });
  }

  return res.redirect("/home");
});

app.post("/api/posts/:id/like", requireAuth, async (req, res, next) => {
  const db = getDb();
  const currentUser = getCurrentUser(req);
  const post = await Post.findOne({ legacyId: req.params.id });

  if (!post) {
    return res.status(404).json({ error: "Post not found." });
  }

  if (!Array.isArray(post.likes)) {
    post.likes = [];
  }

  const alreadyLiked = post.likes.includes(currentUser.id);
  if (alreadyLiked) {
    post.likes = post.likes.filter((userId) => userId !== currentUser.id);
  } else {
    post.likes.push(currentUser.id);
    createNotification(db, {
      recipientId: post.authorId,
      actorId: currentUser.id,
      type: "like",
      postId: post.legacyId,
    });
  }

  try {
    await post.save();
    saveDb(db);
  } catch (error) {
    return next(error);
  }
  return res.json({
    liked: !alreadyLiked,
    likesCount: post.likes.length,
  });
});

app.post("/api/posts/:id/comment", requireAuth, async (req, res, next) => {
  const db = getDb();
  const currentUser = getCurrentUser(req);
  const post = await Post.findOne({ legacyId: req.params.id });
  const text = String(req.body.text || "").trim();

  if (!post) {
    return res.status(404).json({ error: "Post not found." });
  }

  if (!text) {
    return res.status(400).json({ error: "Comment cannot be empty." });
  }

  const newComment = {
    id: uuidv4(),
    userId: currentUser.id,
    text,
    createdAt: new Date().toISOString(),
  };

  post.comments = Array.isArray(post.comments) ? post.comments : [];
  post.comments.push(newComment);
  createNotification(db, {
    recipientId: post.authorId,
    actorId: currentUser.id,
    type: "comment",
    postId: post.legacyId,
    commentId: newComment.id,
  });
  try {
    await post.save();
    saveDb(db);
  } catch (error) {
    return next(error);
  }

  const commenter = sanitizeUser(currentUser);
  return res.json({
    comment: {
      ...newComment,
      commenter,
    },
  });
});

app.delete("/api/posts/:postId/comments/:commentId", requireAuth, async (req, res, next) => {
  const db = getDb();
  const currentUser = getCurrentUser(req);
  const post = await Post.findOne({ legacyId: req.params.postId });

  if (!post) {
    return res.status(404).json({ error: "Post not found." });
  }

  if (!Array.isArray(post.comments)) {
    return res.status(400).json({ error: "No comments found." });
  }

  const commentIndex = post.comments.findIndex((comment) => comment.id === req.params.commentId);
  if (commentIndex === -1) {
    return res.status(404).json({ error: "Comment not found." });
  }

  const comment = post.comments[commentIndex];
  if (comment.userId !== currentUser.id && post.authorId !== currentUser.id) {
    return res.status(403).json({ error: "You are not allowed to delete this comment." });
  }

  post.comments.splice(commentIndex, 1);
  try {
    await post.save();
  } catch (error) {
    return next(error);
  }

  if (req.accepts("json")) {
    return res.json({ success: true, commentId: req.params.commentId });
  }

  return res.json({ success: true });
});

app.post("/api/users/:id/follow", requireAuth, async (req, res, next) => {
  const db = getDb();
  const currentUser = getCurrentUser(req);
  let targetUser;
  try {
    targetUser = await findUserByLegacyId(req.params.id);
  } catch (error) {
    return next(error);
  }

  if (!targetUser) {
    return res.status(404).json({ error: "User not found." });
  }

  if (currentUser.id === req.params.id) {
    return res.status(400).json({ error: "You cannot follow yourself." });
  }

  const followIndex = db.follows.findIndex(
    (follow) => follow.followerId === currentUser.id && follow.followingId === req.params.id
  );

  if (followIndex >= 0) {
    db.follows.splice(followIndex, 1);
    saveDb(db);
    return res.json({
      followed: false,
      followersCount: db.follows.filter((follow) => follow.followingId === req.params.id).length,
      followingCount: db.follows.filter((follow) => follow.followerId === currentUser.id).length,
    });
  }

  db.follows.push({
    id: uuidv4(),
    followerId: currentUser.id,
    followingId: req.params.id,
  });

  createNotification(db, {
    recipientId: targetUser.id,
    actorId: currentUser.id,
    type: "follow",
  });

  saveDb(db);
  return res.json({
    followed: true,
    followersCount: db.follows.filter((follow) => follow.followingId === req.params.id).length,
    followingCount: db.follows.filter((follow) => follow.followerId === currentUser.id).length,
  });
});

app.get("/api/users/:id/followers", requireAuth, async (req, res, next) => {
  const profileUser = await findUserByLegacyId(req.params.id).catch(next);
  if (!profileUser) return res.status(404).json({ error: "User not found." });

  return res.json({ users: (await getProfileConnections(profileUser.legacyId)).followers });
});

app.get("/api/users/:id/following", requireAuth, async (req, res, next) => {
  const profileUser = await findUserByLegacyId(req.params.id).catch(next);
  if (!profileUser) return res.status(404).json({ error: "User not found." });

  return res.json({ users: (await getProfileConnections(profileUser.legacyId)).following });
});

app.get("/profile", requireAuth, (req, res) => {
  const currentUser = getCurrentUser(req);
  return res.redirect(`/profile/${currentUser.username}`);
});

app.get("/profile/edit", requireAuth, (req, res) => {
  return renderProfileEdit(res, getCurrentUser(req));
});

app.post("/profile/edit", requireAuth, (req, res, next) => {
  upload.single("avatar")(req, res, (error) => {
    if (error) {
      return renderProfileEdit(res, getCurrentUser(req), error.message, 400);
    }
    next();
  });
}, async (req, res, next) => {
  const currentUser = getCurrentUser(req);
  const name = String(req.body.name || "").trim();
  const bio = String(req.body.bio || "").trim();

  if (!name) {
    return renderProfileEdit(res, currentUser, "Name cannot be empty.", 400);
  }

  User.findOneAndUpdate(
    { legacyId: currentUser.id },
    {
      $set: {
        name: name.slice(0, 80),
        bio: bio.slice(0, 160),
        ...(req.file ? {
  avatar: await uploadToCloudinary(
    req.file.buffer,
    req.file.mimetype,
    "instagram-clone/avatars"
  ).then(result => result.secure_url)
} : {}),
      },
    },
    { returnDocument: "after", runValidators: true }
  )
    .then((updatedUser) => {
      if (!updatedUser) return res.status(404).send("User not found.");
      return res.redirect(`/profile/${updatedUser.username}`);
    })
    .catch(next);
});

app.get("/profile/:username", requireAuth, async (req, res, next) => {
  const db = getDb();
  const currentUser = getCurrentUser(req);
  let profileUser;

  try {
    profileUser = await User.findOne({ username: req.params.username }).lean();
  } catch (error) {
    return next(error);
  }

  if (!profileUser) {
    return res.status(404).send("User not found.");
  }

  const profilePosts = await Post.find({ authorId: profileUser.legacyId })
    .sort({ createdAt: -1 })
    .lean();
  const posts = await Promise.all(profilePosts.map((post) => buildPostView(post, currentUser.id)));

  const isOwner = profileUser.legacyId === currentUser.id;
  const isFollowing = db.follows.some(
    (follow) => follow.followerId === currentUser.id && follow.followingId === profileUser.id
  );

  res.render("profile.ejs", {
    currentUser: sanitizeUser(currentUser),
    profileUser: sanitizeUser(profileUser),
    posts,
    stats: await getProfileStats(profileUser.legacyId),
    connections: await getProfileConnections(profileUser.legacyId),
    isOwner,
    isFollowing,
  });
});


app.get("/search", requireAuth, async (req, res, next) => {
  const currentUser = getCurrentUser(req);
  const query = String(req.query.q || "").trim();

  let results = [];
  if (query) {
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const users = await User.find({
      legacyId: { $ne: currentUser.id },
      $or: [{ username: pattern }, { email: pattern }, { name: pattern }],
    }).lean();
    const db = getDb();
    results = users
      .map((user) => ({
        ...sanitizeUser(user),
        isFollowing: db.follows.some(
          (follow) => follow.followerId === currentUser.id && follow.followingId === user.legacyId
        ),
      }));
  }

  try {
    res.render("search.ejs", { currentUser: sanitizeUser(currentUser), query, results, error: null });
  } catch (error) {
    next(error);
  }
});

app.get("/explore", requireAuth, async (req, res, next) => {
  const currentUser = getCurrentUser(req);
  const allPosts = await Post.find({}).sort({ createdAt: -1 }).lean();
  const authorIds = [...new Set(allPosts.map((post) => post.authorId))];
  const authors = await findUsersByLegacyIds(authorIds);
  const existingAuthorIds = new Set(authors.map((author) => author.legacyId));
  const posts = await Promise.all(allPosts
    .filter((post) => existingAuthorIds.has(post.authorId))
    .map((post) => buildPostView(post, currentUser.id)));

  try {
    return res.render("explore.ejs", { currentUser: sanitizeUser(currentUser), posts, error: null });
  } catch (error) {
    return next(error);
  }
});

connectDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Instagram clone listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Server startup aborted:", error.message);
    process.exitCode = 1;
  });