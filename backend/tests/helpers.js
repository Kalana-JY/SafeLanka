import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../src/models/User.js';

let mongo = null;
let server = null;
let baseUrl = '';
let seq = 0;

function isolatedMongod() {
  const dir = path.join(os.tmpdir(), 'safelanka-test-mongod');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'mongod.exe');
  if (!fs.existsSync(dest)) {
    const source = path.join(os.homedir(), '.cache', 'mongodb-binaries', 'mongod-x64-win32-7.0.24.exe');
    fs.copyFileSync(source, dest);
  }
  return dest;
}

export async function startTestServer() {
  process.env.JWT_SECRET = 'test-only-secret';
  process.env.JWT_REFRESH_SECRET = 'test-only-refresh';
  // A separate binary copy avoids the cached mongod.exe, which may be locked
  // by a running development server. Tests never use that server or its data.
  mongo = await MongoMemoryServer.create({
    binary: { systemBinary: isolatedMongod() }
  });
  await mongoose.connect(mongo.getUri());
  const { default: app } = await import('../src/app.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
}

export async function stopTestServer() {
  if (server) {
    const closing = server;
    server = null;
    await new Promise((resolve, reject) => closing.close((err) => (err ? reject(err) : resolve())));
  }
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongo) {
    const stopping = mongo;
    mongo = null;
    await stopping.stop();
  }
}

export async function resetDb() {
  const collections = mongoose.connection.collections;
  for (const name of Object.keys(collections)) {
    await collections[name].deleteMany({});
  }
}

export async function createUser(overrides = {}) {
  seq += 1;
  const role = overrides.role || 'CITIZEN';
  const doc = {
    fullName: overrides.fullName || `User ${seq}`,
    email: overrides.email || `user${seq}@test.local`,
    mobileNo: overrides.mobileNo || `077${String(seq).padStart(7, '0')}`,
    passwordHash: 'test-hash-not-a-login',
    role,
    district: overrides.district || 'Ratnapura',
    preferredLanguage: 'en',
    alertOptIn: overrides.alertOptIn !== undefined ? overrides.alertOptIn : true,
    active: overrides.active !== false
  };
  if (role !== 'CITIZEN') doc.employeeNo = overrides.employeeNo || `EMP-${seq}`;
  return User.create(doc);
}

export function tokenFor(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

export function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

export async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { status: res.status, data };
}
