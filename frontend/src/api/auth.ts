import { requestJson } from './client';
import type { AuthResponse, AuthUser } from '../types/api';

export const VISITOR_TOKEN_KEY = 'a5_visitor_token';
export const ADMIN_TOKEN_KEY = 'a5_admin_token';

interface AuthPayload {
  username: string;
  password: string;
}

interface RawAuthResponse {
  token: string;
  token_type: 'bearer';
  user: AuthUser;
}

function normalizeAuthResponse(response: RawAuthResponse): AuthResponse {
  return {
    token: response.token,
    tokenType: response.token_type,
    user: response.user,
  };
}

export async function registerVisitor(payload: AuthPayload): Promise<AuthResponse> {
  return normalizeAuthResponse(await requestJson<RawAuthResponse, AuthPayload>('/api/auth/register', {
    method: 'POST',
    body: payload,
  }));
}

export async function loginVisitor(payload: AuthPayload): Promise<AuthResponse> {
  return normalizeAuthResponse(await requestJson<RawAuthResponse, AuthPayload>('/api/auth/login', {
    method: 'POST',
    body: payload,
  }));
}

export async function loginAdmin(payload: AuthPayload): Promise<AuthResponse> {
  return normalizeAuthResponse(await requestJson<RawAuthResponse, AuthPayload>('/api/auth/admin/login', {
    method: 'POST',
    body: payload,
  }));
}

export async function getCurrentUser(token: string): Promise<AuthUser> {
  return requestJson<AuthUser>('/api/auth/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function getCurrentVisitor(token: string): Promise<AuthUser> {
  return getCurrentUser(token);
}

export function saveVisitorToken(token: string) {
  localStorage.setItem(VISITOR_TOKEN_KEY, token);
}

export function readVisitorToken() {
  return localStorage.getItem(VISITOR_TOKEN_KEY);
}

export function clearVisitorToken() {
  localStorage.removeItem(VISITOR_TOKEN_KEY);
}

export function saveAdminToken(token: string) {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function readAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function clearAdminToken() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}
