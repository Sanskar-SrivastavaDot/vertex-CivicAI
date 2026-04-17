import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { getStoredUser, getToken, clearAuth } from '../utils/auth';
import { BACKEND_URL } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());

  // ── On every app load, fetch fresh user data from MongoDB ─────────────────
  // This ensures profilePicture and all profile data are always up to date,
  // even after a page refresh or re-login from another device.
  useEffect(() => {
    const token = getToken();
    if (!token) return;

    fetch(`${BACKEND_URL}/api/auth/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(fresh => {
        if (!fresh) return;
        setUser(prev => {
          // Merge: prefer fresh DB data, keep any local fields (e.g. pfpPreview)
          const merged = { ...(prev || {}), ...fresh };
          localStorage.setItem('user', JSON.stringify(merged));
          return merged;
        });
      })
      .catch(() => {
        // Offline or server down — keep using cached localStorage data
      });
  }, []); // Run once on mount

  // Called whenever any field (including profilePicture) changes
  const updateUser = useCallback((patch) => {
    setUser(prev => {
      const next = { ...(prev || {}), ...patch };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setUser(null);
  }, []);

  // Keep state in sync if localStorage changes from another tab
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'user') {
        setUser(e.newValue ? JSON.parse(e.newValue) : null);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <AuthContext.Provider value={{ user, updateUser, logout, getToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
