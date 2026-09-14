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

export const useResumeStore = create((set, get) => ({
  currentResume: null,
  loading: false,
  statusText: '',
  error: null,

  clearError: () => set({ error: null }),
  resetStatus: () => set({ loading: false, error: null, statusText: '' }),

  analyzeResume: async (formData) => {
    let resumeId = null;
    let createdResume = null;

    // Step 1: Create resume with PDF upload via Express backend
    try {
      set({ loading: true, error: null, statusText: 'Uploading resume...' });
      const uploadRes = await api.post('/resumes', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      createdResume = uploadRes.data?.resume;
      resumeId = createdResume?._id || createdResume?.id;

      if (!resumeId) {
        throw new Error('Server did not return a valid resume ID');
      }
    } catch (uploadErr) {
      const message =
        uploadErr.response?.data?.message || uploadErr.message || 'Failed to upload resume';
      set({ loading: false, error: message, statusText: '' });
      return { success: false, step: 'upload', error: message };
    }

    // Step 2: Trigger AI analysis on the uploaded resume
    try {
      set({ statusText: 'Analyzing resume with AI...' });
      const analyzeRes = await api.post(`/resumes/${resumeId}/analyze`);
      const feedback = analyzeRes.data?.feedback;

      const fullResume = {
        ...createdResume,
        feedback,
      };

      set({
        currentResume: fullResume,
        loading: false,
        statusText: 'Analysis complete!',
        error: null,
      });

      return {
        success: true,
        resumeId,
        feedback,
        resume: fullResume,
      };
    } catch (analyzeErr) {
      const apiMessage =
        analyzeErr.response?.data?.message || analyzeErr.message || 'AI analysis failed';
      const errorMessage = `Resume was uploaded successfully, but AI analysis failed: ${apiMessage}`;

      set({
        loading: false,
        error: errorMessage,
        statusText: '',
        currentResume: createdResume,
      });

      return {
        success: false,
        step: 'analyze',
        resumeId,
        error: errorMessage,
      };
    }
  },

  getResumeById: async (id) => {
    set({ loading: true, error: null });
    try {
      const res = await api.get(`/resumes/${id}`);
      const resume = res.data?.resume;
      set({ currentResume: resume, loading: false, error: null });
      return { success: true, resume };
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Failed to fetch resume';
      set({ loading: false, error: message });
      return {
        success: false,
        status: err.response?.status,
        error: message,
      };
    }
  },
}));
