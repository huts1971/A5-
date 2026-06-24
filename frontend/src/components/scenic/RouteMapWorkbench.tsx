import { useEffect, useMemo, useState } from 'react';
import { getScenicMap, type ScenicMapId } from '../../api/maps';
import useScenicRoutePath from '../../hooks/useScenicRoutePath';
import type { RoutePlan, ScenicMap } from '../../types/scenic';
import RouteCard from './RouteCard';
import ScenicPointMap from './ScenicPointMap';
import styles from './RouteMapWorkbench.module.css';

const mapOptions: Array<{ id: ScenicMapId; label: string }> = [
  { id: 'ling-shan', label: '灵山胜境' },
  { id: 'nianhua-bay', label: '拈花湾' },
];

export interface RouteMapWorkbenchProps {
  routes: RoutePlan[];
  creatingRouteId?: string;
  startingRouteId?: string;
  onCreateDraft?: (route: RoutePlan) => void;
  onStartTour?: (route: RoutePlan) => void;
  onMapChange?: (mapId: ScenicMapId) => void;
}

export default function RouteMapWorkbench({
  routes,
  creatingRouteId,
  startingRouteId,
  onCreateDraft,
  onStartTour,
  onMapChange,
}: RouteMapWorkbenchProps) {
  const [maps, setMaps] = useState<Partial<Record<ScenicMapId, ScenicMap>>>({});
  const [activeMapId, setActiveMapId] = useState<ScenicMapId>(
    routes[0]?.mapId ?? 'ling-shan',
  );
  const mapRoutes = routes.filter((item) => item.mapId === activeMapId);
  const route = mapRoutes[0];
  const map = maps[activeMapId];
  const [activeSpotId, setActiveSpotId] = useState(route?.spots[0]?.spotId);
  const [scrollToActive, setScrollToActive] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([getScenicMap('ling-shan'), getScenicMap('nianhua-bay')]).then(
      ([lingShanMap, nianhuaBayMap]) => {
        if (!active) return;
        setMaps({
          'ling-shan': lingShanMap,
          'nianhua-bay': nianhuaBayMap,
        });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const mappedSpotIds = useMemo(
    () =>
      new Set(
        Object.values(maps).flatMap((scenicMap) =>
          scenicMap ? scenicMap.points.map((point) => point.spotId) : [],
        ),
      ),
    [maps],
  );

  useEffect(() => {
    const nextMapId = routes[0]?.mapId;
    if (nextMapId && !routes.some((item) => item.mapId === activeMapId)) {
      setActiveMapId(nextMapId);
    }
  }, [activeMapId, routes]);

  useEffect(() => {
    if (!map) {
      return;
    }
    const firstRouteSpotOnMap = route?.spots.find((spot) =>
      map.points.some((point) => point.spotId === spot.spotId),
    );
    setActiveSpotId(firstRouteSpotOnMap?.spotId ?? map.points[0]?.spotId ?? '');
    setScrollToActive(false);
  }, [map, route?.id, route?.spots]);

  const routeSpotIds = useMemo(
    () => route?.spots.map((spot) => spot.spotId) ?? [],
    [route?.spots],
  );
  const routePath = useScenicRoutePath(
    activeMapId,
    routeSpotIds,
    route?.routingProfile ?? 'fastest',
  );

  if (!route) {
    return null;
  }

  return (
    <section className={styles.shell} aria-label={`${route.name} 地图路线工作台`}>
      <div className={styles.mapPanel}>
        {map ? (
          <>
            <header className={styles.mapHeader}>
              <span className={styles.mapTitle}>{map.name}</span>
              <div className={styles.mapSwitcher} role="tablist" aria-label="切换景区地图">
                {mapOptions.map((option) => {
                  const selected = option.id === activeMapId;
                  return (
                    <button
                      key={option.id}
                      className={[
                        styles.mapSwitch,
                        selected ? styles.mapSwitchActive : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => {
                        setActiveMapId(option.id);
                        onMapChange?.(option.id);
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </header>
            <ScenicPointMap
              map={map}
              routeSpotIds={routeSpotIds}
              routePath={routePath}
              activeSpotId={activeSpotId}
              onSpotActivate={(spotId) => {
                setScrollToActive(true);
                setActiveSpotId(spotId);
              }}
              onSpotPreview={(spotId) => {
                setScrollToActive(false);
                setActiveSpotId(spotId);
              }}
            />
          </>
        ) : (
          <div className={styles.loading}>正在加载建筑参照图</div>
        )}
      </div>
      <div className={styles.routePanel}>
        <div className={styles.routeActions}>
          <button
            className={styles.startButton}
            type="button"
            data-testid="start-recommended-tour"
            disabled={Boolean(creatingRouteId || startingRouteId)}
            onClick={() => onStartTour?.(route)}
          >
            {startingRouteId === route.id
              ? '正在开始游览…'
              : '[ START TOUR ] 开始游览'}
          </button>
          <button
            className={styles.editButton}
            type="button"
            data-testid="create-route-draft"
            disabled={Boolean(creatingRouteId || startingRouteId)}
            onClick={() => onCreateDraft?.(route)}
          >
            {creatingRouteId === route.id ? '正在创建草稿…' : '[ EDIT ROUTE ] 编辑这条路线'}
          </button>
        </div>
        <div className={styles.routeCard}>
          <RouteCard
            route={route}
            activeSpotId={activeSpotId}
            mappedSpotIds={mappedSpotIds}
            scrollToActive={scrollToActive}
            onSpotActivate={(spotId) => {
              setScrollToActive(false);
              setActiveSpotId(spotId);
            }}
          />
        </div>
      </div>
    </section>
  );
}
