import axios from 'axios';

export const api = axios.create({ baseURL: '/api', timeout: 15000 });

export function loadToken() {
  return localStorage.getItem('accessToken');
}

export function saveAuth({ accessToken, refreshToken }) {
  localStorage.setItem('accessToken', accessToken);
  if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
}

export function clearAuth() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

api.interceptors.request.use((config) => {
  const token = loadToken();
  if (token) config.headers.Authorization = 'Bearer ' + token;
  return config;
});
