export type AppEntry = 'visitor' | 'admin';

export function getAppEntry(): AppEntry {
  const configured = import.meta.env.VITE_APP_ENTRY;
  if (configured === 'visitor' || configured === 'admin') {
    return configured;
  }
  return window.location.port === '5174' ? 'admin' : 'visitor';
}
