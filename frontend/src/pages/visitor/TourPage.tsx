import { useEffect, useMemo, useState } from 'react';
import {
  CheckOutlined,
  EnvironmentOutlined,
  FastForwardOutlined,
  FlagOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Progress, Spin, Tag, Typography, message } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { getMapIdForSpotIds, getScenicMap } from '../../api/maps';
import { getTour, recordTourEvent } from '../../api/tours';
import ScenicPointMap from '../../components/scenic/ScenicPointMap';
import useScenicRoutePath from '../../hooks/useScenicRoutePath';
import type { ScenicMap, TourSession } from '../../types/scenic';
import {
  buildGuideRouteContextFromTour,
  guidePreferenceFromContext,
} from '../../utils/guideRouteContext';
import { preferenceToSearchParams } from '../../utils/visitorProfile';
import { loadTourRecovery, saveTourRecovery } from '../../utils/tourRecovery';
import { saveGuideRouteContext, saveGuideRouteDrawerOpen, saveRouteEntrySession } from '../../utils/visitorSessionState';
import styles from './TourPageInk.module.css';

export default function TourPage() {
  const { tourId = '' } = useParams();
  const navigate = useNavigate();
  const [tour, setTour] = useState<TourSession>();
  const [map, setMap] = useState<ScenicMap>();
  const [busy, setBusy] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.body.classList.add('route-subview-workbench-active');
    return () => {
      document.body.classList.remove('route-subview-workbench-active');
    };
  }, []);

  useEffect(() => {
    let active = true;
    getTour(tourId)
      .then((result) => {
        if (!active) return;
        setTour(result);
        saveTourRecovery(result);
      })
      .catch(() => {
        if (!active) return;
        const recovered = loadTourRecovery(tourId);
        if (recovered) {
          setTour(recovered);
          setRecoveryMode(true);
        } else {
          setError('游览会话加载失败，且本地没有可恢复的最近状态。');
        }
      });
    return () => {
      active = false;
    };
  }, [tourId]);

  const mapId = getMapIdForSpotIds(tour?.spots.map((spot) => spot.spotId) ?? []);

  useEffect(() => {
    let active = true;
    setMap(undefined);
    getScenicMap(mapId).then((result) => active && setMap(result));
    return () => {
      active = false;
    };
  }, [mapId]);

  const currentSpot = tour?.spots[tour.currentIndex];
  const routeSpotIds = useMemo(
    () => tour?.spots.map((spot) => spot.spotId) ?? [],
    [tour?.spots],
  );
  const completedSpotIds = useMemo(
    () =>
      tour?.spots
        .filter((spot) => ['completed', 'skipped'].includes(spot.status))
        .map((spot) => spot.spotId) ?? [],
    [tour?.spots],
  );
  const routePath = useScenicRoutePath(
    mapId,
    routeSpotIds,
    tour?.routingProfile ?? 'fastest',
  );
  const completedCount = useMemo(
    () => tour?.spots.filter((spot) => ['completed', 'skipped'].includes(spot.status)).length ?? 0,
    [tour?.spots],
  );
  const progress = tour?.spots.length
    ? Math.round((completedCount / tour.spots.length) * 100)
    : 0;
  const isTourComplete = Boolean(
    tour && (tour.status !== 'active' || completedCount >= tour.spots.length || !currentSpot),
  );

  useEffect(() => {
    if (!tour) return;
    saveGuideRouteContext(buildGuideRouteContextFromTour(tour, mapId));
    saveRouteEntrySession(
      isTourComplete
        ? {
            mode: 'recommendation',
            path: '/routes',
            skipHydraLoader: true,
          }
        : {
            mode: 'tour',
            path: `/tour/${tour.id}`,
          },
    );
  }, [isTourComplete, mapId, tour]);

  const runEvent = async (
    eventType: 'spot_arrived' | 'spot_completed' | 'spot_skipped' | 'tour_finished',
  ) => {
    if (!tour || recoveryMode) return;
    setBusy(true);
    try {
      const next = await recordTourEvent(tour.id, eventType, currentSpot?.spotId);
      setTour(next);
      saveTourRecovery(next);
      if (next.status === 'finished') {
        navigate(`/tour/${next.id}/recap`);
      }
    } catch {
      saveTourRecovery(tour);
      setRecoveryMode(true);
      message.warning('服务暂时不可用，已保留最近一次游览状态。');
    } finally {
      setBusy(false);
    }
  };

  const openGuide = () => {
    if (!tour) return;
    const context = buildGuideRouteContextFromTour(tour, mapId);
    saveGuideRouteContext(context);
    const params = preferenceToSearchParams(guidePreferenceFromContext(context));
    params.set('openRoute', '1');
    saveGuideRouteDrawerOpen(true);
    navigate(`/guide?${params.toString()}`);
  };

  if (error) {
    return <Alert type="error" showIcon message={error} />;
  }
  if (!tour || !map) {
    return <Spin size="large" tip="正在恢复游览进度" />;
  }

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <Typography.Text className="mono-label">游览会话</Typography.Text>
          <Typography.Title level={1}>{tour.name}</Typography.Title>
        </div>
        <div className={styles.headingActions}>
          <Button
            className={`${styles.inkButton} ${styles.inkButtonSecondary}`}
            onClick={() => navigate(`/route-drafts/${tour.routeDraftId}`)}
          >
            查看路线草稿
          </Button>
          <Button
            className={`${styles.inkButton} ${styles.inkButtonPrimary}`}
            icon={<MessageOutlined />}
            disabled={isTourComplete}
            onClick={openGuide}
          >
            咨询导游
          </Button>
        </div>
      </header>

      {recoveryMode ? (
        <Alert
          type="warning"
          showIcon
          message="当前显示本地保存的最近状态"
          description="服务端暂时不可用。为避免产生两套路线真相，恢复连接前已暂停继续推进。"
        />
      ) : null}

      <div className={styles.progressPanel}>
        <span>{completedCount} / {tour.spots.length} 个景点已处理</span>
        <Progress percent={progress} showInfo={false} strokeColor="#b98931" />
      </div>

      <div className={styles.workspace}>
        <section className={styles.mapPanel}>
          <div className={styles.mapHeader}>
            <span>{map.name}</span>
            <span>{currentSpot ? `第 ${currentSpot.sequence + 1} 站 · ${currentSpot.name}` : '路线已完成'}</span>
          </div>
          <ScenicPointMap
            map={map}
            routeSpotIds={routeSpotIds}
            routePath={routePath}
            completedSpotIds={completedSpotIds}
            activeSpotId={currentSpot?.spotId}
            fitToContainer
            panEnabled
            fitScale={2}
          />
        </section>

        <section className={styles.sessionPanel}>
          {currentSpot ? (
            <Card
              className={styles.currentCard}
              title={`第 ${currentSpot.sequence + 1} 站`}
              extra={<Tag color="blue">当前</Tag>}
            >
              <Typography.Title level={2}>{currentSpot.name}</Typography.Title>
              <Typography.Paragraph>{currentSpot.reason}</Typography.Paragraph>
              <div className={styles.tagRow}>
                <Tag>建议停留 {currentSpot.stayMinutes} 分钟</Tag>
                <Tag>
                  {currentSpot.sequence === 0
                    ? '路线起点'
                    : currentSpot.transitionMinutes == null
                      ? '步行时间待补充'
                      : `上一站至此预计约 ${currentSpot.transitionMinutes} 分钟`}
                </Tag>
              </div>
              <div className={styles.actions}>
                <Button
                  className={`${styles.inkButton} ${styles.inkButtonSecondary}`}
                  icon={<EnvironmentOutlined />}
                  data-testid="tour-arrived"
                  disabled={Boolean(currentSpot.arrivedAt) || recoveryMode}
                  loading={busy}
                  onClick={() => runEvent('spot_arrived')}
                >
                  {currentSpot.arrivedAt ? '已到达' : '标记到达'}
                </Button>
                <Button
                  className={`${styles.inkButton} ${styles.inkButtonPrimary}`}
                  icon={<CheckOutlined />}
                  data-testid="tour-complete"
                  disabled={recoveryMode}
                  loading={busy}
                  onClick={() => runEvent('spot_completed')}
                >
                  完成并前往下一站
                </Button>
                <Button
                  className={`${styles.inkButton} ${styles.inkButtonGhost}`}
                  icon={<FastForwardOutlined />}
                  data-testid="tour-skip"
                  disabled={recoveryMode}
                  loading={busy}
                  onClick={() => runEvent('spot_skipped')}
                >
                  跳过此站
                </Button>
              </div>
            </Card>
          ) : (
            <Card className={styles.doneCard}>
              <Typography.Title level={2}>路线已完成</Typography.Title>
              <Button
                className={`${styles.inkButton} ${styles.inkButtonPrimary}`}
                onClick={() => navigate(`/tour/${tour.id}/recap`)}
              >
                查看行程回顾
              </Button>
            </Card>
          )}

          <div className={styles.timeline}>
            {tour.spots.map((spot, index) => (
              <div
                key={spot.spotId}
                className={[styles.timelineItem, styles[`status_${spot.status}`]]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{spot.name}</strong>
                  <small>
                    {spot.status === 'completed'
                      ? '已完成'
                      : spot.status === 'skipped'
                        ? '已跳过'
                        : spot.status === 'current'
                          ? '当前站点'
                          : '等待游览'}
                  </small>
                </div>
              </div>
            ))}
          </div>

          {tour.status === 'active' ? (
            <Button
              className={`${styles.inkButton} ${styles.inkButtonDanger}`}
              icon={<FlagOutlined />}
              data-testid="tour-finish"
              disabled={recoveryMode}
              loading={busy}
              onClick={() => runEvent('tour_finished')}
            >
              提前结束本次游览
            </Button>
          ) : null}
        </section>
      </div>
    </div>
  );
}
