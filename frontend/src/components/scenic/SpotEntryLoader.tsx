import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './SpotEntryLoader.module.css';

const DEFAULT_DURATION_MS = 1500;
const EXIT_DURATION_MS = 420;

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ');
}

interface SpotEntryLoaderProps {
  onComplete: () => void;
  durationMs?: number;
  preserveHeader?: boolean;
}

export default function SpotEntryLoader({
  onComplete,
  durationMs = DEFAULT_DURATION_MS,
  preserveHeader = false,
}: SpotEntryLoaderProps) {
  const completedRef = useRef(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    completedRef.current = false;
    setIsLeaving(false);

    const timer = window.setTimeout(() => {
      if (completedRef.current) return;
      completedRef.current = true;
      setIsLeaving(true);
    }, durationMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [durationMs]);

  useEffect(() => {
    if (!isLeaving) return undefined;

    const timer = window.setTimeout(() => {
      onComplete();
    }, EXIT_DURATION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isLeaving, onComplete]);

  const overlay = (
    <div
      className={cx(styles.overlay, preserveHeader && styles.preserveHeader, isLeaving && styles.leaving)}
      data-testid="visitor-spot-entry-loader"
      role="status"
      aria-live="polite"
      aria-label="正在进入景点界面"
    >
      <div className={styles.shell}>
        <div className={styles.loader} aria-hidden="true">
          <div className={`${styles.inner} ${styles.one}`} />
          <div className={`${styles.inner} ${styles.two}`} />
          <div className={`${styles.inner} ${styles.three}`} />
        </div>
        <span className={styles.kicker}>SCENIC SPOTS</span>
        <p className={styles.caption}>正在进入景点界面</p>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
