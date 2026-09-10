"use client";

import { create } from 'zustand';
import { useAuthStore } from './store';

/**
 * Puter compatibility bridge.
 * In Phase 2, authentication is migrated to Express + MongoDB (managed by useAuthStore).
 * Puter FS, KV, and AI continue pointing to the real window.puter SDK until Phases 4-7.
 */
export const usePuterStore = create((set, get) => ({
  isLoading: false,

  // Delegate auth to the real Express backend store
  get auth() {
    const authState = useAuthStore.getState();
    return {
      user: authState.user,
      isAuthenticated: authState.isAuthenticated,
      signIn: () => {
        if (typeof window !== 'undefined') {
          window.location.href = '/auth/login';
        }
      },
      signOut: async () => {
        await authState.logout();
      },
    };
  },

  // Real Puter SDK references (loaded from https://js.puter.com/v2/)
  get fs() {
    return typeof window !== 'undefined' ? window.puter?.fs : null;
  },

  get kv() {
    return typeof window !== 'undefined' ? window.puter?.kv : null;
  },

  get ai() {
    return typeof window !== 'undefined' ? window.puter?.ai : null;
  },

  init: async () => {
    if (typeof window !== 'undefined' && window.puter) {
      set({ isLoading: false });
    }
  },
}));
