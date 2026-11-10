import { LoadingOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import styles from './CloudPanoramaViewer.module.css';

interface PanoramaViewpoint {
  id: string;
  index: string;
  title: string;
  url: string;
}

const panoramaViewpoints: PanoramaViewpoint[] = [
  {
    id: 'axis-aerial',
    index: '01',
    title: '中轴航拍',
    url: 'https://www.720yun.com/t/9a724wsOq4s?scene_id=205912',
  },
  {
    id: 'buddha-closeup',
    index: '02',
    title: '大佛近景',
    url: 'https://www.720yun.com/t/bcvkseiygpq?scene_id=44482192',
  },
];

export default function CloudPanoramaViewer() {
  const [activeViewId, setActiveViewId] = useState(panoramaViewpoints[0].id);
  const [loadedViewId, setLoadedViewId] = useState('');
  const activeView = useMemo(
    () =>
      panoramaViewpoints.find((viewpoint) => viewpoint.id === activeViewId) ??
      panoramaViewpoints[0],
    [activeViewId],
  );
  const isLoading = loadedViewId !== activeView.id;

  const selectView = (viewpoint: PanoramaViewpoint) => {
    if (viewpoint.id === activeViewId) return;
    setLoadedViewId('');
    setActiveViewId(viewpoint.id);
  };

  return (
    <div className={styles.viewer}>
      <iframe
        key={activeView.id}
        className={styles.panoramaFrame}
        src={activeView.url}
        title={`${activeView.title} 720云全景`}
        allow="autoplay; fullscreen; accelerometer; gyroscope"
        allowFullScreen
        loading="eager"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => setLoadedViewId(activeView.id)}
      />

      {isLoading ? (
        <div className={styles.loadingState} role="status" aria-live="polite">
          <LoadingOutlined spin aria-hidden="true" />
          <strong>正在进入 {activeView.title}</strong>
          <span>正在加载 720° 全景画面</span>
        </div>
      ) : null}

      <nav className={styles.viewSwitcher} aria-label="全景视角">
        <div className={styles.viewList}>
          {panoramaViewpoints.map((viewpoint) => {
            const isActive = viewpoint.id === activeView.id;
            return (
              <button
                key={viewpoint.id}
                type="button"
                className={isActive ? styles.viewButtonActive : styles.viewButton}
                aria-pressed={isActive}
                onClick={() => selectView(viewpoint)}
              >
                <span>{viewpoint.index}</span>
                <strong>{viewpoint.title}</strong>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
