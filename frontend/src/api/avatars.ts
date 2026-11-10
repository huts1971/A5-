import type { DigitalHumanAvatar, DigitalHumanRuntimeConfig } from '../types/api';
import { requestAdminFormData, requestAdminJson } from './adminClient';
import { requestJson } from './client';


interface BackendDigitalHumanAvatar {
  id: string;
  name: string;
  note: string;
  source_filename: string;
  resource_size: number;
  is_builtin: boolean;
  is_active: boolean;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  activated_at?: string;
}

interface BackendDigitalHumanRuntimeConfig {
  avatar_id: string;
  version: string;
  loader_url: string;
  data_url: string;
  framework_url: string;
  wasm_url: string;
  streaming_assets_url: string;
  fallback_url: string;
  bridge_object_name: string;
  expires_at?: string;
}


export async function listDigitalHumanAvatars(): Promise<DigitalHumanAvatar[]> {
  const response = await requestAdminJson<{ items: BackendDigitalHumanAvatar[] }>(
    '/api/admin/avatars',
  );
  return response.items.map(mapAvatar);
}


export async function uploadDigitalHumanAvatar(
  name: string,
  note: string,
  file: File,
): Promise<DigitalHumanAvatar> {
  const body = new FormData();
  body.append('name', name);
  body.append('note', note);
  body.append('file', file);
  const response = await requestAdminFormData<BackendDigitalHumanAvatar>(
    '/api/admin/avatars',
    body,
  );
  return mapAvatar(response);
}


export async function updateDigitalHumanAvatar(
  id: string,
  name: string,
  note: string,
): Promise<DigitalHumanAvatar> {
  const response = await requestAdminJson<BackendDigitalHumanAvatar, { name: string; note: string }>(
    `/api/admin/avatars/${id}`,
    {
      method: 'PATCH',
      body: { name, note },
    },
  );
  return mapAvatar(response);
}


export async function deleteDigitalHumanAvatar(id: string): Promise<void> {
  await requestAdminJson<{ status: 'deleted' }>(`/api/admin/avatars/${id}`, {
    method: 'DELETE',
  });
}


export async function getDigitalHumanAvatarPreview(
  id: string,
): Promise<DigitalHumanRuntimeConfig> {
  const response = await requestAdminJson<BackendDigitalHumanRuntimeConfig>(
    `/api/admin/avatars/${id}/preview-token`,
    { method: 'POST' },
  );
  return mapRuntimeConfig(response);
}


export async function activateDigitalHumanAvatar(
  id: string,
): Promise<DigitalHumanAvatar> {
  const response = await requestAdminJson<BackendDigitalHumanAvatar>(
    `/api/admin/avatars/${id}/activate`,
    { method: 'POST' },
  );
  return mapAvatar(response);
}


export async function getCurrentDigitalHumanAvatar(): Promise<DigitalHumanRuntimeConfig> {
  const response = await requestJson<BackendDigitalHumanRuntimeConfig>(
    '/api/avatar/current',
  );
  const config = mapRuntimeConfig(response);
  if (
    !config.avatarId
    || !config.loaderUrl
    || !config.dataUrl
    || !config.frameworkUrl
    || !config.codeUrl
    || !config.bridgeObjectName
  ) {
    throw new Error('当前数字人运行配置无效');
  }
  return config;
}


function mapAvatar(item: BackendDigitalHumanAvatar): DigitalHumanAvatar {
  return {
    id: item.id,
    name: item.name,
    note: item.note,
    sourceFilename: item.source_filename,
    resourceSize: item.resource_size,
    isBuiltin: item.is_builtin,
    isActive: item.is_active,
    uploadedBy: item.uploaded_by,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    activatedAt: item.activated_at,
  };
}


function mapRuntimeConfig(
  config: BackendDigitalHumanRuntimeConfig,
): DigitalHumanRuntimeConfig {
  return {
    avatarId: config.avatar_id,
    version: config.version,
    loaderUrl: config.loader_url,
    dataUrl: config.data_url,
    frameworkUrl: config.framework_url,
    codeUrl: config.wasm_url,
    streamingAssetsUrl: config.streaming_assets_url,
    fallbackUrl: config.fallback_url,
    bridgeObjectName: config.bridge_object_name,
    expiresAt: config.expires_at,
  };
}
