import {
  type CSSProperties,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { EnvironmentFilled } from '@ant-design/icons';
import type { ScenicMap, ScenicRoutePath } from '../../types/scenic';
import { isGuideServiceCategory } from '../guide/guideService';
import styles from './ScenicPointMap.module.css';

export interface ScenicMapCoordinate {
  x: number;
  y: number;
  xRatio: number;
  yRatio: number;
}

export interface ScenicPointMapProps {
  map: ScenicMap;
  routeSpotIds: string[];
  routePath?: ScenicRoutePath;
  completedSpotIds?: string[];
  skippedSpotIds?: string[];
  hiddenSpotIds?: string[];
  activeSpotId?: string;
  animateRouteOnce?: boolean;
  panEnabled?: boolean;
  fitToContainer?: boolean;
  fitWidthScrollable?: boolean;
  fitScale?: number;
  serviceTheme?: boolean;
  showPointLabels?: boolean;
  showServicePoints?: boolean;
  onSpotActivate?: (spotId: string) => void;
  onSpotPreview?: (spotId: string) => void;
  onPointerCoordinateChange?: (coordinate?: ScenicMapCoordinate) => void;
}

export default function ScenicPointMap({
  map,
  routeSpotIds,
  routePath,
  completedSpotIds = [],
  skippedSpotIds = [],
  hiddenSpotIds = [],
  activeSpotId,
  animateRouteOnce = false,
  panEnabled = false,
  fitToContainer = false,
  fitWidthScrollable = false,
  fitScale = 1,
  serviceTheme = false,
  showPointLabels = false,
  showServicePoints = false,
  onSpotActivate,
  onSpotPreview,
  onPointerCoordinateChange,
}: ScenicPointMapProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [fitSize, setFitSize] = useState<{ width: number; height: number }>();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const hidden = new Set(hiddenSpotIds);
  const visibleRouteSpotIds = routeSpotIds.filter((spotId) => !hidden.has(spotId));
  const routeOrder = new Map(
    visibleRouteSpotIds.map((spotId, index) => [spotId, index + 1]),
  );
  const visiblePoints = showServicePoints
    ? map.points.filter((point) => !hidden.has(point.spotId))
    : map.points.filter(
        (point) =>
          !hidden.has(point.spotId) &&
          !isGuideServiceCategory(point.pointType),
      );
  const completed = new Set(completedSpotIds);
  const skipped = new Set(skippedSpotIds);
  const activeRouteIndex = activeSpotId
    ? visibleRouteSpotIds.indexOf(activeSpotId)
    : -1;
  const resolvedFitScale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1;
  const isFitScrollable = fitToContainer && panEnabled && (fitWidthScrollable || resolvedFitScale > 1);
  const canDragMap = panEnabled && (!fitToContainer || isFitScrollable);
  const viewportStyle = fitToContainer
    ? fitSize ?? { aspectRatio: `${map.width} / ${map.height}` }
    : undefined;

  useEffect(() => {
    setImageFailed(false);
    setImageReady(false);
  }, [map.imageUrl]);

  useEffect(() => {
    if (!fitToContainer) {
      setFitSize(undefined);
      return undefined;
    }
    const element = shellRef.current;
    if (!element) return undefined;

    const updateFitSize = () => {
      const borderBox = element.getBoundingClientRect();
      const availableWidth =
        isFitScrollable && !fitWidthScrollable ? borderBox.width : element.clientWidth;
      const availableHeight =
        isFitScrollable && !fitWidthScrollable ? borderBox.height : element.clientHeight;
      if (availableWidth <= 0 || availableHeight <= 0) return;
      const mapRatio = map.width / map.height;
      let nextWidth = availableWidth;
      let nextHeight: number;
      if (fitWidthScrollable) {
        nextHeight = nextWidth / mapRatio;
      } else {
        nextHeight = nextWidth / mapRatio;
        if (nextHeight > availableHeight) {
          nextHeight = availableHeight;
          nextWidth = nextHeight * mapRatio;
        }
      }
      const rounded = {
        width: Math.max(1, Math.floor(nextWidth * resolvedFitScale)),
        height: Math.max(1, Math.floor(nextHeight * resolvedFitScale)),
      };
      setFitSize((current) =>
        current &&
        Math.abs(current.width - rounded.width) <= 1 &&
        Math.abs(current.height - rounded.height) <= 1
          ? current
          : rounded,
      );
    };
    updateFitSize();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateFitSize);
      return () => window.removeEventListener('resize', updateFitSize);
    }
    const observer = new ResizeObserver(updateFitSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [
    fitToContainer,
    fitWidthScrollable,
    isFitScrollable,
    map.height,
    map.width,
    resolvedFitScale,
  ]);

  useEffect(() => {
    if (!isFitScrollable || !fitSize || !shellRef.current) {
      return undefined;
    }
    const element = shellRef.current;
    const frame = window.requestAnimationFrame(() => {
      element.scrollLeft = Math.max(0, (element.scrollWidth - element.clientWidth) / 2);
      element.scrollTop = fitWidthScrollable
        ? 0
        : Math.max(0, (element.scrollHeight - element.clientHeight) / 2);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitSize, fitWidthScrollable, isFitScrollable]);

  function updatePointerCoordinate(event: PointerEvent<HTMLDivElement>) {
    if (!onPointerCoordinateChange || !viewportRef.current) {
      return;
    }
    const rect = viewportRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const xRatio = clamp((event.clientX - rect.left) / rect.width);
    const yRatio = clamp((event.clientY - rect.top) / rect.height);
    onPointerCoordinateChange({
      x: Math.round(xRatio * map.width),
      y: Math.round(yRatio * map.height),
      xRatio,
      yRatio,
    });
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    updatePointerCoordinate(event);
    if (!canDragMap || event.button !== 0 || !shellRef.current) {
      return;
    }
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: shellRef.current.scrollLeft,
      scrollTop: shellRef.current.scrollTop,
    };
    shellRef.current.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    updatePointerCoordinate(event);
    const drag = dragState.current;
    if (!canDragMap || !drag || !shellRef.current) {
      return;
    }
    shellRef.current.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
    shellRef.current.scrollTop = drag.scrollTop - (event.clientY - drag.startY);
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragState.current?.pointerId === event.pointerId && shellRef.current?.hasPointerCapture(event.pointerId)) {
      shellRef.current.releasePointerCapture(event.pointerId);
    }
    dragState.current = null;
    setIsDragging(false);
  }

  if (imageFailed) {
    return (
      <div className={styles.shell}>
        <div className={styles.status}>
          地图底图加载失败。路线清单仍可使用，请检查版本化地图资源是否存在。
        </div>
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className={[
        styles.shell,
        panEnabled && !fitToContainer ? styles.shellPannable : '',
        fitToContainer ? styles.shellFit : '',
        isFitScrollable ? styles.shellFitScrollable : '',
        serviceTheme ? styles.serviceTheme : '',
        isDragging ? styles.shellDragging : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={panEnabled || fitToContainer ? 'route-map-scroll-area' : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onPointerLeave={() => onPointerCoordinateChange?.()}
    >
      <div
        ref={viewportRef}
        className={[
          styles.viewport,
          panEnabled && !fitToContainer ? styles.viewportPannable : '',
          fitToContainer ? styles.viewportFit : '',
          isFitScrollable ? styles.viewportFitScrollable : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={viewportStyle}
      >
        <img
          className={styles.image}
          src={map.imageUrl}
          alt={`${map.name}，仅用于表达景点位置与游览顺序`}
          width={map.width}
          height={map.height}
          draggable={false}
          onLoad={() => setImageReady(true)}
          onError={() => setImageFailed(true)}
        />
        {imageReady ? <div className={styles.scrim} /> : null}
        {imageReady && routePath?.segments.length ? (
          <svg
            className={styles.routeOverlay}
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            aria-label="人工校准的游览路径指引"
          >
            {routePath.segments.map((segment, segmentIndex) => {
              const isCurrent = segment.fromSpotId === activeSpotId;
              const targetIndex = visibleRouteSpotIds.indexOf(segment.toSpotId);
              const isSkipped = skipped.has(segment.toSpotId);
              const isCompleted =
                !isSkipped &&
                (completed.has(segment.toSpotId) ||
                  (completed.size > 0 &&
                    targetIndex >= 0 &&
                    targetIndex <= activeRouteIndex));
              const className = [
                styles.routeLine,
                isCompleted ? styles.routeLineCompleted : '',
                isCurrent ? styles.routeLineCurrent : '',
                isSkipped ? styles.routeLineSkipped : '',
                animateRouteOnce ? styles.routeLineDrawOnce : '',
              ].filter(Boolean).join(' ');
              const points = segment.points
                .map((point) => `${point.xRatio * 1000},${point.yRatio * 1000}`)
                .join(' ');
              const routeDrawStep = 2200 / Math.max(routePath.segments.length, 1);
              const drawStyle = animateRouteOnce
                ? ({
                    '--route-draw-delay': `${Math.round(segmentIndex * routeDrawStep)}ms`,
                    '--route-draw-duration': `${Math.max(360, Math.round(routeDrawStep + 180))}ms`,
                  } as CSSProperties)
                : undefined;
              return (
                <polyline
                  key={`${segment.fromSpotId}-${segment.toSpotId}`}
                  className={className}
                  points={points}
                  pathLength={animateRouteOnce ? 1 : undefined}
                  style={drawStyle}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        ) : null}
        {imageReady ? visiblePoints.map((point) => {
          const sequence = routeOrder.get(point.spotId);
          const isActive = activeSpotId === point.spotId;
          const isCompleted = completed.has(point.spotId);
          const isSkipped = skipped.has(point.spotId);
          const classNames = [
            styles.marker,
            sequence ? styles.markerRoute : '',
            isCompleted ? styles.markerCompleted : '',
            isSkipped ? styles.markerSkipped : '',
            isActive ? styles.markerActive : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={point.spotId}
              className={classNames}
              type="button"
              style={{
                left: `${point.xRatio * 100}%`,
                top: `${point.yRatio * 100}%`,
              }}
              aria-label={
                sequence ? `路线第 ${sequence} 站：${point.name}` : `查看景点：${point.name}`
              }
              aria-pressed={isActive}
              data-calibration-status={point.calibrationStatus}
              onClick={() => onSpotActivate?.(point.spotId)}
              onFocus={() => onSpotActivate?.(point.spotId)}
              onMouseEnter={() => onSpotPreview?.(point.spotId)}
            >
              <EnvironmentFilled className={styles.markerIcon} />
              {sequence ? <span className={styles.markerNumber}>{sequence}</span> : null}
              <span
                className={[
                  styles.markerLabel,
                  showPointLabels ? styles.markerLabelVisible : '',
                  point.xRatio > 0.7 ? styles.markerLabelLeft : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {point.name}
              </span>
            </button>
          );
        }) : null}
      </div>
    </div>
  );
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}
