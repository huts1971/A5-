import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './HydraRouteLoader.module.css';

const maxCharacters = 24;
const progressIntervalMs = 58;
const successHoldMs = 760;
const exitMs = 460;

type LoaderStage = 'booting' | 'success' | 'exiting';

interface HydraRouteLoaderProps {
  onComplete: () => void;
}

export default function HydraRouteLoader({ onComplete }: HydraRouteLoaderProps) {
  const [loadedCharacters, setLoadedCharacters] = useState(0);
  const [stage, setStage] = useState<LoaderStage>('booting');

  useEffect(() => {
    const timers = new Set<number>();
    let progressInterval: number | undefined;

    const schedule = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);
      timers.add(timer);
      return timer;
    };

    progressInterval = window.setInterval(() => {
      setLoadedCharacters((current) => {
        const next = Math.min(current + 1, maxCharacters);
        if (next === maxCharacters) {
          if (progressInterval !== undefined) {
            window.clearInterval(progressInterval);
            progressInterval = undefined;
          }
          schedule(() => setStage('success'), progressIntervalMs);
          schedule(() => setStage('exiting'), progressIntervalMs + successHoldMs);
          schedule(onComplete, progressIntervalMs + successHoldMs + exitMs);
        }
        return next;
      });
    }, progressIntervalMs);

    return () => {
      if (progressInterval !== undefined) window.clearInterval(progressInterval);
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, [onComplete]);

  const loadingPercent = Math.floor((loadedCharacters / maxCharacters) * 100);
  const isBooting = stage === 'booting';

  const loader = (
    <div
      className={[styles.overlay, stage === 'exiting' ? styles.overlayExiting : '']
        .filter(Boolean)
        .join(' ')}
      role="status"
      aria-live="polite"
      aria-label="路线推荐加载中"
      data-testid="route-hydra-loader"
    >
      <HydraTerminal
        ariaHidden={false}
        className={styles.terminal}
        isBooting={isBooting}
        loadingPercent={loadingPercent}
      />
    </div>
  );

  return createPortal(loader, document.body);
}

interface HydraTerminalProps {
  ariaHidden: boolean;
  className: string;
  isBooting: boolean;
  loadingPercent: number;
}

function HydraTerminal({
  ariaHidden,
  className,
  isBooting,
  loadingPercent,
}: HydraTerminalProps) {
  return (
    <div
      className={[className, isBooting ? styles.glitch : ''].filter(Boolean).join(' ')}
      aria-hidden={ariaHidden}
    >
      <div className={styles.mountainLine} />
      <div className={[styles.hydra, isBooting ? '' : styles.hydraSuccess].filter(Boolean).join(' ')}>
        {isBooting ? (
          <div>
            <p className={styles.kicker}>路线导览</p>
            <p>路线生成中</p>
            <p className={styles.textSmall}>正在匹配景点顺序和游览节奏</p>
            <p className={styles.textSmall}>
              进度 <span>{loadingPercent}</span>%
            </p>
            <div className={styles.progressTrack} aria-label={`路线生成进度 ${loadingPercent}%`}>
              <span style={{ width: `${loadingPercent}%` }} />
            </div>
          </div>
        ) : (
          <div>
            <p className={styles.kicker}>路线导览</p>
            <p>路线已准备好</p>
          </div>
        )}
      </div>
    </div>
  );
}
