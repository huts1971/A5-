export const USE_MOCK_API = import.meta.env.VITE_USE_MOCK_API === 'true';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8001';

export const AVATAR_SERVICE_URL =
  import.meta.env.VITE_AVATAR_SERVICE_URL ?? 'http://127.0.0.1:8283';
