import { create } from 'zustand';
import api from './axios';
import { parseRetryAfterHeader, formatRetryTime } from './utils';

// Synchronous analysis-specific concurrency guard tracking active in-flight analysis IDs
const activeInFlightAnalyses = new Set();

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
  resumes: [],
  currentResume: null,
  profileAnalytics: null,
  pendingResumeId: null,
  rateLimitInfo: null,
  isAnalyzingResume: false,
  loading: false,
  isFetching: false,
  isFetchingAnalytics: false,
  isDeleting: false,
  deletingId: null,
  statusText: '',
  error: null,

  clearError: () => set({ error: null }),
  clearPendingResume: () => set({ pendingResumeId: null, rateLimitInfo: null, error: null }),
  resetStatus: () =>
    set({
      loading: false,
      isAnalyzingResume: false,
      isFetching: false,
      isFetchingAnalytics: false,
      isDeleting: false,
      deletingId: null,
      error: null,
      statusText: '',
      rateLimitInfo: null,
    }),

  getResumes: async () => {
    set({ isFetching: true, error: null });
    try {
      const res = await api.get('/resumes');
      const resumes = res.data?.resumes || [];
      set({ resumes, isFetching: false, error: null });
      return { success: true, resumes };
    } catch (err) {
      const message =
        err.response?.data?.message || err.message || 'Failed to fetch resumes';
      set({ isFetching: false, error: message });
      return { success: false, status: err.response?.status, error: message };
    }
  },

  deleteResume: async (id) => {
    set({ isDeleting: true, deletingId: id, error: null });
    try {
      await api.delete(`/resumes/${id}`);
      // Only update local state after confirmed successful backend deletion
      set((state) => ({
        resumes: state.resumes.filter((r) => (r._id || r.id) !== id),
        isDeleting: false,
        deletingId: null,
        pendingResumeId: state.pendingResumeId === id ? null : state.pendingResumeId,
      }));
      return { success: true };
    } catch (err) {
      const message =
        err.response?.data?.message || err.message || 'Failed to delete resume';
      set({ isDeleting: false, deletingId: null, error: message });
      return { success: false, status: err.response?.status, error: message };
    }
  },

  deleteAllResumes: async () => {
    set({ isDeleting: true, error: null });
    try {
      await api.delete('/resumes');
      // Only update local state after confirmed successful backend deletion
      set({ resumes: [], isDeleting: false, pendingResumeId: null });
      return { success: true };
    } catch (err) {
      const message =
        err.response?.data?.message || err.message || 'Failed to delete all resumes';
      set({ isDeleting: false, error: message });
      return { success: false, status: err.response?.status, error: message };
    }
  },

  analyzeExistingResume: async (resumeId) => {
    if (!resumeId) {
      return { success: false, error: 'Resume ID is required for analysis' };
    }

    const normalizedId = String(resumeId);

    // Synchronous analysis-specific concurrency guard check & acquire before any await
    if (activeInFlightAnalyses.has(normalizedId) || get().isAnalyzingResume) {
      return { success: false, error: 'Analysis is already in progress for this resume' };
    }

    activeInFlightAnalyses.add(normalizedId);
    set({
      loading: true,
      isAnalyzingResume: true,
      error: null,
      statusText: 'Analyzing resume with AI...',
    });

    try {
      const analyzeRes = await api.post(`/resumes/${normalizedId}/analyze`);
      const feedback = analyzeRes.data?.feedback;

      // Update current resume and resumes array
      const existingCurrent = get().currentResume;
      const baseResume =
        (existingCurrent && (existingCurrent._id === normalizedId || existingCurrent.id === normalizedId))
          ? existingCurrent
          : (get().resumes.find((r) => (r._id || r.id) === normalizedId) || { _id: normalizedId });

      const fullResume = {
        ...baseResume,
        feedback,
      };

      set((state) => ({
        currentResume: fullResume,
        resumes: [
          fullResume,
          ...state.resumes.filter((r) => (r._id || r.id) !== normalizedId),
        ],
        pendingResumeId: null,
        rateLimitInfo: null,
        error: null,
        statusText: 'Analysis complete!',
      }));

      return {
        success: true,
        resumeId: normalizedId,
        feedback,
        resume: fullResume,
      };
    } catch (analyzeErr) {
      const status = analyzeErr.response?.status;

      if (status === 429) {
        const retryAfterSeconds = parseRetryAfterHeader(analyzeErr.response?.headers);
        const retryAt =
          retryAfterSeconds !== null ? Date.now() + retryAfterSeconds * 1000 : null;

        const friendlyMessage =
          retryAfterSeconds !== null
            ? retryAfterSeconds === 0
              ? 'Hourly analysis limit reached (5 requests/hour). You may retry now.'
              : `Hourly analysis limit reached (5 requests/hour). Please wait ${formatRetryTime(retryAfterSeconds)} before retrying.`
            : 'Hourly analysis limit reached (5 requests/hour). Please try again later.';

        set({
          pendingResumeId: normalizedId,
          rateLimitInfo: {
            isRateLimited: true,
            retryAfterSeconds,
            retryAt,
            message: friendlyMessage,
          },
          error: friendlyMessage,
        });

        return {
          success: false,
          isRateLimited: true,
          resumeId: normalizedId,
          retryAfterSeconds,
          error: friendlyMessage,
        };
      }

      if (status === 409) {
        const conflictMessage = 'Analysis is already in progress for this resume. Please wait a moment.';
        set({
          pendingResumeId: normalizedId,
          error: conflictMessage,
        });
        return {
          success: false,
          isRateLimited: false,
          resumeId: normalizedId,
          error: conflictMessage,
        };
      }

      if (status === 404) {
        const notFoundMessage = 'Resume not found or has been deleted.';
        set({
          pendingResumeId: null,
          error: notFoundMessage,
        });
        return {
          success: false,
          isRateLimited: false,
          resumeId: null,
          error: notFoundMessage,
        };
      }

      if (status === 401) {
        const authMessage = 'Session expired. Please log in again.';
        set({
          pendingResumeId: normalizedId,
          error: authMessage,
        });
        return {
          success: false,
          isRateLimited: false,
          resumeId: normalizedId,
          error: authMessage,
        };
      }

      const apiMessage =
        analyzeErr.response?.data?.message || analyzeErr.message || 'AI analysis failed';
      const errorMessage = `AI analysis failed: ${apiMessage}`;

      set({
        pendingResumeId: normalizedId,
        rateLimitInfo: null,
        error: errorMessage,
      });

      return {
        success: false,
        isRateLimited: false,
        resumeId: normalizedId,
        error: errorMessage,
      };
    } finally {
      activeInFlightAnalyses.delete(normalizedId);
      set({ loading: false, isAnalyzingResume: false, statusText: '' });
    }
  },

  analyzeResume: async (formData) => {
    let resumeId = null;
    let createdResume = null;

    // Step 1: Create resume with PDF upload via Express backend
    try {
      set({ loading: true, error: null, rateLimitInfo: null, statusText: 'Uploading resume...' });
      const uploadRes = await api.post('/resumes', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      createdResume = uploadRes.data?.resume;
      resumeId = createdResume?._id || createdResume?.id;

      if (!resumeId) {
        throw new Error('Server did not return a valid resume ID');
      }

      set({
        currentResume: createdResume,
        pendingResumeId: String(resumeId),
      });
    } catch (uploadErr) {
      const message =
        uploadErr.response?.data?.message || uploadErr.message || 'Failed to upload resume';
      set({ loading: false, error: message, statusText: '', rateLimitInfo: null });
      return { success: false, step: 'upload', error: message };
    }

    // Step 2: Trigger AI analysis on the uploaded resume using analyzeExistingResume
    return await get().analyzeExistingResume(resumeId);
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

  getProfileAnalytics: async () => {
    set({ isFetchingAnalytics: true, error: null });
    try {
      const res = await api.get('/profile/analytics');
      const data = res.data;
      set({ profileAnalytics: data, isFetchingAnalytics: false, error: null });
      return { success: true, data };
    } catch (err) {
      const message =
        err.response?.data?.message || err.message || 'Failed to fetch profile analytics';
      set({ isFetchingAnalytics: false, error: message });
      return {
        success: false,
        status: err.response?.status,
        error: message,
      };
    }
  },
}));

