const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const ensureDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

const createDefaultData = () => ({
  users: [],
  posts: [],
  follows: [],
  notifications: [],
});

const readDb = () => {
  ensureDir();

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(createDefaultData(), null, 2));
  }

  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    const backupFile = `${DATA_FILE}.corrupt-${Date.now()}`;
    fs.copyFileSync(DATA_FILE, backupFile);
    throw new Error(`Database file is invalid. A recovery copy was saved to ${backupFile}.`);
  }
};

const writeDb = (data) => {
  ensureDir();
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
  fs.renameSync(tempFile, DATA_FILE);
};

const seedDemoData = () => {
  const db = readDb();

  if (db.users.length > 0 || db.posts.length > 0) {
    return db;
  }

  const demoPassword = bcrypt.hashSync('password123', 10);

  const users = [
    {
      id: 'user-demo-1',
      username: 'thakurshivam_001',
      email: 'shivam@example.com',
      passwordHash: demoPassword,
      avatar: '/assets/profile.png',
      bio: 'Building a better social feed.',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'user-demo-2',
      username: 'meher_luthra',
      email: 'meher@example.com',
      passwordHash: bcrypt.hashSync('password123', 10),
      avatar: '/assets/pic8.jpeg',
      bio: 'Travel, coffee, and stories.',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'user-demo-3',
      username: 'shradha_khapra',
      email: 'shradha@example.com',
      passwordHash: bcrypt.hashSync('password123', 10),
      avatar: '/assets/pic9.jpeg',
      bio: 'A little bit of everything.',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'user-demo-4',
      username: 'apna_college',
      email: 'apna@example.com',
      passwordHash: bcrypt.hashSync('password123', 10),
      avatar: '/assets/pic10.png',
      bio: 'Learning, building, sharing.',
      createdAt: new Date().toISOString(),
    },
  ];

  const posts = [
    {
      id: 'post-demo-1',
      authorId: 'user-demo-1',
      imageUrl: '/assets/post1.jpeg',
      caption: 'Building my dream social app one feature at a time.',
      createdAt: new Date().toISOString(),
      likes: ['user-demo-2', 'user-demo-3'],
      comments: [
        { id: 'comment-demo-1', userId: 'user-demo-2', text: 'Looks great!', createdAt: new Date().toISOString() },
      ],
    },
    {
      id: 'post-demo-2',
      authorId: 'user-demo-2',
      imageUrl: '/assets/post2.jpeg',
      caption: 'New city, new stories, same energy.',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      likes: ['user-demo-1'],
      comments: [],
    },
    {
      id: 'post-demo-3',
      authorId: 'user-demo-3',
      imageUrl: '/assets/post3.jpg',
      caption: 'Small wins add up.',
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      likes: ['user-demo-1', 'user-demo-4'],
      comments: [],
    },
  ];

  db.users = users;
  db.posts = posts;
  db.follows = [
    { id: 'follow-demo-1', followerId: 'user-demo-1', followingId: 'user-demo-2' },
    { id: 'follow-demo-2', followerId: 'user-demo-1', followingId: 'user-demo-3' },
  ];

  writeDb(db);
  return db;
};

module.exports = {
  readDb,
  writeDb,
  seedDemoData,
};
