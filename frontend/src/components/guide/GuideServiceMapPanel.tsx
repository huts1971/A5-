import { useEffect, useMemo, useState } from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { createPortal } from 'react-dom';
import { getScenicMap, type ScenicMapId } from '../../api/maps';
import type { ScenicMap, ScenicMapPoint } from '../../types/scenic';
import ScenicPointMap from '../scenic/ScenicPointMap';
import {
  GUIDE_SERVICE_CATEGORIES,
  isGuideServiceCategory,
  type GuideServiceCategory,
} from './guideService';
import styles from './GuideServiceMapPanel.module.css';

type GuideServiceMapFilter = GuideServiceCategory | 'all';

interface GuideServiceMapPanelProps {
  activeCategory: GuideServiceCategory;
  onClose?: () => void;
  open: boolean;
  presentation?: 'modal' | 'page';
}

const mapOptions: Array<{ id: ScenicMapId; label: string }> = [
  { id: 'ling-shan', label: '灵山胜境' },
  { id: 'nianhua-bay', label: '拈花湾' },
];

const allCategory = {
  id: 'all' as const,
  label: '全部设施',
  description: '显示五类服务设施',
};

function pointMatchesFilter(point: ScenicMapPoint, filter: GuideServiceMapFilter) {
  if (!isGuideServiceCategory(point.pointType)) return false;
  return filter === 'all' || point.pointType === filter;
}

export default function GuideServiceMapPanel({
  activeCategory,
  onClose,
  open,
  presentation = 'modal',
}: GuideServiceMapPanelProps) {
  const [activeMapId, setActiveMapId] = useState<ScenicMapId>('ling-shan');
  const [activeFilter, setActiveFilter] = useState<GuideServiceMapFilter>(activeCategory);
  const [maps, setMaps] = useState<Partial<Record<ScenicMapId, ScenicMap>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activePointId, setActivePointId] = useState('');

  useEffect(() => {
    setActiveFilter(activeCategory);
  }, [activeCategory]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([getScenicMap('ling-shan'), getScenicMap('nianhua-bay')])
      .then(([lingShan, nianhuaBay]) => {
        if (cancelled) return;
        setMaps({ 'ling-shan': lingShan, 'nianhua-bay': nianhuaBay });
      })
      .catch(() => {
        if (!cancelled) setError('地图暂时无法加载，请稍后重试。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || presentation !== 'modal' || !onClose) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open, presentation]);

  const map = maps[activeMapId];
  const visiblePoints = useMemo(
    () => map?.points.filter((point) => pointMatchesFilter(point, activeFilter)) ?? [],
    [activeFilter, map],
  );
  const displayMap = useMemo(
    () => (map ? { ...map, points: visiblePoints } : undefined),
    [map, visiblePoints],
  );
  const activeLabel = activeFilter === 'all'
    ? allCategory.label
    : GUIDE_SERVICE_CATEGORIES.find((item) => item.id === activeFilter)?.label ?? '景区服务';

  useEffect(() => {
    setActivePointId(visiblePoints[0]?.spotId ?? '');
  }, [activeFilter, activeMapId, visiblePoints]);

  if (!open) return null;

  const panel = (
      <section
        className={`${styles.panel} ${presentation === 'page' ? styles.panelPage : ''}`}
        role={presentation === 'modal' ? 'dialog' : 'region'}
        aria-modal={presentation === 'modal' ? true : undefined}
        aria-label="景区服务地图"
        onMouseDown={presentation === 'modal' ? (event) => event.stopPropagation() : undefined}
      >
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h2>{activeLabel}</h2>
          </div>
          <div className={styles.headerActions}>
            <div className={styles.mapTabs} role="tablist" aria-label="切换景区地图">
              {mapOptions.map((option) => (
                <button
                  key={option.id}
                  className={activeMapId === option.id ? styles.mapTabActive : styles.mapTab}
                  type="button"
                  role="tab"
                  aria-selected={activeMapId === option.id}
                  onClick={() => setActiveMapId(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {presentation === 'modal' && onClose ? (
              <button className={styles.closeButton} type="button" aria-label="关闭景区服务地图" onClick={onClose}>
                <CloseOutlined />
              </button>
            ) : null}
          </div>
        </header>

        <div className={styles.body}>
          <main className={styles.mapArea}>
            {displayMap ? (
              <ScenicPointMap
                key={`${displayMap.id}-${activeFilter}`}
                map={displayMap}
                routeSpotIds={[]}
                activeSpotId={activePointId}
                fitToContainer
                panEnabled
                fitWidthScrollable
                serviceTheme
                showPointLabels
                showServicePoints
                onSpotActivate={setActivePointId}
                onSpotPreview={setActivePointId}
              />
            ) : (
              <div className={styles.loading}>{loading ? '正在加载地图…' : '地图暂不可用'}</div>
            )}
            {!loading && !error && visiblePoints.length === 0 ? (
              <div className={styles.emptyOverlay}>
                <strong>还没有{activeLabel}点位</strong>
                <span>请在景区地图标定工具中添加并导出后，这里会自动显示。</span>
              </div>
            ) : null}
            {error ? <div className={styles.emptyOverlay}>{error}</div> : null}
          </main>

          <aside className={styles.pointRail} aria-label={`${activeLabel}点位列表`}>
            <div className={styles.railHeading}>
              <strong>{activeLabel}</strong>
              <span>{visiblePoints.length} 个点位</span>
            </div>
            {visiblePoints.length ? (
              <div className={styles.pointList}>
                {visiblePoints.map((point, index) => (
                  <button
                    key={point.spotId}
                    className={activePointId === point.spotId ? styles.pointItemActive : styles.pointItem}
                    type="button"
                    onClick={() => setActivePointId(point.spotId)}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{point.name}</strong>
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.railEmpty}>点位完成标注后会显示在这里。</p>
            )}
          </aside>
        </div>
      </section>
  );

  if (presentation === 'page') return panel;

  return createPortal(
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      {panel}
    </div>
    , document.body);
}
