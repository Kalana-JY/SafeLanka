import axios from 'axios';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Physical phone (Expo Go) cannot reach 10.0.2.2 (emulator-only).
// Uses PC LAN IP or localhost on web; override with EXPO_PUBLIC_API_URL.
const defaultHost = Platform.OS === 'web' ? 'http://localhost:5000/api' : 'http://192.168.8.100:5000/api';
export const API_BASE = process.env.EXPO_PUBLIC_API_URL || defaultHost;

export const api = axios.create({ baseURL: API_BASE, timeout: 15000 });

let accessToken = null;

const store = {
  async get(key) {
    if (Platform.OS === 'web') return AsyncStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  async set(key, val) {
    if (Platform.OS === 'web') return AsyncStorage.setItem(key, val);
    return SecureStore.setItemAsync(key, val);
  },
  async del(key) {
    if (Platform.OS === 'web') return AsyncStorage.removeItem(key);
    return SecureStore.deleteItemAsync(key);
  }
};

export async function loadToken() {
  accessToken = await store.get('accessToken');
  return accessToken;
}

export async function saveAuth({ accessToken: at, refreshToken }) {
  accessToken = at;
  await store.set('accessToken', at);
  if (refreshToken) await store.set('refreshToken', refreshToken);
}

export async function clearAuth() {
  accessToken = null;
  await store.del('accessToken');
  await store.del('refreshToken');
}

api.interceptors.request.use(async (config) => {
  if (!accessToken) accessToken = await store.get('accessToken');
  if (accessToken) config.headers.Authorization = 'Bearer ' + accessToken;
  return config;
});

