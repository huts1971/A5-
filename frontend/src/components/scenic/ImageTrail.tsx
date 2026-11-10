import { gsap } from 'gsap';
import { useEffect, useRef } from 'react';
import styles from './ImageTrail.module.css';

interface ImageTrailProps {
  items: string[];
}

interface Point {
  x: number;
  y: number;
}

const SPAWN_DISTANCE = 72;

function distanceBetween(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function lerp(start: number, end: number, amount: number) {
  return start * (1 - amount) + end * amount;
}

export default function ImageTrail({ items }: ImageTrailProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const host = container?.parentElement;
    if (
      !container ||
      !host ||
      items.length === 0 ||
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return undefined;
    }

    const images = Array.from(container.querySelectorAll<HTMLElement>(`[data-image-trail-item]`));
    let current: Point = { x: 0, y: 0 };
    let cached: Point = { x: 0, y: 0 };
    let lastShown: Point = { x: 0, y: 0 };
    let imageIndex = -1;
    let zIndex = 1;
    let frameId: number | undefined;
    let initialized = false;

    const showNextImage = () => {
      imageIndex = (imageIndex + 1) % images.length;
      zIndex += 1;
      const image = images[imageIndex];
      const rect = image.getBoundingClientRect();

      gsap.killTweensOf(image);
      gsap
        .timeline()
        .fromTo(
          image,
          {
            opacity: 1,
            scale: 0.84,
            zIndex,
            x: cached.x - rect.width / 2,
            y: cached.y - rect.height / 2,
          },
          {
            duration: 0.36,
            ease: 'power2.out',
            scale: 1,
            x: current.x - rect.width / 2,
            y: current.y - rect.height / 2,
          },
        )
        .to(
          image,
          {
            duration: 0.5,
            ease: 'power3.in',
            opacity: 0,
            scale: 0.24,
          },
          0.36,
        );
    };

    const render = () => {
      cached = {
        x: lerp(cached.x, current.x, 0.12),
        y: lerp(cached.y, current.y, 0.12),
      };

      if (distanceBetween(current, lastShown) > SPAWN_DISTANCE) {
        showNextImage();
        lastShown = { ...current };
      }

      frameId = window.requestAnimationFrame(render);
    };

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (event.pointerType !== 'mouse') {
        return;
      }

      const rect = container.getBoundingClientRect();
      const nextPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      current = nextPoint;
      if (!initialized) {
        initialized = true;
        cached = { ...nextPoint };
        lastShown = { ...nextPoint };
        frameId = window.requestAnimationFrame(render);
      }
    };

    host.addEventListener('pointermove', handlePointerMove);
    return () => {
      host.removeEventListener('pointermove', handlePointerMove);
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
      }
      gsap.killTweensOf(images);
    };
  }, [items]);

  return (
    <div className={styles.trail} ref={containerRef} aria-hidden="true">
      {items.map((url, index) => (
        <div className={styles.image} data-image-trail-item key={`${url}-${index}`}>
          <div className={styles.imageInner} style={{ backgroundImage: `url("${url}")` }} />
        </div>
      ))}
    </div>
  );
}
