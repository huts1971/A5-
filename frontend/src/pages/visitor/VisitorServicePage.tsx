import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import GuideServiceMapPanel from '../../components/guide/GuideServiceMapPanel';
import {
  isGuideServiceCategory,
  type GuideServiceCategory,
} from '../../components/guide/guideService';
import GuideHeatmapPanel from '../../components/heatmap/GuideHeatmapPanel';
import styles from './VisitorServicePage.module.css';

type VisitorServiceRouteParam = GuideServiceCategory | 'heatmap';

function normalizeServiceId(value: string | undefined): VisitorServiceRouteParam | undefined {
  if (value === 'heatmap') return value;
  if (value && isGuideServiceCategory(value)) return value;
  return undefined;
}

export default function VisitorServicePage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const normalizedServiceId = normalizeServiceId(serviceId);

  useEffect(() => {
    document.body.classList.add('service-workbench-active');
    return () => {
      document.body.classList.remove('service-workbench-active');
    };
  }, []);

  if (!normalizedServiceId) {
    return <Navigate to="/services/heatmap" replace />;
  }

  return (
    <section className={styles.page} aria-label="景区服务">
      <div className={styles.frame}>
        {normalizedServiceId === 'heatmap' ? (
          <GuideHeatmapPanel open presentation="page" />
        ) : (
          <GuideServiceMapPanel
            activeCategory={normalizedServiceId}
            open
            presentation="page"
          />
        )}
      </div>
    </section>
  );
}
