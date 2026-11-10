import { requestJson } from './client';
import { USE_MOCK_API } from './config';
import { scenicSpots } from './mock/visitorData';
import { resolveSpotImage } from './spotImages';
import type { ScenicSpot, SpotCollectionStats } from '../types/scenic';

const wait = (ms = 240) => new Promise((resolve) => window.setTimeout(resolve, ms));
const spotCache = new Map<string, ScenicSpot>();
let spotListCache: ScenicSpot[] | undefined;

interface BackendSpot {
  id: string;
  name: string;
  summary: string;
  story?: string;
  tags: string[];
  visit_minutes: number;
  crowd_types?: string[];
  image_url?: string;
}

interface BackendSpotList {
  items: BackendSpot[];
  total: number;
}

interface BackendSpotSummary {
  listed_spot_count: number;
  collected_spot_count: number;
}

function inferCrowdTypes(spot: BackendSpot): string[] {
  if (spot.id.endsWith('_entrance')) {
    return ['所有游客', '路线规划'];
  }

  const values: string[] = [];
  const add = (value: string) => {
    if (!values.includes(value)) {
      values.push(value);
    }
  };

  if (/(大佛|佛足|禅寺|坛城)/.test(spot.name)) {
    add('礼佛');
  }
  if (spot.tags.includes('佛教文化')) {
    add('研学');
  }
  if (spot.tags.includes('建筑艺术')) {
    add('建筑');
  }
  if (spot.tags.includes('演艺亲子')) {
    add('亲子');
  }
  if (spot.tags.includes('摄影打卡')) {
    add('拍照');
  }
  if (spot.tags.includes('自然休闲')) {
    add('休闲');
  }
  if (spot.tags.includes('室内体验')) {
    add('室内');
  }

  return values.slice(0, 3);
}

function toScenicSpot(spot: BackendSpot): ScenicSpot {
  const crowdTypes = spot.crowd_types?.length ? spot.crowd_types : inferCrowdTypes(spot);

  return {
    id: spot.id,
    name: spot.name,
    subtitle: spot.tags.slice(0, 2).join(' / ') || '灵山胜境',
    summary: spot.summary,
    story: spot.story ?? spot.summary,
    tags: spot.tags,
    crowdTypes,
    durationMinutes: spot.visit_minutes,
    openInfo: '请以景区现场公告为准',
    serviceHint: '可结合现场导览标识安排游览顺序。',
    coverTone: spot.tags.includes('服务') ? 'service' : 'culture',
    imageUrl: resolveSpotImage(spot.id, spot.image_url),
    highlights: spot.tags.slice(0, 3),
  };
}

function cacheSpots(spots: ScenicSpot[]) {
  spots.forEach((spot) => spotCache.set(spot.id, spot));
  spotListCache = spots;
}

export function getCachedSpotDetail(spotId: string): ScenicSpot | undefined {
  return spotCache.get(spotId) ?? spotListCache?.find((spot) => spot.id === spotId);
}

export async function getSpots(): Promise<ScenicSpot[]> {
  if (!USE_MOCK_API) {
    const response = await requestJson<BackendSpotList>('/api/spots');
    const spots = response.items.map(toScenicSpot);
    cacheSpots(spots);
    return spots;
  }

  await wait();
  const spots = scenicSpots.map((spot) => ({
    ...spot,
    imageUrl: resolveSpotImage(spot.id, spot.imageUrl),
  }));
  cacheSpots(spots);
  return spots;
}

export async function getSpotCollectionStats(): Promise<SpotCollectionStats> {
  if (!USE_MOCK_API) {
    const response = await requestJson<BackendSpotSummary>('/api/spots/summary');
    return {
      listedSpotCount: response.listed_spot_count,
      collectedSpotCount: response.collected_spot_count,
    };
  }

  await wait();
  return {
    listedSpotCount: scenicSpots.length,
    collectedSpotCount: scenicSpots.length,
  };
}

export async function getSpotDetail(spotId: string): Promise<ScenicSpot | undefined> {
  if (!USE_MOCK_API) {
    const response = await requestJson<BackendSpot>(`/api/spots/${encodeURIComponent(spotId)}`);
    const spot = toScenicSpot(response);
    spotCache.set(spot.id, spot);
    return spot;
  }

  await wait();
  const spot = scenicSpots.find((item) => item.id === spotId);
  const normalizedSpot = spot
    ? {
        ...spot,
        imageUrl: resolveSpotImage(spot.id, spot.imageUrl),
      }
    : undefined;
  if (normalizedSpot) spotCache.set(normalizedSpot.id, normalizedSpot);
  return normalizedSpot;
}
