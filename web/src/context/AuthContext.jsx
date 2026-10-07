import { createContext, useContext, useEffect, useState } from 'react';
import { api, loadToken, saveAuth, clearAuth } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        if (loadToken()) {
          const { data } = await api.get('/auth/me');
          setUser(data.user);
        }
      } catch {
        clearAuth();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function signin(email, password) {
    const { data } = await api.post('/auth/signin', { email, password });
    saveAuth(data);
    setUser(data.user);
    return data.user;
  }

  function signout() {
    clearAuth();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, signin, signout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
