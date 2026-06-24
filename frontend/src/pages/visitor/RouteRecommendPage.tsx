import { useEffect, useState } from 'react';
import { Button, Space, Typography } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import EmptyState from '../../components/common/EmptyState';
import PreferenceForm from '../../components/scenic/PreferenceForm';
import RouteCard from '../../components/scenic/RouteCard';
import RouteMapWorkbench from '../../components/scenic/RouteMapWorkbench';
import { createRouteDraft } from '../../api/routeDrafts';
import { recommendRoutes } from '../../api/routes';
import { createTour } from '../../api/tours';
import type { RoutePlan, RoutePreferenceInput } from '../../types/scenic';
import {
  buildPreferenceGuideQuestion,
  defaultVisitorPreference,
  loadVisitorPreference,
  preferenceToSearchParams,
  saveVisitorPreference,
} from '../../utils/visitorProfile';
import styles from './RouteRecommendPage.module.css';

export default function RouteRecommendPage() {
  const navigate = useNavigate();
  const [routes, setRoutes] = useState<RoutePlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [creatingRouteId, setCreatingRouteId] = useState('');
  const [startingRouteId, setStartingRouteId] = useState('');
  const [preference, setPreference] = useState<RoutePreferenceInput>(() => loadVisitorPreference());

  const loadRoutes = (values: RoutePreferenceInput) => {
    saveVisitorPreference(values);
    setPreference(values);
    setLoading(true);
    setError('');
    recommendRoutes(values)
      .then(setRoutes)
      .catch(() => setError('路线推荐失败，请稍后重试。'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadRoutes(loadVisitorPreference());
  }, []);

  const guideParams = preferenceToSearchParams(preference);
  guideParams.set('question', buildPreferenceGuideQuestion(preference));
  const guideHref = `/guide?${guideParams.toString()}`;

  const editRoute = async (route: RoutePlan) => {
    setCreatingRouteId(route.id);
    setError('');
    try {
      const draft = await createRouteDraft(route, preference);
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
      navigate(`/tour/${tour.id}`);
    } catch {
      setError('开始游览失败，请稍后重试。');
    } finally {
      setStartingRouteId('');
    }
  };

  return (
    <div className={`${styles.page} route-page`}>
      <Space className="video-page-heading" direction="vertical" size={6}>
        <Typography.Text className="mono-label">[ ROUTE SYSTEM ]</Typography.Text>
        <Typography.Title level={1} style={{ margin: 0 }}>
          个性化路线推荐
        </Typography.Title>
      </Space>

      <div className={styles.guideAction}>
        <Link to={guideHref}>
          <Button type="primary" size="small" data-cue="[ GUIDE ]">
            [ GUIDE ]
          </Button>
        </Link>
      </div>

      <div className={styles.workspace}>
        <aside className={`route-filter-column ${styles.preferenceRail}`}>
          <PreferenceForm initialValues={preference} loading={loading} error={error} onSubmit={loadRoutes} />
        </aside>

        <main className={styles.results}>
          {loading ? <RouteCard loading /> : null}
          {error ? <RouteCard error={error} onRetry={() => loadRoutes(defaultVisitorPreference)} /> : null}
          {!error && routes.length === 0 && !loading ? (
            <EmptyState title="暂无路线" description="请选择偏好后生成推荐。" />
          ) : null}
          {!loading && !error && routes.length > 0 ? (
            <RouteMapWorkbench
              routes={routes}
              creatingRouteId={creatingRouteId}
              startingRouteId={startingRouteId}
              onCreateDraft={editRoute}
              onStartTour={startTour}
              onMapChange={(mapId) => loadRoutes({ ...preference, mapId })}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
