import { useEffect, useMemo, useRef, useState } from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { createPortal } from 'react-dom';
import { getScenicMap, type ScenicMapId } from '../../api/maps';
import type { ScenicMap } from '../../types/scenic';
import styles from './GuideHeatmapPanel.module.css';

interface HeatmapPoint {
  id: string;
  x_ratio: number;
  y_ratio: number;
  weight: number;
}

interface HeatmapMapData {
  title: string;
  points: HeatmapPoint[];
}

interface HeatmapPayload {
  maps: Record<ScenicMapId, HeatmapMapData>;
}

interface GuideHeatmapPanelProps {
  onClose?: () => void;
  open: boolean;
  presentation?: 'modal' | 'page';
}

const mapOptions: Array<{ id: ScenicMapId; label: string }> = [
  { id: 'ling-shan', label: '灵山胜境' },
  { id: 'nianhua-bay', label: '拈花湾' },
];

const fallbackHeatmap: HeatmapPayload = {
  maps: {
    'ling-shan': { title: '灵山胜境', points: [] },
    'nianhua-bay': { title: '拈花湾', points: [] },
  },
};

function normalizePayload(value: unknown): HeatmapPayload {
  const candidate = value as Partial<HeatmapPayload> | undefined;
  const maps = candidate?.maps;
  if (!maps) return fallbackHeatmap;
  return {
    maps: {
      'ling-shan': {
        title: maps['ling-shan']?.title ?? '灵山胜境',
        points: Array.isArray(maps['ling-shan']?.points) ? maps['ling-shan'].points : [],
      },
      'nianhua-bay': {
        title: maps['nianhua-bay']?.title ?? '拈花湾',
        points: Array.isArray(maps['nianhua-bay']?.points) ? maps['nianhua-bay'].points : [],
      },
    },
  };
}

function drawHeatmap(canvas: HTMLCanvasElement, points: HeatmapPoint[]) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const devicePixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * devicePixelRatio);
  canvas.height = Math.round(height * devicePixelRatio);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const radiusBase = Math.max(34, Math.min(72, width * 0.058));
  points.forEach((point) => {
    const x = point.x_ratio * width;
    const y = point.y_ratio * height;
    const weight = Math.max(1, Number(point.weight) || 1);
    const intensity = Math.min(1, 0.3 + Math.sqrt(weight) / 7);
    const radius = radiusBase * (0.78 + Math.min(1.25, Math.sqrt(weight) / 5));
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(180, 78, 56, ${0.3 * intensity})`);
    gradient.addColorStop(0.27, `rgba(213, 123, 46, ${0.28 * intensity})`);
    gradient.addColorStop(0.62, `rgba(234, 183, 71, ${0.16 * intensity})`);
    gradient.addColorStop(1, 'rgba(247, 220, 133, 0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  });

  points.forEach((point) => {
    const x = point.x_ratio * width;
    const y = point.y_ratio * height;
    const radius = 3.5 + Math.min(3, Math.sqrt(Math.max(1, point.weight)) / 4);
    context.fillStyle = 'rgba(171, 82, 57, 0.82)';
    context.strokeStyle = 'rgba(255, 249, 226, 0.9)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });
}

export default function GuideHeatmapPanel({ onClose, open, presentation = 'modal' }: GuideHeatmapPanelProps) {
  const [activeMapId, setActiveMapId] = useState<ScenicMapId>('ling-shan');
  const [maps, setMaps] = useState<Partial<Record<ScenicMapId, ScenicMap>>>({});
  const [heatmap, setHeatmap] = useState<HeatmapPayload>(fallbackHeatmap);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const map = maps[activeMapId];
  const points = useMemo(() => heatmap.maps[activeMapId]?.points ?? [], [activeMapId, heatmap]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      getScenicMap('ling-shan'),
      getScenicMap('nianhua-bay'),
      fetch('/data/scenic-heatmap-demo.json').then((response) => {
        if (!response.ok) throw new Error('heatmap-data');
        return response.json() as Promise<unknown>;
      }),
    ])
      .then(([lingShan, nianhuaBay, payload]) => {
        if (cancelled) return;
        setMaps({ 'ling-shan': lingShan, 'nianhua-bay': nianhuaBay });
        setHeatmap(normalizePayload(payload));
      })
      .catch(() => {
        if (!cancelled) setError('演示热力图数据暂时无法加载，请检查 public/data/scenic-heatmap-demo.json。');
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

  useEffect(() => {
    if (!open || !map || !stageRef.current || !canvasRef.current) return undefined;
    const render = () => {
      if (canvasRef.current) drawHeatmap(canvasRef.current, points);
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [map, open, points]);

  if (!open) return null;

  const panel = (
      <section
        className={`${styles.panel} ${presentation === 'page' ? styles.panelPage : ''}`}
        role={presentation === 'modal' ? 'dialog' : 'region'}
        aria-modal={presentation === 'modal' ? true : undefined}
        aria-label="游客分布热力图"
        onMouseDown={presentation === 'modal' ? (event) => event.stopPropagation() : undefined}
      >
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h2>游客分布热力图</h2>
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
              <button className={styles.closeButton} type="button" aria-label="关闭游客分布热力图" onClick={onClose}>
                <CloseOutlined />
              </button>
            ) : null}
          </div>
        </header>

        <div className={styles.body}>
          <main className={styles.mapArea}>
            {map ? (
              <>
                <div className={styles.mapToolbar}>
                  <strong>{mapOptions.find((option) => option.id === activeMapId)?.label ?? map.name}</strong>
                  <span>颜色越暖，模拟游客越集中</span>
                </div>
                <div className={styles.mapScroll} data-testid="heatmap-scroll-area">
                  <div
                    ref={stageRef}
                    className={styles.mapStage}
                    style={{ aspectRatio: `${map.width} / ${map.height}` }}
                  >
                    <img className={styles.mapImage} src={map.imageUrl} alt={`${map.name}游客热力图`} />
                    <canvas ref={canvasRef} className={styles.heatCanvas} aria-hidden="true" />
                  </div>
                </div>
                <div className={styles.legend} aria-label="热度由低到高">
                  <span>低</span><span className={styles.legendScale} /><span>高</span>
                </div>
              </>
            ) : (
              <div className={error ? styles.error : styles.loading}>{error || (loading ? '正在加载热力图…' : '地图暂不可用')}</div>
            )}
          </main>
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
