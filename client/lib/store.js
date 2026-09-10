import { create } from 'zustand';
import api from './axios';

export const useAuthStore = create((set, get) => ({
  user: null,
  isAuthenticated: false,
  isInitialized: false,
  loading: false,
  error: null,

  clearError: () => set({ error: null }),

  register: async ({ name, email, password }) => {
    set({ loading: true, error: null });
    try {
      const response = await api.post('/auth/register', { name, email, password });
      const user = response.data?.user;
      set({
        user,
        isAuthenticated: true,
        isInitialized: true,
        loading: false,
        error: null,
      });
      return { success: true, user };
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Registration failed';
      set({ loading: false, error: message });
      return { success: false, error: message };
    }
  },

  login: async ({ email, password }) => {
    set({ loading: true, error: null });
    try {
      const response = await api.post('/auth/login', { email, password });
      const user = response.data?.user;
      set({
        user,
        isAuthenticated: true,
        isInitialized: true,
        loading: false,
        error: null,
      });
      return { success: true, user };
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Invalid email or password';
      set({ loading: false, error: message });
      return { success: false, error: message };
    }
  },

  logout: async () => {
    set({ loading: true });
    try {
      await api.post('/auth/logout');
    } catch (err) {
      console.error('Logout error on server:', err);
    } finally {
      // Always clear client-side state
      set({
        user: null,
        isAuthenticated: false,
        isInitialized: true,
        loading: false,
        error: null,
      });
    }
  },

  fetchMe: async () => {
    try {
      const response = await api.get('/auth/me');
      const user = response.data?.user;
      set({
        user,
        isAuthenticated: true,
        isInitialized: true,
        loading: false,
      });
      return { success: true, user };
    } catch (err) {
      set({
        user: null,
        isAuthenticated: false,
        isInitialized: true,
        loading: false,
      });
      return { success: false };
    }
  },
}));

// Provide useStore as an alias for flexibility
export const useStore = useAuthStore;
