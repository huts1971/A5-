import { useEffect, useMemo, useState } from 'react';
import {
  getScenicRoutePath,
  type ScenicMapId,
} from '../api/maps';
import type { RoutingProfile, ScenicRoutePath } from '../types/scenic';

const routePathCache = new Map<string, ScenicRoutePath>();

function createRoutePathCacheKey(
  mapId: ScenicMapId,
  spotIds: string[],
  routingProfile: RoutingProfile,
) {
  return `${mapId}:${routingProfile}:${spotIds.join('|')}`;
}

export function preloadScenicRoutePath(
  mapId: ScenicMapId,
  spotIds: string[],
  routingProfile: RoutingProfile = 'fastest',
) {
  const cacheKey = createRoutePathCacheKey(mapId, spotIds, routingProfile);
  const cached = routePathCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  return getScenicRoutePath(mapId, spotIds, routingProfile).then((result) => {
    routePathCache.set(cacheKey, result);
    return result;
  });
}

export default function useScenicRoutePath(
  mapId: ScenicMapId,
  spotIds: string[],
  routingProfile: RoutingProfile = 'fastest',
) {
  const key = useMemo(() => spotIds.join('|'), [spotIds]);
  const cacheKey = useMemo(() => createRoutePathCacheKey(mapId, spotIds, routingProfile), [key, mapId, routingProfile, spotIds]);
  const [routePath, setRoutePath] = useState<ScenicRoutePath | undefined>(() => routePathCache.get(cacheKey));

  useEffect(() => {
    let active = true;
    const cached = routePathCache.get(cacheKey);
    if (cached) {
      setRoutePath(cached);
      return () => {
        active = false;
      };
    }
    setRoutePath(undefined);
    preloadScenicRoutePath(mapId, spotIds, routingProfile).then((result) => {
      if (active) setRoutePath(result);
    });
    return () => {
      active = false;
    };
  }, [cacheKey, key, mapId, routingProfile]);

  return routePath;
}
