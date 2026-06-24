import type { PhysicalLevel, RoutePreferenceInput } from '../types/scenic';

const STORAGE_KEY = 'a5-ai-guide-visitor-profile';

type RawPreference = {
  mapId?: unknown;
  visitorType?: unknown;
  durationMinutes?: unknown;
  physicalLevel?: unknown;
  interestTags?: unknown;
};

export const defaultVisitorPreference: RoutePreferenceInput = {
  mapId: 'ling-shan',
  durationMinutes: 120,
  physicalLevel: 'medium',
  interestTags: ['佛教文化', '建筑艺术'],
};

export const physicalLevelLabels: Record<PhysicalLevel, string> = {
  low: '低强度',
  medium: '中等强度',
  high: '高强度',
};

export function loadVisitorPreference(): RoutePreferenceInput {
  if (typeof window === 'undefined') {
    return defaultVisitorPreference;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultVisitorPreference;
    }
    return normalizePreference(JSON.parse(raw));
  } catch {
    return defaultVisitorPreference;
  }
}

export function saveVisitorPreference(preference: RoutePreferenceInput) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizePreference(preference)));
}

export function preferenceFromSearchParams(params: URLSearchParams): RoutePreferenceInput {
  const stored = loadVisitorPreference();
  return normalizePreference({
    ...stored,
    mapId: params.get('mapId') ?? stored.mapId,
    durationMinutes: Number(params.get('durationMinutes') ?? stored.durationMinutes),
    physicalLevel: params.get('physicalLevel') ?? stored.physicalLevel,
    interestTags: params.get('interestTags')?.split(',').filter(Boolean) ?? stored.interestTags,
  });
}

export function preferenceToSearchParams(preference: RoutePreferenceInput) {
  const normalized = normalizePreference(preference);
  const params = new URLSearchParams();
  params.set('mapId', normalized.mapId);
  params.set('durationMinutes', String(normalized.durationMinutes));
  params.set('physicalLevel', normalized.physicalLevel);
  params.set('interestTags', normalized.interestTags.join(','));
  return params;
}

export function formatVisitorPreference(preference: RoutePreferenceInput) {
  const mapName = preference.mapId === 'nianhua-bay' ? '拈花湾' : '灵山胜境';
  const physical = physicalLevelLabels[preference.physicalLevel];
  const interests = preference.interestTags.length ? preference.interestTags.join('、') : '暂无特别兴趣';
  return `${mapName}；可游览 ${preference.durationMinutes} 分钟；步行强度 ${physical}；兴趣：${interests}`;
}

export function buildPreferenceGuideQuestion(preference: RoutePreferenceInput) {
  return `我是${formatVisitorPreference(preference)}，请按这个偏好生成游览路线。`;
}

function normalizePreference(value: RawPreference): RoutePreferenceInput {
  const mapId = isMapId(value.mapId) ? value.mapId : defaultVisitorPreference.mapId;
  const physicalLevel = isPhysicalLevel(value.physicalLevel) ? value.physicalLevel : defaultVisitorPreference.physicalLevel;
  const durationMinutes = Number.isFinite(Number(value.durationMinutes)) && Number(value.durationMinutes) > 0
    ? Number(value.durationMinutes)
    : defaultVisitorPreference.durationMinutes;
  const interestTags = normalizeInterestTags(value.interestTags, value.visitorType);

  return {
    mapId,
    durationMinutes,
    physicalLevel,
    interestTags,
  };
}

function isMapId(value: unknown): value is RoutePreferenceInput['mapId'] {
  return ['ling-shan', 'nianhua-bay'].includes(String(value));
}

function isPhysicalLevel(value: unknown): value is PhysicalLevel {
  return ['low', 'medium', 'high'].includes(String(value));
}

function normalizeInterestTags(value: unknown, legacyVisitorType: unknown): string[] {
  const aliases: Record<string, string> = {
    历史: '佛教文化',
    建筑: '建筑艺术',
    艺术: '建筑艺术',
    演艺: '演艺亲子',
    亲子: '演艺亲子',
    摄影: '摄影打卡',
    拍照: '摄影打卡',
    自然: '自然休闲',
    休闲: '自然休闲',
    室内: '室内体验',
  };
  const supported = new Set([
    '佛教文化',
    '建筑艺术',
    '演艺亲子',
    '摄影打卡',
    '自然休闲',
    '室内体验',
  ]);
  const normalized = Array.isArray(value)
    ? value
        .map(String)
        .map((item) => aliases[item] ?? item)
        .filter((item, index, items) => supported.has(item) && items.indexOf(item) === index)
        .slice(0, 2)
    : [];
  if (normalized.length > 0) {
    return normalized;
  }
  const legacyDefaults: Record<string, string[]> = {
    family: ['演艺亲子'],
    culture: ['佛教文化', '建筑艺术'],
    relax: ['自然休闲'],
    photo: ['摄影打卡', '自然休闲'],
  };
  return legacyDefaults[String(legacyVisitorType)] ?? defaultVisitorPreference.interestTags;
}
