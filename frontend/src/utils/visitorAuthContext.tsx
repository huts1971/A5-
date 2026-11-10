import { createContext, useContext } from 'react';
import type { AuthUser } from '../types/api';

export interface VisitorAuthState {
  user: AuthUser | null;
  loading: boolean;
  logout: () => void;
}

export const VisitorAuthContext = createContext<VisitorAuthState>({
  user: null,
  loading: false,
  logout: () => undefined,
});

export function useVisitorAuth() {
  return useContext(VisitorAuthContext);
}
