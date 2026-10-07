import mongoose from 'mongoose';
import fs from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server';

let memoryServer = null;

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  // Sanitize: tolerate copy-paste artifacts without ever logging the value.
  // Extract from the first mongodb:// or mongodb+srv:// occurrence (drops
  // prefixes like 'export ', smart quotes, invisible chars). Cut trailing
  // quotes/whitespace.
  const raw = process.env.MONGO_URI || '';
  const found = raw.match(/mongodb(\+srv)?:\/\/\S+/);
  const uri = found ? found[0].replace(/['"'\u2018\u2019\u201C\u201D`]+$/g, '') : '';
  if (raw.trim() && !uri) {
    console.warn('MONGO_URI is set but contains no mongodb:// or mongodb+srv:// string — check its format.');
  } else if (/<(password|username|dbname)>/i.test(uri)) {
    console.warn('MONGO_URI still contains a <placeholder> — replace it with the real value.');
  }
  if (uri) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
      console.log('MongoDB connected (MONGO_URI)');
      return mongoose.connection;
    } catch (err) {
      console.warn('MONGO_URI unreachable, falling back to in-memory MongoDB:', err.message);
    }
  }

  // Persistent local path so seeded data survives restarts (gitignored).
  fs.mkdirSync('./data/db', { recursive: true });
  memoryServer = await MongoMemoryServer.create({ instance: { dbPath: './data/db' } });
  await mongoose.connect(memoryServer.getUri());
  console.log('MongoDB connected (in-memory fallback)');
  return mongoose.connection;
}

export async function stopDB() {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
