import { useEffect } from 'react';
import CloudPanoramaViewer from '../../components/scenic/CloudPanoramaViewer';
import styles from './PanoramaMapPage.module.css';

export default function PanoramaMapPage() {
  useEffect(() => {
    document.body.classList.add('panorama-workbench-active');
    return () => {
      document.body.classList.remove('panorama-workbench-active');
    };
  }, []);

  return (
    <section className={styles.page} aria-label="灵山胜境全景地图">
      <CloudPanoramaViewer />
    </section>
  );
}
