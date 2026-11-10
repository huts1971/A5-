import { readVisitorToken } from './auth';
import { requestJson } from './client';
import { USE_MOCK_API } from './config';
import {
  DEFAULT_DIGITAL_HUMAN_PERSONA,
  type DigitalHumanPersona,
  type DigitalHumanPersonaConfig,
} from '../types/digitalHumanPersona';


interface BackendDigitalHumanPersona {
  identity: DigitalHumanPersonaConfig['identity'];
  age_mode: DigitalHumanPersonaConfig['ageMode'];
  age_group: DigitalHumanPersonaConfig['ageGroup'];
  exact_age?: number | null;
  gender: DigitalHumanPersonaConfig['gender'];
  personalities: DigitalHumanPersonaConfig['personalities'];
  expression_style: DigitalHumanPersonaConfig['expressionStyle'];
  creative_prompt: string;
  is_customized: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

interface PersonaTextResponse {
  text: string;
}

const MOCK_PERSONA_KEY = 'a5-mock-digital-human-persona';

function visitorHeaders(): Record<string, string> {
  const token = readVisitorToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function toBackendPayload(config: DigitalHumanPersonaConfig) {
  return {
    identity: config.identity,
    age_mode: config.ageMode,
    age_group: config.ageGroup,
    exact_age: config.ageMode === 'exact' ? config.exactAge : undefined,
    gender: config.gender,
    personalities: config.personalities,
    expression_style: config.expressionStyle,
    creative_prompt: config.creativePrompt,
  };
}

function fromBackend(response: BackendDigitalHumanPersona): DigitalHumanPersona {
  return {
    identity: response.identity,
    ageMode: response.age_mode,
    ageGroup: response.age_group,
    exactAge: response.exact_age ?? undefined,
    gender: response.gender,
    personalities: response.personalities,
    expressionStyle: response.expression_style,
    creativePrompt: response.creative_prompt,
    isCustomized: response.is_customized,
    createdAt: response.created_at ?? undefined,
    updatedAt: response.updated_at ?? undefined,
  };
}

function mockPersona(): DigitalHumanPersona {
  try {
    const raw = localStorage.getItem(MOCK_PERSONA_KEY);
    if (raw) return JSON.parse(raw) as DigitalHumanPersona;
  } catch {
    // Keep the mock guide usable when browser storage is unavailable.
  }
  return {
    ...DEFAULT_DIGITAL_HUMAN_PERSONA,
    personalities: [...DEFAULT_DIGITAL_HUMAN_PERSONA.personalities],
    isCustomized: false,
  };
}

export async function getDigitalHumanPersona(): Promise<DigitalHumanPersona> {
  if (USE_MOCK_API) return mockPersona();
  const response = await requestJson<BackendDigitalHumanPersona>(
    '/api/digital-human-persona',
    { headers: visitorHeaders() },
  );
  return fromBackend(response);
}

export async function saveDigitalHumanPersona(
  config: DigitalHumanPersonaConfig,
): Promise<DigitalHumanPersona> {
  if (USE_MOCK_API) {
    const now = new Date().toISOString();
    const saved: DigitalHumanPersona = {
      ...config,
      personalities: [...config.personalities],
      isCustomized: true,
      createdAt: now,
      updatedAt: now,
    };
    localStorage.setItem(MOCK_PERSONA_KEY, JSON.stringify(saved));
    return saved;
  }
  const response = await requestJson<
    BackendDigitalHumanPersona,
    ReturnType<typeof toBackendPayload>
  >('/api/digital-human-persona', {
    method: 'PUT',
    headers: visitorHeaders(),
    body: toBackendPayload(config),
  });
  return fromBackend(response);
}

export async function generateDigitalHumanPersona(
  config: DigitalHumanPersonaConfig,
): Promise<string> {
  if (USE_MOCK_API) {
    return '我会带着你选择的人设视角陪伴旅程，用自然、有画面感的表达讲清沿途看点，也会留意你的节奏与兴趣。遇到景区事实时，我只依据可靠资料，不会为了故事感随意编造。';
  }
  const response = await requestJson<
    PersonaTextResponse,
    ReturnType<typeof toBackendPayload>
  >('/api/digital-human-persona/generate', {
    method: 'POST',
    headers: visitorHeaders(),
    body: toBackendPayload(config),
  });
  return response.text;
}

export async function polishDigitalHumanPersona(
  config: DigitalHumanPersonaConfig,
): Promise<string> {
  if (USE_MOCK_API) {
    return `${config.creativePrompt.trim()} 我会把这份设定融入自然的陪伴与讲解中，让角色更鲜活，同时尊重景区事实与游客的游览节奏。`.slice(0, 1000);
  }
  const response = await requestJson<
    PersonaTextResponse,
    ReturnType<typeof toBackendPayload>
  >('/api/digital-human-persona/polish', {
    method: 'POST',
    headers: visitorHeaders(),
    body: toBackendPayload(config),
  });
  return response.text;
}
