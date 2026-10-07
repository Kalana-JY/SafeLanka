import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Physical phone (Expo Go) cannot reach 10.0.2.2 (emulator-only).
// Uses PC LAN IP by default; override with EXPO_PUBLIC_API_URL for emulator/other networks.
export const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://192.168.8.100:5000/api';

export const api = axios.create({ baseURL: API_BASE, timeout: 15000 });

let accessToken = null;

export async function loadToken() {
  accessToken = await SecureStore.getItemAsync('accessToken');
  return accessToken;
}

export async function saveAuth({ accessToken: at, refreshToken }) {
  accessToken = at;
  await SecureStore.setItemAsync('accessToken', at);
  if (refreshToken) await SecureStore.setItemAsync('refreshToken', refreshToken);
}

export async function clearAuth() {
  accessToken = null;
  await SecureStore.deleteItemAsync('accessToken');
  await SecureStore.deleteItemAsync('refreshToken');
}

api.interceptors.request.use(async (config) => {
  if (!accessToken) accessToken = await SecureStore.getItemAsync('accessToken');
  if (accessToken) config.headers.Authorization = 'Bearer ' + accessToken;
  return config;
});
