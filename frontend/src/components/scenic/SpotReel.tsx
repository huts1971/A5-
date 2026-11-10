import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fallbackSpotImage } from '../../api/spotImages';
import type { ScenicSpot } from '../../types/scenic';

const AUTO_ROTATION_DURATION_MS = 32_000;
const RESUME_DELAY_MS = 2_500;
const SNAP_DELAY_MS = 160;
const SNAP_DURATION_MS = 420;
const DRAG_THRESHOLD_PX = 8;
const DRAG_DEGREES_PER_PX = 0.28;
const WHEEL_DEGREES_PER_PX = 0.075;

interface SpotReelProps {
  spots: ScenicSpot[];
}

interface ReelGeometry {
  cardWidth: number;
  radius: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  lastX: number;
  dragged: boolean;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function modulo(value: number, base: number) {
  return ((value % base) + base) % base;
}

function nearestEquivalent(target: number, current: number) {
  return target + Math.round((current - target) / 360) * 360;
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export default function SpotReel({ spots }: SpotReelProps) {
  const navigate = useNavigate();
  const stageRef = useRef<HTMLElement | null>(null);
  const rotorRef = useRef<HTMLDivElement | null>(null);
  const angleRef = useRef(0);
  const activeIndexRef = useRef(0);
  const autoFrameRef = useRef<number>();
  const snapFrameRef = useRef<number>();
  const snapTimerRef = useRef<number>();
  const preloadTimerRef = useRef<number>();
  const pausedUntilRef = useRef(0);
  const isSnappingRef = useRef(false);
  const dragRef = useRef<DragState>();
  const suppressClickRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [geometry, setGeometry] = useState<ReelGeometry>({ cardWidth: 140, radius: 500 });

  const count = spots.length;
  const step = useMemo(() => 360 / Math.max(count, 1), [count]);

  const getNearestIndex = useCallback(
    (angle: number) => modulo(Math.round(-angle / step), Math.max(count, 1)),
    [count, step],
  );

  const updateActiveIndex = useCallback(
    (angle: number) => {
      const nextIndex = getNearestIndex(angle);
      if (nextIndex !== activeIndexRef.current) {
        activeIndexRef.current = nextIndex;
        setActiveIndex(nextIndex);
      }
    },
    [getNearestIndex],
  );

  const applyAngle = useCallback(
    (nextAngle: number) => {
      angleRef.current = nextAngle;
      rotorRef.current?.style.setProperty('--reel-rotation', `${nextAngle}deg`);
      updateActiveIndex(nextAngle);
    },
    [updateActiveIndex],
  );

  const pauseAutoplay = useCallback((duration = RESUME_DELAY_MS) => {
    pausedUntilRef.current = performance.now() + duration;
  }, []);

  const cancelSnap = useCallback(() => {
    if (snapFrameRef.current !== undefined) {
      window.cancelAnimationFrame(snapFrameRef.current);
      snapFrameRef.current = undefined;
    }
    isSnappingRef.current = false;
  }, []);

  const animateToAngle = useCallback(
    (targetAngle: number) => {
      cancelSnap();

      if (reducedMotionRef.current) {
        applyAngle(targetAngle);
        return;
      }

      const startAngle = angleRef.current;
      const destination = nearestEquivalent(targetAngle, startAngle);
      const startedAt = performance.now();
      isSnappingRef.current = true;

      const tick = (now: number) => {
        const progress = Math.min((now - startedAt) / SNAP_DURATION_MS, 1);
        const eased = 1 - Math.pow(1 - progress, 4);
        applyAngle(startAngle + (destination - startAngle) * eased);

        if (progress < 1) {
          snapFrameRef.current = window.requestAnimationFrame(tick);
          return;
        }

        snapFrameRef.current = undefined;
        isSnappingRef.current = false;
      };

      snapFrameRef.current = window.requestAnimationFrame(tick);
    },
    [applyAngle, cancelSnap],
  );

  const snapToNearest = useCallback(() => {
    const nextIndex = getNearestIndex(angleRef.current);
    animateToAngle(-nextIndex * step);
  }, [animateToAngle, getNearestIndex, step]);

  const scheduleSnap = useCallback(() => {
    if (snapTimerRef.current !== undefined) {
      window.clearTimeout(snapTimerRef.current);
    }
    snapTimerRef.current = window.setTimeout(() => {
      snapTimerRef.current = undefined;
      snapToNearest();
    }, SNAP_DELAY_MS);
  }, [snapToNearest]);

  const moveToIndex = useCallback(
    (index: number) => {
      pauseAutoplay();
      animateToAngle(-modulo(index, count) * step);
    },
    [animateToAngle, count, pauseAutoplay, step],
  );

  useEffect(() => {
    reducedMotionRef.current = prefersReducedMotion();
    activeIndexRef.current = 0;
    setActiveIndex(0);
    applyAngle(0);
  }, [applyAngle, count]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || count === 0) {
      return undefined;
    }

    const updateGeometry = () => {
      const cardWidth = clamp(stage.clientWidth * 0.12, 94, 155);
      const radius = cardWidth / (2 * Math.tan(Math.PI / count)) + 24;
      setGeometry({ cardWidth, radius });
    };

    updateGeometry();
    const observer = new ResizeObserver(updateGeometry);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [count]);

  useEffect(() => {
    if (count === 0) {
      return undefined;
    }

    let lastTime = performance.now();
    const degreesPerMillisecond = 360 / AUTO_ROTATION_DURATION_MS;

    const tick = (now: number) => {
      const delta = Math.min(now - lastTime, 64);
      lastTime = now;
      const isPaused =
        reducedMotionRef.current ||
        dragRef.current !== undefined ||
        isSnappingRef.current ||
        now < pausedUntilRef.current;

      if (!isPaused) {
        applyAngle(angleRef.current - delta * degreesPerMillisecond);
      }

      autoFrameRef.current = window.requestAnimationFrame(tick);
    };

    autoFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (autoFrameRef.current !== undefined) {
        window.cancelAnimationFrame(autoFrameRef.current);
      }
    };
  }, [applyAngle, count]);

  useEffect(() => {
    const preloadSources = spots.map((spot) => spot.imageUrl).filter((imageUrl): imageUrl is string => Boolean(imageUrl));
    const preloadedImages: HTMLImageElement[] = [];

    preloadTimerRef.current = window.setTimeout(() => {
      preloadSources.forEach((source) => {
        const image = new Image();
        image.src = source;
        preloadedImages.push(image);
      });
    }, 600);

    return () => {
      if (preloadTimerRef.current !== undefined) {
        window.clearTimeout(preloadTimerRef.current);
      }
      preloadedImages.length = 0;
    };
  }, [spots]);

  useEffect(
    () => () => {
      cancelSnap();
      if (snapTimerRef.current !== undefined) {
        window.clearTimeout(snapTimerRef.current);
      }
    },
    [cancelSnap],
  );

  const handleWheel = useCallback(
    (event: globalThis.WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        return;
      }

      event.preventDefault();
      cancelSnap();
      pauseAutoplay();
      const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      applyAngle(angleRef.current - dominantDelta * WHEEL_DEGREES_PER_PX);
      scheduleSnap();
    },
    [applyAngle, cancelSnap, pauseAutoplay, scheduleSnap],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return undefined;
    }

    stage.addEventListener('wheel', handleWheel, { passive: false });
    return () => stage.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    cancelSnap();
    pauseAutoplay();
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      dragged: false,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const totalDistance = event.clientX - drag.startX;
    if (!drag.dragged && Math.abs(totalDistance) >= DRAG_THRESHOLD_PX) {
      drag.dragged = true;
      suppressClickRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    if (!drag.dragged) {
      return;
    }

    const delta = event.clientX - drag.lastX;
    drag.lastX = event.clientX;
    applyAngle(angleRef.current + delta * DRAG_DEGREES_PER_PX);
  };

  const completePointerInteraction = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = undefined;
    pauseAutoplay();
    if (drag.dragged) {
      snapToNearest();
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const currentIndex = activeIndexRef.current;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveToIndex(currentIndex - 1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveToIndex(currentIndex + 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      moveToIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      moveToIndex(count - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const activeSpot = spots[currentIndex];
      if (activeSpot) {
        navigate(`/spots/${activeSpot.id}`, { state: { spot: activeSpot } });
      }
    }
  };

  const reelStyle = {
    '--reel-card-width': `${geometry.cardWidth}px`,
    '--reel-radius': `${geometry.radius}px`,
    '--reel-perspective': `${Math.max(900, geometry.radius * 2.8)}px`,
    '--reel-caption-offset': `${geometry.cardWidth * 1.25}px`,
  } as CSSProperties;

  return (
    <section
      className="spot-reel"
      data-testid="spot-reel"
      ref={stageRef}
      style={reelStyle}
      tabIndex={0}
      aria-label="灵山胜境景点轮盘"
      aria-roledescription="景点轮盘"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={completePointerInteraction}
      onPointerCancel={completePointerInteraction}
      onKeyDown={handleKeyDown}
    >
      <span className="spot-reel__instruction">
        使用左右方向键、滚轮或拖拽选择景点，按 Enter 键查看当前景点详情。
      </span>
      <div className="spot-reel__rotor" ref={rotorRef} data-testid="spot-reel-rotor">
        {spots.map((spot, index) => {
          const offset = Math.abs(index - activeIndex);
          const circularOffset = Math.min(offset, count - offset);
          const eagerImage = circularOffset <= 2;
          const isActive = index === activeIndex;

          return (
            <Link
              className={`spot-reel__card${isActive ? ' is-active' : ''}`}
              data-testid="spot-reel-card"
              to={`/spots/${spot.id}`}
              state={{ spot }}
              key={spot.id}
              style={{ '--reel-card-rotation': `${index * step}deg` } as CSSProperties}
              aria-label={`查看${spot.name}详情`}
              aria-current={isActive ? 'true' : undefined}
              tabIndex={isActive ? 0 : -1}
              onClick={(event) => {
                if (suppressClickRef.current) {
                  event.preventDefault();
                  return;
                }

                if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
                  event.preventDefault();
                  navigate(`/spots/${spot.id}`, { state: { spot } });
                }
              }}
            >
              <img
                className="spot-reel__image"
                src={spot.imageUrl || fallbackSpotImage}
                alt={`${spot.name}景点照片`}
                loading={eagerImage ? 'eager' : 'lazy'}
                draggable={false}
                onError={(event) => {
                  event.currentTarget.onerror = null;
                  event.currentTarget.src = fallbackSpotImage;
                }}
              />
            </Link>
          );
        })}
      </div>
      <div className="spot-reel__active-caption" data-testid="spot-reel-active-name" aria-hidden="true">
        {spots[activeIndex]?.name}
      </div>
    </section>
  );
}
