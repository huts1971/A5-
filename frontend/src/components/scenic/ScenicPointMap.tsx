import { useState } from 'react';
import { EnvironmentFilled } from '@ant-design/icons';
import type { ScenicMap, ScenicRoutePath } from '../../types/scenic';
import styles from './ScenicPointMap.module.css';

export interface ScenicPointMapProps {
  map: ScenicMap;
  routeSpotIds: string[];
  routePath?: ScenicRoutePath;
  completedSpotIds?: string[];
  activeSpotId?: string;
  onSpotActivate?: (spotId: string) => void;
  onSpotPreview?: (spotId: string) => void;
}

export default function ScenicPointMap({
  map,
  routeSpotIds,
  routePath,
  completedSpotIds = [],
  activeSpotId,
  onSpotActivate,
  onSpotPreview,
}: ScenicPointMapProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const routeOrder = new Map(routeSpotIds.map((spotId, index) => [spotId, index + 1]));
  const completed = new Set(completedSpotIds);
  const activeRouteIndex = activeSpotId ? routeSpotIds.indexOf(activeSpotId) : -1;

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
    <div className={styles.shell}>
      <div className={styles.viewport}>
        <img
          className={styles.image}
          src={map.imageUrl}
          alt={`${map.name}，仅用于表达景点位置与游览顺序`}
          width={map.width}
          height={map.height}
          draggable={false}
          onError={() => setImageFailed(true)}
        />
        <div className={styles.scrim} />
        {routePath?.segments.length ? (
          <svg
            className={styles.routeOverlay}
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            aria-label="人工校准的游览路径指引"
          >
            {routePath.segments.map((segment) => {
              const isCurrent = segment.fromSpotId === activeSpotId;
              const targetIndex = routeSpotIds.indexOf(segment.toSpotId);
              const isCompleted =
                completed.size > 0 &&
                targetIndex >= 0 &&
                targetIndex <= activeRouteIndex;
              const className = [
                styles.routeLine,
                isCompleted ? styles.routeLineCompleted : '',
                isCurrent ? styles.routeLineCurrent : '',
              ].filter(Boolean).join(' ');
              const points = segment.points
                .map((point) => `${point.xRatio * 1000},${point.yRatio * 1000}`)
                .join(' ');
              return (
                <polyline
                  key={`${segment.fromSpotId}-${segment.toSpotId}`}
                  className={className}
                  points={points}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        ) : null}
        {map.points.map((point) => {
          const sequence = routeOrder.get(point.spotId);
          const isActive = activeSpotId === point.spotId;
          const classNames = [
            styles.marker,
            sequence ? styles.markerRoute : '',
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
                  point.xRatio > 0.7 ? styles.markerLabelLeft : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {point.name}
              </span>
            </button>
          );
        })}
        <div className={styles.legend} aria-label="地图图例">
          <span className={styles.legendItem}>
            <EnvironmentFilled className={styles.legendDot} />
            已标定
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendRoute}>
              <EnvironmentFilled />
              <b>1</b>
            </span>
            当前路线
          </span>
          {routePath ? (
            <span className={styles.legendItem}>
              <span className={styles.legendPath} />
              {routePath.pathComplete
                ? routePath.timeEstimationStatus === 'map_estimate'
                  ? '真实路网指引'
                  : '道路指引'
                : '部分路径待补充'}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
