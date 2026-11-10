import { requestJson } from './client';

export interface AmapRuntimeConfig {
  enabled: boolean;
  key: string;
  securityCode: string;
}

interface BackendAmapRuntimeConfig {
  enabled: boolean;
  key: string;
  security_code: string;
}

export async function getAmapRuntimeConfig(): Promise<AmapRuntimeConfig> {
  const config = await requestJson<BackendAmapRuntimeConfig>('/api/maps/amap-config');
  return {
    enabled: config.enabled,
    key: config.key,
    securityCode: config.security_code,
  };
}
