import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './GuideEntryLoader.module.css';

const DEFAULT_DURATION_MS = 3000;
const EXIT_DURATION_MS = 420;
const BAR_COUNT = 15;

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ');
}

interface GuideEntryLoaderProps {
  onComplete: () => void;
  durationMs?: number;
  preserveHeader?: boolean;
}

export default function GuideEntryLoader({
  onComplete,
  durationMs = DEFAULT_DURATION_MS,
  preserveHeader = false,
}: GuideEntryLoaderProps) {
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
      data-testid="visitor-guide-entry-loader"
      role="status"
      aria-live="polite"
      aria-label="正在进入导游界面"
    >
      <div className={styles.shell}>
        <div className={styles.loader} aria-hidden="true">
          {Array.from({ length: BAR_COUNT }, (_, index) => (
            <span key={index} />
          ))}
        </div>
        <span className={styles.kicker}>AI GUIDE</span>
        <p className={styles.caption}>正在进入导游界面</p>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
