import { useEffect, useMemo, useState } from 'react';
import {
  getScenicRoutePath,
  type ScenicMapId,
} from '../api/maps';
import type { RoutingProfile, ScenicRoutePath } from '../types/scenic';

export default function useScenicRoutePath(
  mapId: ScenicMapId,
  spotIds: string[],
  routingProfile: RoutingProfile = 'fastest',
) {
  const key = useMemo(() => spotIds.join('|'), [spotIds]);
  const [routePath, setRoutePath] = useState<ScenicRoutePath>();

  useEffect(() => {
    let active = true;
    setRoutePath(undefined);
    getScenicRoutePath(mapId, spotIds, routingProfile).then((result) => {
      if (active) setRoutePath(result);
    });
    return () => {
      active = false;
    };
  }, [key, mapId, routingProfile]);

  return routePath;
}
