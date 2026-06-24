import { requestJson } from './client';
import { USE_MOCK_API } from './config';
import type {
  ScenicMap,
  ScenicMapPoint,
  ScenicRoutePath,
  RoutingProfile,
  TimeEstimationStatus,
} from '../types/scenic';

export type ScenicMapId = 'ling-shan' | 'nianhua-bay';

interface BackendMapPoint {
  spot_id: string;
  name: string;
  x_ratio: number;
  y_ratio: number;
  point_type: string;
  calibration_status: string;
}

interface BackendScenicMap {
  id: string;
  name: string;
  image_url: string;
  version: string;
  width: number;
  height: number;
  center_lat: number;
  center_lng: number;
  authorization_status: string;
  source_note: string;
  points: BackendMapPoint[];
}

interface BackendRoutePath {
  map_id: ScenicMapId;
  path_complete: boolean;
  network_version?: string | null;
  routing_profile?: RoutingProfile;
  time_estimation_status?: TimeEstimationStatus;
  calibration_confidence?: number;
  map_length_px?: number;
  segments: Array<{
    from_spot_id: string;
    to_spot_id: string;
    via_spot_ids: string[];
    road_edge_ids?: string[];
    points: Array<{ x_ratio: number; y_ratio: number }>;
    walk_minutes?: number | null;
    difficulty: 'low' | 'medium' | 'high';
    accessible: boolean;
    map_length_px?: number;
  }>;
  missing_transitions: Array<{
    from_spot_id: string;
    to_spot_id: string;
  }>;
}

const lingShanFallbackPoints: ScenicMapPoint[] = [
  ['spot_ls_entrance', '景区入口', 0.462791, 0.969331],
  ['spot_ls_001', '灵山大照壁', 0.478509, 0.836011],
  ['spot_ls_002', '五明桥', 0.477632, 0.808365],
  ['spot_ls_003', '佛足坛', 0.484211, 0.734312],
  ['spot_ls_004', '五智门', 0.487281, 0.700741],
  ['spot_ls_005', '菩提大道', 0.489035, 0.670626],
  ['spot_nine_dragons', '九龙灌浴', 0.490789, 0.578801],
  ['spot_ls_007', '降魔浮雕', 0.493421, 0.520546],
  ['spot_ls_008', '阿育王柱', 0.495175, 0.472165],
  ['spot_ls_009', '百子戏弥勒', 0.536842, 0.404036],
  ['spot_xiangfu_temple', '祥符禅寺', 0.499561, 0.367997],
  ['spot_ling_shan_buddha', '灵山大佛', 0.501316, 0.163117],
  ['spot_ls_012', '佛教文化博览馆', 0.501316, 0.19027],
  ['spot_brahma_palace', '灵山梵宫', 0.737281, 0.449949],
  ['spot_five_mudra_mandala', '五印坛城', 0.6642, 0.6663],
  ['spot_ls_015', '曼飞龙塔', 0.806579, 0.608422],
  ['spot_ls_016', '无尽意斋', 0.430263, 0.266297],
].map(([spotId, name, xRatio, yRatio]) => ({
  spotId: String(spotId),
  name: String(name),
  xRatio: Number(xRatio),
  yRatio: Number(yRatio),
  pointType: 'spot',
  calibrationStatus: 'verified',
}));

const nianhuaBayFallbackPoints: ScenicMapPoint[] = [
  ['spot_nh_entrance', '景区入口', 0.326357, 0.850663],
  ['spot_nh_001', '拈花广场', 0.38374, 0.564316],
  ['spot_nh_002', '梵天花海', 0.468293, 0.639585],
  ['spot_nh_003', '香月花街', 0.367073, 0.622426],
  ['spot_nh_004', '拈花堂', 0.387805, 0.550589],
  ['spot_nh_005', '五灯湖', 0.463415, 0.500257],
  ['spot_nh_006', '鹿鸣谷', 0.691463, 0.271019],
].map(([spotId, name, xRatio, yRatio]) => ({
  spotId: String(spotId),
  name: String(name),
  xRatio: Number(xRatio),
  yRatio: Number(yRatio),
  pointType: 'spot',
  calibrationStatus: 'verified',
}));

const fallbackMaps: Record<ScenicMapId, ScenicMap> = {
  'ling-shan': {
    id: 'ling-shan',
    name: '灵山胜境建筑参照图',
    imageUrl: '/scenic/maps/ling-shan-overview-v1.webp',
    version: 'ling-shan-overview-v1',
    width: 941,
    height: 1672,
    centerLat: 31.421388,
    centerLng: 120.102499,
    authorizationStatus: 'pending_confirmation',
    sourceNote: '当前使用随前端发布的灵山地图快照。',
    dataSource: 'fallback',
    points: lingShanFallbackPoints,
  },
  'nianhua-bay': {
    id: 'nianhua-bay',
    name: '拈花湾禅意小镇建筑参照图',
    imageUrl: '/scenic/maps/nianhua-bay-overview-v1.png',
    version: 'nianhua-bay-overview-v1',
    width: 941,
    height: 1672,
    centerLat: 31.49,
    centerLng: 120.06,
    authorizationStatus: 'pending_confirmation',
    sourceNote: '当前使用随前端发布的拈花湾地图快照，景区入口与 6 个景点均已人工标定。',
    dataSource: 'fallback',
    points: nianhuaBayFallbackPoints,
  },
};

function toScenicMap(map: BackendScenicMap): ScenicMap {
  return {
    id: map.id,
    name: map.name,
    imageUrl: map.image_url,
    version: map.version,
    width: map.width,
    height: map.height,
    centerLat: map.center_lat,
    centerLng: map.center_lng,
    authorizationStatus: map.authorization_status,
    sourceNote: map.source_note,
    dataSource: 'api',
    points: map.points.map((point) => ({
      spotId: point.spot_id,
      name: point.name,
      xRatio: point.x_ratio,
      yRatio: point.y_ratio,
      pointType: point.point_type,
      calibrationStatus: point.calibration_status,
    })),
  };
}

const mapPromises = new Map<ScenicMapId, Promise<ScenicMap>>();

export function getScenicMap(mapId: ScenicMapId): Promise<ScenicMap> {
  const existing = mapPromises.get(mapId);
  if (existing) return existing;

  const fallback = fallbackMaps[mapId];
  const request = USE_MOCK_API
    ? Promise.resolve(fallback)
    : requestJson<BackendScenicMap>(`/api/maps/${mapId}`)
        .then(toScenicMap)
        .catch(() => fallback);
  mapPromises.set(mapId, request);
  return request;
}

export function getLingShanMap(): Promise<ScenicMap> {
  return getScenicMap('ling-shan');
}

export async function getScenicRoutePath(
  mapId: ScenicMapId,
  spotIds: string[],
  routingProfile: RoutingProfile = 'fastest',
): Promise<ScenicRoutePath> {
  const empty: ScenicRoutePath = {
    mapId,
    pathComplete: spotIds.length <= 1,
    routingProfile,
    timeEstimationStatus: 'unavailable',
    calibrationConfidence: 0,
    mapLengthPx: 0,
    segments: [],
    missingTransitions: spotIds.slice(1).map((spotId, index) => ({
      fromSpotId: spotIds[index],
      toSpotId: spotId,
    })),
  };
  if (spotIds.length <= 1 || USE_MOCK_API) {
    return empty;
  }
  try {
    const response = await requestJson<BackendRoutePath, unknown>(
      `/api/maps/${mapId}/route-path`,
      {
        method: 'POST',
        body: {
          spot_ids: spotIds,
          routing_profile: routingProfile,
        },
      },
    );
    return {
      mapId: response.map_id,
      pathComplete: response.path_complete,
      networkVersion: response.network_version ?? undefined,
      routingProfile: response.routing_profile ?? routingProfile,
      timeEstimationStatus: response.time_estimation_status ?? 'unavailable',
      calibrationConfidence: response.calibration_confidence ?? 0,
      mapLengthPx: response.map_length_px ?? 0,
      segments: response.segments.map((segment) => ({
        fromSpotId: segment.from_spot_id,
        toSpotId: segment.to_spot_id,
        viaSpotIds: segment.via_spot_ids,
        roadEdgeIds: segment.road_edge_ids ?? [],
        points: segment.points.map((point) => ({
          xRatio: point.x_ratio,
          yRatio: point.y_ratio,
        })),
        walkMinutes: segment.walk_minutes ?? undefined,
        difficulty: segment.difficulty,
        accessible: segment.accessible,
        mapLengthPx: segment.map_length_px ?? 0,
      })),
      missingTransitions: response.missing_transitions.map((transition) => ({
        fromSpotId: transition.from_spot_id,
        toSpotId: transition.to_spot_id,
      })),
    };
  } catch {
    return empty;
  }
}

export function getMapIdForSpotIds(spotIds: string[]): ScenicMapId {
  const nianhuaCount = spotIds.filter((spotId) => spotId.startsWith('spot_nh_')).length;
  return nianhuaCount > spotIds.length - nianhuaCount ? 'nianhua-bay' : 'ling-shan';
}
