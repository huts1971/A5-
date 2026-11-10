import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './LingShanLoadingOverlay.module.css';

interface LingShanLoadingOverlayProps {
  onComplete?: () => void;
  durationMs?: number;
  className?: string;
  preserveHeader?: boolean;
}

const LOADING_TEXT = '灵山胜境';
const EXIT_DURATION_MS = 420;

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ');
}

export default function LingShanLoadingOverlay({
  onComplete,
  durationMs = 1500,
  className,
  preserveHeader = false,
}: LingShanLoadingOverlayProps) {
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
      onComplete?.();
    }, EXIT_DURATION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isLeaving, onComplete]);

  const overlay = (
    <div
      className={cx(styles.overlay, preserveHeader && styles.preserveHeader, isLeaving && styles.leaving, className)}
      data-testid="visitor-ling-shan-loader"
      role="status"
      aria-label={`${LOADING_TEXT} 加载中`}
    >
      <div className={styles.container}>
        <p className={styles.loadingText} aria-label={LOADING_TEXT} data-testid="visitor-ling-shan-loader-text">
          {LOADING_TEXT.split('').map((letter) => (
            <span key={letter} className={styles.letter} aria-hidden="true">
              {letter}
            </span>
          ))}
        </p>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
