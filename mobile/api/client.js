import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Emulator default. Physical device: replace with PC LAN IP, e.g. http://192.168.1.5:5000/api
export const API_BASE = 'http://10.0.2.2:5000/api';

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
