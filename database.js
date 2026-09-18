const mongoose = require("mongoose");

let listenersRegistered = false;

function registerConnectionListeners() {
  if (listenersRegistered) return;
  listenersRegistered = true;

  mongoose.connection.on("connected", () => {
    console.log("MongoDB connected successfully.");
  });

  mongoose.connection.on("error", (error) => {
    console.error("MongoDB connection error:", error.message);
  });

  mongoose.connection.on("disconnected", () => {
    console.error("MongoDB disconnected.");
  });
}

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is missing. Add it to your local .env file before starting the server.");
  }

  registerConnectionListeners();
  await mongoose.connect(uri);
  return mongoose.connection;
}

module.exports = {
  connectDatabase,
};
