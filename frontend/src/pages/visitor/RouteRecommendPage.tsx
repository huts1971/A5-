import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PreferenceForm from '../../components/scenic/PreferenceForm';
import RouteMapWorkbench from '../../components/scenic/RouteMapWorkbench';
import { createRouteDraft } from '../../api/routeDrafts';
import { recommendRoutes } from '../../api/routes';
import { createTour } from '../../api/tours';
import type { RoutePlan, RoutePreferenceInput } from '../../types/scenic';
import {
  buildGuideRouteContextFromDraft,
  buildGuideRouteContextFromRoutePlan,
  buildGuideRouteContextFromTour,
} from '../../utils/guideRouteContext';
import {
  defaultVisitorPreference,
  loadVisitorPreference,
  preferenceFromSearchParams,
  preferenceToSearchParams,
  saveVisitorPreference,
} from '../../utils/visitorProfile';
import {
  loadRouteRecommendationSession,
  saveRouteEntrySession,
  saveGuideRouteContext,
  saveRouteRecommendationSession,
} from '../../utils/visitorSessionState';
import styles from './RouteRecommendPage.module.css';

export default function RouteRecommendPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const profileKey = searchParams.toString();
  const urlPreference = useMemo(() => preferenceFromSearchParams(searchParams), [profileKey]);
  const [initialRouteSession] = useState(() => loadRouteRecommendationSession());
  const [routes, setRoutes] = useState<RoutePlan[]>(() => initialRouteSession?.routes ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [creatingRouteId, setCreatingRouteId] = useState('');
  const [startingRouteId, setStartingRouteId] = useState('');
  const [preference, setPreference] = useState<RoutePreferenceInput>(() =>
    initialRouteSession?.preference ?? urlPreference,
  );

  useEffect(() => {
    document.body.classList.add('route-workbench-active');
    return () => {
      document.body.classList.remove('route-workbench-active');
    };
  }, []);

  const loadRoutes = (values: RoutePreferenceInput, options: { preserveOtherMaps?: boolean } = {}) => {
    saveVisitorPreference(values);
    setPreference(values);
    setLoading(true);
    setError('');
    recommendRoutes(values)
      .then((nextRoutes) => {
        setRoutes((currentRoutes) => {
          const mergedRoutes = options.preserveOtherMaps
            ? [
                ...currentRoutes.filter((route) => route.mapId !== values.mapId),
                ...nextRoutes,
              ]
            : nextRoutes;
          saveRouteRecommendationSession({
            preference: values,
            routes: mergedRoutes,
          });
          return mergedRoutes;
        });
      })
      .catch(() => setError('路线推荐失败，请稍后重试。'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const hasCachedRoutes = Boolean(initialRouteSession?.routes.length);
    const hasUrlPreference = profileKey.length > 0;
    if (hasCachedRoutes && (!hasUrlPreference || samePreference(initialRouteSession?.preference, urlPreference))) {
      return;
    }
    loadRoutes(hasUrlPreference ? urlPreference : loadVisitorPreference());
  }, []);

  const guideParams = preferenceToSearchParams(preference);
  const guideHref = `/guide?${guideParams.toString()}`;

  const editRoute = async (route: RoutePlan) => {
    setCreatingRouteId(route.id);
    setError('');
    try {
      const draft = await createRouteDraft(route, preference);
      saveGuideRouteContext(buildGuideRouteContextFromDraft(draft, route.mapId));
      navigate(`/route-drafts/${draft.id}`);
    } catch {
      setError('路线草稿创建失败，请稍后重试。');
    } finally {
      setCreatingRouteId('');
    }
  };

  const startTour = async (route: RoutePlan) => {
    setStartingRouteId(route.id);
    setError('');
    try {
      const draft = await createRouteDraft(route, {
        ...preference,
        mapId: route.mapId,
      });
      const tour = await createTour(draft.id, route.mapId);
      saveGuideRouteContext(buildGuideRouteContextFromTour(tour, route.mapId));
      saveRouteEntrySession({
        mode: 'recommendation',
        path: `/routes?${preferenceToSearchParams({ ...preference, mapId: route.mapId }).toString()}`,
        skipHydraLoader: true,
      });
      const sceneParams = new URLSearchParams({
        tourId: tour.id,
        mapId: route.mapId,
      });
      navigate(`/scene-guide?${sceneParams.toString()}`);
    } catch {
      setError('开始游览失败，请稍后重试。');
    } finally {
      setStartingRouteId('');
    }
  };

  return (
    <div className={`${styles.page} route-page`} data-testid="route-workbench-page">
      <div className={styles.fluidMesh} aria-hidden="true">
        <span className={`${styles.orb} ${styles.orbOne}`} />
        <span className={`${styles.orb} ${styles.orbTwo}`} />
        <span className={`${styles.orb} ${styles.orbThree}`} />
      </div>
      <div className={styles.content}>
        <h1 className={styles.srOnly}>个性化路线推荐</h1>
        <div className={styles.workspace} data-testid="route-workbench">
          <aside className={`route-filter-column ${styles.preferenceRail}`} data-testid="route-preference-rail">
            <PreferenceForm initialValues={preference} loading={loading} error={error} onSubmit={loadRoutes} />
          </aside>

          <section className={styles.results} data-testid="route-workbench-stage">
            {loading && routes.length === 0 ? (
              <div className={`${styles.statusPanel} ${styles.loadingStatus}`} role="status">
                <span className={styles.statusKicker}>导览生成</span>
                <strong>正在生成路线</strong>
                <p>系统正在计算点位顺序、步行时间和地图路径。</p>
              </div>
            ) : null}
            {error && routes.length === 0 ? (
              <div className={styles.statusPanel} role="alert">
                <span className={styles.statusKicker}>路线异常</span>
                <strong>路线加载失败</strong>
                <p>{error}</p>
                <button type="button" onClick={() => loadRoutes(defaultVisitorPreference)}>
                  [ 重试 ]
                </button>
              </div>
            ) : null}
            {!error && routes.length === 0 && !loading ? (
              <div className={styles.statusPanel}>
                <span className={styles.statusKicker}>待生成路线</span>
                <strong>暂无路线</strong>
                <p>请选择左侧偏好后生成推荐。</p>
              </div>
            ) : null}
            {routes.length > 0 ? (
              <RouteMapWorkbench
                routes={routes}
                creatingRouteId={creatingRouteId}
                startingRouteId={startingRouteId}
                guideHref={guideHref}
                onCreateDraft={editRoute}
                onStartTour={startTour}
                onGuideRoute={(route, activeSpotId) =>
                  saveGuideRouteContext(buildGuideRouteContextFromRoutePlan(route, preference, activeSpotId))
                }
                onMapChange={(mapId) => loadRoutes({ ...preference, mapId }, { preserveOtherMaps: true })}
              />
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

function samePreference(left?: RoutePreferenceInput, right?: RoutePreferenceInput) {
  if (!left || !right) return false;
  return (
    left.mapId === right.mapId &&
    left.durationMinutes === right.durationMinutes &&
    left.physicalLevel === right.physicalLevel &&
    left.interestTags.join('|') === right.interestTags.join('|')
  );
}
