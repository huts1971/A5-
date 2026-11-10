import { useEffect, useMemo, useState } from 'react';
import { EnvironmentOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { getScenicMap, preloadScenicMapImage, type ScenicMapId } from '../../api/maps';
import useScenicRoutePath, { preloadScenicRoutePath } from '../../hooks/useScenicRoutePath';
import type { RoutePlan, ScenicMap } from '../../types/scenic';
import { loadRouteMapSession, saveRouteMapSession } from '../../utils/visitorSessionState';
import RouteCard from './RouteCard';
import ScenicPointMap, { type ScenicMapCoordinate } from './ScenicPointMap';
import styles from './RouteMapWorkbench.module.css';

const mapOptions: Array<{ id: ScenicMapId; label: string }> = [
  { id: 'ling-shan', label: '灵山胜境' },
  { id: 'nianhua-bay', label: '拈花湾' },
];

const mapDisplayNames: Record<ScenicMapId, string> = {
  'ling-shan': '灵山胜境游览地图',
  'nianhua-bay': '拈花湾游览地图',
};

// Keep route markers readable while revealing more of the map in the wider center pane.
const ROUTE_MAP_FIT_SCALE = 1.6;

export interface RouteMapWorkbenchProps {
  routes: RoutePlan[];
  creatingRouteId?: string;
  startingRouteId?: string;
  guideHref?: string;
  onCreateDraft?: (route: RoutePlan) => void;
  onStartTour?: (route: RoutePlan) => void;
  onGuideRoute?: (route: RoutePlan, activeSpotId?: string) => void;
  onMapChange?: (mapId: ScenicMapId) => void;
}

export default function RouteMapWorkbench({
  routes,
  creatingRouteId,
  startingRouteId,
  guideHref,
  onCreateDraft,
  onStartTour,
  onGuideRoute,
  onMapChange,
}: RouteMapWorkbenchProps) {
  const [initialMapSession] = useState(() => loadRouteMapSession());
  const [maps, setMaps] = useState<Partial<Record<ScenicMapId, ScenicMap>>>({});
  const [activeMapId, setActiveMapId] = useState<ScenicMapId>(
    initialMapSession?.activeMapId ?? routes[0]?.mapId ?? 'ling-shan',
  );
  const [activeRouteId, setActiveRouteId] = useState(
    initialMapSession?.activeRouteId ?? routes[0]?.id ?? '',
  );
  const [pendingMapId, setPendingMapId] = useState<ScenicMapId>();
  const [isRoutePanelOpen, setIsRoutePanelOpen] = useState(Boolean(routes.length));
  const [, setPointerCoordinate] = useState<ScenicMapCoordinate | undefined>();
  const mapRoutes = routes.filter((item) => item.mapId === activeMapId);
  const route = mapRoutes.find((item) => item.id === activeRouteId) ?? mapRoutes[0];
  const map = maps[activeMapId];
  const [activeSpotId, setActiveSpotId] = useState(
    initialMapSession?.activeSpotId ?? route?.spots[0]?.spotId,
  );
  const [scrollToActive, setScrollToActive] = useState(false);
  const routeSpotIds = useMemo(
    () => route?.spots.map((spot) => spot.spotId) ?? [],
    [route?.spots],
  );

  const mapDisplayName = map ? mapDisplayNames[activeMapId] ?? map.name : undefined;

  const pointListRoute = useMemo(
    () => (route ? { ...route, name: '路线顺序' } : undefined),
    [route],
  );

  useEffect(() => {
    let active = true;
    Promise.all([getScenicMap('ling-shan'), getScenicMap('nianhua-bay')]).then(
      ([lingShanMap, nianhuaBayMap]) => {
        if (!active) return;
        setMaps({
          'ling-shan': lingShanMap,
          'nianhua-bay': nianhuaBayMap,
        });
        void Promise.all([
          preloadScenicMapImage(lingShanMap),
          preloadScenicMapImage(nianhuaBayMap),
        ]);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!pendingMapId) return undefined;
    const targetMap = maps[pendingMapId];
    const targetRoutes = routes.filter((item) => item.mapId === pendingMapId);
    const targetRoute = targetRoutes[0];
    if (!targetMap || !targetRoute) return undefined;

    let cancelled = false;
    Promise.all([
      preloadScenicMapImage(targetMap),
      preloadScenicRoutePath(
        pendingMapId,
        targetRoute.spots.map((spot) => spot.spotId),
        targetRoute.routingProfile ?? 'fastest',
      ),
    ]).then(() => {
      if (cancelled) return;
      setActiveMapId(pendingMapId);
      setActiveRouteId(targetRoute.id);
      setActiveSpotId(targetRoute.spots[0]?.spotId ?? '');
      setPointerCoordinate(undefined);
      setPendingMapId(undefined);
    });

    return () => {
      cancelled = true;
    };
  }, [maps, pendingMapId, routes]);

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
    const currentRouteStillAvailable = routes.some(
      (item) => item.id === activeRouteId && item.mapId === activeMapId,
    );
    if (!currentRouteStillAvailable) {
      setActiveRouteId(mapRoutes[0]?.id ?? routes[0]?.id ?? '');
    }
  }, [activeMapId, activeRouteId, mapRoutes, routes]);

  useEffect(() => {
    if (!map) {
      return;
    }
    const firstRouteSpotOnMap = route?.spots.find((spot) =>
      map.points.some((point) => point.spotId === spot.spotId),
    );
    setActiveSpotId((current) => {
      const currentStillVisible = Boolean(
        current &&
          routeSpotIds.includes(current) &&
          map.points.some((point) => point.spotId === current),
      );
      if (currentStillVisible) return current;
      return firstRouteSpotOnMap?.spotId ?? map.points[0]?.spotId ?? '';
    });
    setScrollToActive(false);
  }, [map, route?.id, routeSpotIds]);

  useEffect(() => {
    if (!route) return;
    saveRouteMapSession({
      activeMapId,
      activeRouteId: route.id,
      activeSpotId,
    });
  }, [activeMapId, activeSpotId, route]);

  const routePath = useScenicRoutePath(
    activeMapId,
    routeSpotIds,
    route?.routingProfile ?? 'fastest',
  );

  return (
    <section className={styles.shell} aria-label={`${route?.name ?? '景区'} 地图路线工作台`}>
      <main className={styles.mapPanel} data-testid="route-map-panel">
        {map ? (
          <>
            <header className={styles.mapHeader}>
              <div>
                <span className={styles.mapTitle}>{mapDisplayName}</span>
              </div>
              <div className={styles.mapSwitcher} role="tablist" aria-label="切换景区地图">
                {mapOptions.map((option, index) => {
                  const selected = option.id === activeMapId;
                  return (
                    <div
                      key={option.id}
                      className={[
                        styles.mapSwitchSegment,
                        index === 0 ? styles.mapSwitchOff : styles.mapSwitchOn,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <button
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
                          if (option.id === activeMapId || option.id === pendingMapId) return;
                          setPendingMapId(option.id);
                          onMapChange?.(option.id);
                        }}
                      >
                        {option.label}
                      </button>
                    </div>
                  );
                })}
              </div>
            </header>
            <ScenicPointMap
              map={map}
              routeSpotIds={routeSpotIds}
              routePath={routePath}
              activeSpotId={activeSpotId}
              fitToContainer
              panEnabled
              fitScale={ROUTE_MAP_FIT_SCALE}
              onPointerCoordinateChange={setPointerCoordinate}
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
          <div className={styles.loading} />
        )}
      </main>
      <aside className={styles.rightRail} aria-label="路线地图信息">
        <section className={`${styles.panel} ${styles.pointsPanel}`} data-testid="route-points-panel">
          <div className={styles.panelHeader}>
            <div className={styles.panelTitleGroup}>
              <span className={styles.panelTitle}>路线顺序</span>
              {route ? (
                <span className={styles.panelSpotCount}>
                  <EnvironmentOutlined />
                  {route.spots.length} 个点位
                </span>
              ) : null}
            </div>
            <button
              className={styles.panelToggle}
              type="button"
              aria-expanded={isRoutePanelOpen}
              aria-label={isRoutePanelOpen ? '收起路线顺序' : '展开路线顺序'}
              onClick={() => setIsRoutePanelOpen((current) => !current)}
            >
              {isRoutePanelOpen ? '收起' : '展开'}
            </button>
          </div>
          {isRoutePanelOpen ? (
            <div className={styles.routePanelBody}>
              {mapRoutes.length > 1 ? (
                <div className={styles.routeSelector} aria-label="选择路线">
                  {mapRoutes.map((item, index) => (
                    <button
                      key={item.id}
                      className={[
                        styles.routeChoice,
                        item.id === route?.id ? styles.routeChoiceActive : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      type="button"
                      onClick={() => {
                        setActiveRouteId(item.id);
                        setActiveSpotId(item.spots[0]?.spotId ?? '');
                      }}
                    >
                      路线 {index + 1} · {item.durationMinutes} 分钟
                    </button>
                  ))}
                </div>
              ) : null}
              {route ? (
                <>
                  <div className={styles.routeActions}>
                    <button
                      className={`${styles.actionButton} ${styles.startButton}`}
                      type="button"
                      data-testid="start-recommended-tour"
                      disabled={Boolean(creatingRouteId || startingRouteId)}
                      onClick={() => onStartTour?.(route)}
                    >
                      {startingRouteId === route.id ? '正在开始游览...' : '开始游览'}
                    </button>
                    <button
                      className={`${styles.actionButton} ${styles.editButton}`}
                      type="button"
                      data-testid="create-route-draft"
                      disabled={Boolean(creatingRouteId || startingRouteId)}
                      onClick={() => onCreateDraft?.(route)}
                    >
                      {creatingRouteId === route.id ? '正在创建草稿...' : '编辑路线'}
                    </button>
                    {guideHref ? (
                      <Link
                        className={`${styles.actionButton} ${styles.guideButton}`}
                        to={guideHref}
                        onClick={() => onGuideRoute?.(route, activeSpotId)}
                      >
                        咨询导游
                      </Link>
                    ) : null}
                  </div>
                  <div className={styles.routeCard}>
                    <RouteCard
                      route={pointListRoute ?? route}
                      activeSpotId={activeSpotId}
                      mappedSpotIds={mappedSpotIds}
                      scrollToActive={scrollToActive}
                      onSpotActivate={(spotId) => {
                        setScrollToActive(false);
                        setActiveSpotId(spotId);
                      }}
                    />
                  </div>
                </>
              ) : (
                <div className={styles.emptyPoints}>当前地图暂无推荐路线。</div>
              )}
            </div>
          ) : (
            <div className={styles.collapsedSummary}>
              {route ? `${route.spots.length} 个点位 · ${route.durationMinutes} 分钟` : '暂无路线'}
            </div>
          )}
        </section>
      </aside>
    </section>
  );
}
