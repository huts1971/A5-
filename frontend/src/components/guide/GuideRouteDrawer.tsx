import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CloseCircleOutlined,
  CompassOutlined,
  EnvironmentOutlined,
  FlagOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import { Alert, Button, Spin, Tag } from 'antd';
import { getScenicMap } from '../../api/maps';
import { getTour, recordTourEvent } from '../../api/tours';
import useScenicRoutePath from '../../hooks/useScenicRoutePath';
import type {
  GuideLocationAssist,
  GuideLocationAssistStatus,
  GuideRouteContext,
  ScenicMap,
  TourSession,
} from '../../types/scenic';
import { buildGuideRouteContextFromTour } from '../../utils/guideRouteContext';
import ScenicPointMap from '../scenic/ScenicPointMap';
import AmapLocationMap, { type BrowserLocation } from './AmapLocationMap';

interface GuideRouteDrawerProps {
  context?: GuideRouteContext;
  open: boolean;
  disabled?: boolean;
  onClose: () => void;
  onContextChange: (context: GuideRouteContext) => void;
}

type LocationAssistState = GuideLocationAssist;

const emptyLocationAssist: LocationAssistState = {
  mode: 'off',
  status: 'idle',
};

export default function GuideRouteDrawer({
  context,
  open,
  disabled = false,
  onClose,
  onContextChange,
}: GuideRouteDrawerProps) {
  const [map, setMap] = useState<ScenicMap>();
  const [tour, setTour] = useState<TourSession>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [activeSpotId, setActiveSpotId] = useState('');
  const [locationAssist, setLocationAssist] = useState<LocationAssistState>(emptyLocationAssist);
  const [browserLocation, setBrowserLocation] = useState<BrowserLocation>();
  const routeSpotIds = useMemo(
    () => context?.orderedSpots.map((spot) => spot.spotId) ?? [],
    [context?.orderedSpots],
  );
  const completedSpotIds = useMemo(
    () =>
      context?.orderedSpots
        .filter((spot) => spot.status === 'completed' || spot.status === 'skipped')
        .map((spot) => spot.spotId) ?? [],
    [context?.orderedSpots],
  );
  const routePath = useScenicRoutePath(context?.mapId ?? 'ling-shan', routeSpotIds, 'fastest');
  const currentIndex = context?.orderedSpots.length
    ? Math.min(Math.max(context.currentIndex, 0), context.orderedSpots.length - 1)
    : 0;
  const currentSpot = context?.orderedSpots[currentIndex] ?? context?.currentSpot;
  const nextSpot = context?.orderedSpots[currentIndex + 1];
  const isTour = Boolean(context?.tourId && context.status === 'tour');
  const isFinished = Boolean(tour?.status === 'finished' || context?.status === 'expired');
  const progress = context?.orderedSpots.length
    ? Math.round((currentIndex / Math.max(context.orderedSpots.length - 1, 1)) * 100)
    : 0;
  const canMovePrevious = Boolean(context && currentIndex > 0 && !isFinished);
  const canMoveNext = Boolean(context && currentIndex < context.orderedSpots.length - 1 && !isFinished);
  const hasBrowserLocation = Boolean(browserLocation);
  const showLocationMap = Boolean(
    locationAssist.mode === 'browser' &&
    locationAssist.status === 'ready' &&
    browserLocation,
  );
  const locationActionLabel = getLocationActionLabel(locationAssist, hasBrowserLocation);

  useEffect(() => {
    if (!context || !open) return undefined;
    let active = true;
    setMap(undefined);
    getScenicMap(context.mapId).then((result) => {
      if (active) setMap(result);
    });
    return () => {
      active = false;
    };
  }, [context?.mapId, open]);

  useEffect(() => {
    if (!context?.tourId || !open || context.orderedSpots.length > 0) return undefined;
    let active = true;
    setError('');
    getTour(context.tourId)
      .then((result) => {
        if (!active) return;
        setTour(result);
        onContextChange(buildGuideRouteContextFromTour(result, context.mapId));
      })
      .catch(() => {
        if (active) setError('游览会话暂时不可用，当前只显示本地路线状态。');
      });
    return () => {
      active = false;
    };
  }, [context?.tourId, context?.mapId, context?.orderedSpots.length, open, onContextChange]);

  useEffect(() => {
    setActiveSpotId(currentSpot?.spotId ?? context?.orderedSpots[0]?.spotId ?? '');
  }, [context?.orderedSpots, currentSpot?.spotId]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    const saved = context?.locationAssist;
    if (!saved || saved.mode !== 'browser') {
      setLocationAssist(emptyLocationAssist);
      setBrowserLocation(undefined);
      return;
    }
    setLocationAssist({
      ...saved,
    });
  }, [context?.draftId, context?.mapId, context?.routeId, context?.tourId, open]);

  useEffect(() => {
    if (!context || locationAssist.mode !== 'browser' || locationAssist.status !== 'ready') return;
    if (!currentSpot?.spotId || locationAssist.displaySpotId === currentSpot.spotId) return;
    const nextAssist: LocationAssistState = {
      ...locationAssist,
      displaySpotId: currentSpot.spotId,
      updatedAt: Date.now(),
    };
    setLocationAssist(nextAssist);
    onContextChange({
      ...context,
      locationAssist: toContextLocationAssist(nextAssist, currentSpot.spotId),
    });
  }, [
    context,
    currentSpot?.spotId,
    locationAssist,
    onContextChange,
  ]);

  function publishLocationAssist(nextAssist: LocationAssistState, displaySpotId = currentSpot?.spotId) {
    setLocationAssist(nextAssist);
    if (!context) return;
    onContextChange({
      ...context,
      locationAssist: toContextLocationAssist(nextAssist, displaySpotId),
    });
  }

  function enableBrowserLocation() {
    const locatingAssist: LocationAssistState = {
      mode: 'browser',
      status: 'locating',
      displaySpotId: currentSpot?.spotId,
      updatedAt: Date.now(),
    };
    publishLocationAssist(locatingAssist);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setBrowserLocation(undefined);
      publishLocationAssist({
        ...locatingAssist,
        status: 'unsupported',
        updatedAt: Date.now(),
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBrowserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          timestamp: position.timestamp || Date.now(),
        });
        publishLocationAssist({
          mode: 'browser',
          status: 'ready',
          accuracyMeters: position.coords.accuracy,
          displaySpotId: currentSpot?.spotId,
          updatedAt: Date.now(),
        });
      },
      (geoError) => {
        setBrowserLocation(undefined);
        publishLocationAssist({
          mode: 'browser',
          status: toLocationAssistErrorStatus(geoError),
          displaySpotId: currentSpot?.spotId,
          updatedAt: Date.now(),
        });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 8_000,
      },
    );
  }

  function disableLocationAssist() {
    setBrowserLocation(undefined);
    publishLocationAssist({
      mode: 'off',
      status: 'idle',
      updatedAt: Date.now(),
    });
  }

  function moveCurrentSpot(nextIndex: number) {
    if (!context?.orderedSpots.length) return;
    const boundedIndex = Math.min(Math.max(nextIndex, 0), context.orderedSpots.length - 1);
    const orderedSpots = context.orderedSpots.map((spot, index) => ({
      ...spot,
      status: (index < boundedIndex ? 'completed' : index === boundedIndex ? 'current' : 'pending') as
        GuideRouteContext['orderedSpots'][number]['status'],
    }));
    const nextLocationAssist: LocationAssistState =
      locationAssist.mode === 'browser' && locationAssist.status === 'ready'
        ? {
            ...locationAssist,
            displaySpotId: orderedSpots[boundedIndex]?.spotId,
            updatedAt: Date.now(),
          }
        : locationAssist;
    setLocationAssist(nextLocationAssist);
    const nextContext: GuideRouteContext = {
      ...context,
      currentIndex: boundedIndex,
      currentSpot: orderedSpots[boundedIndex],
      nextSpot: orderedSpots[boundedIndex + 1],
      orderedSpots,
      locationAssist: toContextLocationAssist(nextLocationAssist, orderedSpots[boundedIndex]?.spotId),
    };
    setActiveSpotId(orderedSpots[boundedIndex]?.spotId ?? '');
    onContextChange(nextContext);
  }

  async function finishTour() {
    if (!context?.tourId) return;
    setBusy(true);
    setError('');
    try {
      const nextTour = await recordTourEvent(context.tourId, 'tour_finished', currentSpot?.spotId);
      setTour(nextTour);
      onContextChange(buildGuideRouteContextFromTour(nextTour, context.mapId));
    } catch {
      setError('游览进度同步失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const panel = (
    <section className="guide-route-drawer guide-route-panel" role="dialog" aria-label="路线导览">
      {!context ? (
        <div className="guide-route-drawer__empty">
          <CompassOutlined />
          <strong>还没有选择路线</strong>
          <span>先去路线页生成路线，再回来让数字人带你走。</span>
        </div>
      ) : (
        <div className="guide-route-drawer__content">
          {error ? <Alert type="warning" showIcon message={error} /> : null}

          <div
            className="guide-route-drawer__progress"
            aria-label={`游览进度 ${progress}%`}
          >
            <span style={{ width: `${progress}%` }} />
          </div>

          <section
            className={`guide-route-drawer__map ${showLocationMap ? 'guide-route-drawer__map--location' : ''}`}
            aria-label={showLocationMap ? '定位辅助地图' : '路线地图'}
          >
            {showLocationMap && browserLocation ? (
              <AmapLocationMap
                location={browserLocation}
                scenicName={context.scenicName}
                currentSpotName={currentSpot?.name}
              />
            ) : map ? (
              <ScenicPointMap
                map={map}
                routeSpotIds={routeSpotIds}
                routePath={routePath}
                completedSpotIds={completedSpotIds}
                activeSpotId={activeSpotId || currentSpot?.spotId}
                fitToContainer
                panEnabled
                fitScale={2}
                onSpotActivate={setActiveSpotId}
                onSpotPreview={setActiveSpotId}
              />
            ) : (
              <Spin tip="正在加载路线地图" />
            )}
          </section>

          <section className="guide-route-drawer__location" aria-label="定位辅助">
            <div className="guide-route-drawer__location-copy">
              <span>定位辅助</span>
            </div>
            <div className="guide-route-drawer__location-actions">
              <Button
                icon={<EnvironmentOutlined />}
                disabled={disabled || busy || !currentSpot}
                loading={locationAssist.mode === 'browser' && locationAssist.status === 'locating'}
                type={locationAssist.mode === 'browser' && locationAssist.status === 'ready' ? 'primary' : 'default'}
                onClick={enableBrowserLocation}
              >
                {locationActionLabel}
              </Button>
              <Button
                icon={<CloseCircleOutlined />}
                disabled={disabled || busy || locationAssist.mode === 'off'}
                onClick={disableLocationAssist}
              >
                关闭定位
              </Button>
            </div>
          </section>

          <section className="guide-route-drawer__station" aria-label="当前导览站">
            <div className="guide-route-drawer__station-summary">
              <div className="guide-route-drawer__station-copy">
                <span>当前导览站</span>
                <strong>{isFinished ? '本次游览已结束' : currentSpot?.name ?? '路线状态待同步'}</strong>
              </div>
              <div className="guide-route-drawer__station-copy guide-route-drawer__station-copy--next">
                <span>下一站</span>
                <strong>{nextSpot?.name ?? '当前路线没有下一站'}</strong>
              </div>
            </div>
            {currentSpot && !isFinished ? (
              <div className="guide-route-drawer__actions">
                <Button
                  icon={<ArrowLeftOutlined />}
                  disabled={disabled || busy || !canMovePrevious}
                  onClick={() => moveCurrentSpot(currentIndex - 1)}
                >
                  上一站
                </Button>
                <Button
                  type="primary"
                  icon={<ArrowRightOutlined />}
                  disabled={disabled || busy || !canMoveNext}
                  onClick={() => moveCurrentSpot(currentIndex + 1)}
                >
                  下一站
                </Button>
              </div>
            ) : (
              <Alert
                type="info"
                showIcon
                message={isFinished ? '本次游览已结束' : '路线状态暂时不可切换。'}
              />
            )}
          </section>

          <section className="guide-route-drawer__timeline" aria-label="路线点位顺序">
            <div className="guide-route-drawer__timeline-title">
              <NodeIndexOutlined />
              <span>点位顺序</span>
            </div>
            <ol>
              {context.orderedSpots.map((spot, index) => (
                <li
                  key={`${spot.spotId}-${index}`}
                  className={spot.spotId === currentSpot?.spotId ? 'is-current' : ''}
                >
                  <div>
                    <strong>{spot.name}</strong>
                    <small>
                      {spot.status === 'completed'
                        ? '已完成'
                        : spot.status === 'skipped'
                          ? '已跳过'
                          : spot.spotId === currentSpot?.spotId
                            ? '当前站'
                            : '等待游览'}
                    </small>
                  </div>
                  <Tag>{spot.stayMinutes}min</Tag>
                </li>
              ))}
            </ol>
          </section>

          {isTour ? (
            <Button
              className="guide-route-drawer__finish"
              danger
              block
              icon={<FlagOutlined />}
              disabled={disabled || busy}
              loading={busy}
              onClick={() => void finishTour()}
            >
              提前结束本次游览
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );

  return createPortal(panel, document.body);
}

function toContextLocationAssist(
  locationAssist: LocationAssistState,
  displaySpotId?: string,
): GuideLocationAssist {
  if (locationAssist.mode === 'off') {
    return {
      mode: 'off',
      status: 'idle',
      updatedAt: locationAssist.updatedAt,
    };
  }
  return {
    mode: locationAssist.mode,
    status: locationAssist.status,
    accuracyMeters: locationAssist.accuracyMeters,
    displaySpotId,
    updatedAt: locationAssist.updatedAt,
  };
}

function toLocationAssistErrorStatus(error: GeolocationPositionError): GuideLocationAssistStatus {
  if (error.code === error.PERMISSION_DENIED) return 'denied';
  if (error.code === error.TIMEOUT) return 'timeout';
  return 'error';
}

function getLocationActionLabel(locationAssist: LocationAssistState, hasBrowserLocation: boolean): string {
  if (locationAssist.mode === 'browser' && locationAssist.status === 'ready' && hasBrowserLocation) {
    return '重新定位';
  }
  if (locationAssist.mode === 'browser' && locationAssist.status === 'ready') {
    return '打开定位';
  }
  return '打开定位';
}
