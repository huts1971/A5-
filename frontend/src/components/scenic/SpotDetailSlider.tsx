import { ArrowLeftOutlined, DownOutlined } from '@ant-design/icons';
import { gsap } from 'gsap';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { fallbackSpotImage } from '../../api/spotImages';
import type { ScenicSpot } from '../../types/scenic';
import LiquidGuideQuestion from './LiquidGuideQuestion';

const AUTOPLAY_DELAY_MS = 4_000;
const SWIPE_THRESHOLD_PX = 40;
const DEFAULT_TONE = 'hsl(126 10% 13%)';
const titleWords = ['Lingshan', 'Buddha', 'nirvana'];
const tonePromises = new Map<string, Promise<string>>();

type Direction = 'next' | 'prev';

interface GuideQuestion {
  label: string;
  to: string;
}

interface SpotDetailSliderProps {
  spot: ScenicSpot;
  photos: string[];
  questions: GuideQuestion[];
}

interface TitleLines {
  current: string;
  previous?: string;
  direction: Direction;
}

function modulo(value: number, base: number) {
  return ((value % base) + base) % base;
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function rgbToTone(red: number, green: number, blue: number) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const lightness = (maximum + minimum) / 2;
  const delta = maximum - minimum;
  let hue = 0;
  let saturation = 0;

  if (delta > 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (maximum === r) {
      hue = ((g - b) / delta) % 6;
    } else if (maximum === g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const curatedSaturation = Math.round(Math.min(Math.max(saturation * 55, 18), 42));
  const curatedLightness = Math.round(Math.min(Math.max(lightness * 48, 20), 38));
  return `hsl(${Math.round(hue)} ${curatedSaturation}% ${curatedLightness}%)`;
}

function samplePhotoTone(source: string) {
  const cached = tonePromises.get(source);
  if (cached) return cached;

  const promise = new Promise<string>((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 40;
        canvas.height = 40;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
          resolve(DEFAULT_TONE);
          return;
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;

        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3];
          const r = pixels[index];
          const g = pixels[index + 1];
          const b = pixels[index + 2];
          const brightness = (r + g + b) / 3;
          if (alpha < 200 || brightness < 16 || brightness > 245) continue;
          red += r;
          green += g;
          blue += b;
          count += 1;
        }

        resolve(count ? rgbToTone(red / count, green / count, blue / count) : DEFAULT_TONE);
      } catch {
        resolve(DEFAULT_TONE);
      }
    };
    image.onerror = () => resolve(DEFAULT_TONE);
    image.src = source;
  });

  tonePromises.set(source, promise);
  return promise;
}

function titleSize(name: string) {
  if (/^[\x00-\x7F]+$/.test(name)) return '7.2vw';
  const viewportUnits = Math.min(14, Math.max(6.5, (46 / Math.max(name.length, 1)) * 0.86));
  return `${viewportUnits.toFixed(2)}vw`;
}

/**
 * Interaction and carousel geometry adapted from "Animated Slider" by NIDAL.
 * https://codepen.io/Nidal95/pen/qENQPBp
 * MIT License — see animated-slider.zip supplied with this project.
 */
export default function SpotDetailSlider({ spot, photos, questions }: SpotDetailSliderProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const cursorRef = useRef<HTMLSpanElement | null>(null);
  const touchStartYRef = useRef<number>();
  const isAnimatingRef = useRef(false);
  const initializedRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState<Direction>('next');
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [tones, setTones] = useState<Record<string, string>>({});
  const [titleLines, setTitleLines] = useState<TitleLines>({ current: spot.name, direction: 'next' });

  const slides = useMemo(
    () =>
      (photos.length ? photos : [fallbackSpotImage]).slice(0, 4).map((source, index) => ({
        source,
        title: index === 0 ? spot.name : titleWords[index - 1] ?? spot.name,
      })),
    [photos, spot.name],
  );
  const slideKey = slides.map((slide) => slide.source).join('|');
  const previousSlideKeyRef = useRef(slideKey);
  const activeSlide = slides[activeIndex] ?? slides[0];
  const activeTone = tones[activeSlide.source] ?? DEFAULT_TONE;

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mediaQuery) return undefined;
    const updatePreference = () => setReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener('change', updatePreference);
    return () => mediaQuery.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sequenceChanged = previousSlideKeyRef.current !== slideKey;
    previousSlideKeyRef.current = slideKey;
    if (sequenceChanged) {
      setActiveIndex(0);
      setTitleLines({ current: slides[0]?.title ?? spot.name, direction: 'next' });
      initializedRef.current = false;
      isAnimatingRef.current = false;
    }

    void Promise.all(
      slides.map(async (slide) => ({ source: slide.source, tone: await samplePhotoTone(slide.source) })),
    ).then((values) => {
      if (cancelled) return;
      setTones((current) => ({
        ...current,
        ...Object.fromEntries(values.map(({ source, tone }) => [source, tone])),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [slideKey, slides, spot.name]);

  const go = useCallback(
    (nextDirection: Direction) => {
      if (isAnimatingRef.current || slides.length < 2) return;
      const nextIndex = modulo(activeIndex + (nextDirection === 'next' ? 1 : -1), slides.length);
      const nextTitle = slides[nextIndex].title;
      isAnimatingRef.current = true;
      setDirection(nextDirection);
      setTitleLines({ current: nextTitle, previous: activeSlide.title, direction: nextDirection });
      setActiveIndex(nextIndex);

      if (reducedMotion) {
        isAnimatingRef.current = false;
      }
    },
    [activeIndex, activeSlide.title, reducedMotion, slides],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const firstRender = !initializedRef.current;
    initializedRef.current = true;
    const duration = reducedMotion ? 0.01 : 1.15;
    const animationContext = gsap.context(() => {
      const photoCards = gsap.utils.toArray<HTMLElement>('.spot-detail-slider__photo-card');
      const incomingCharacters = gsap.utils.toArray<HTMLElement>('[data-title-line="current"] .spot-detail-slider__title-character');
      const outgoingCharacters = gsap.utils.toArray<HTMLElement>('[data-title-line="previous"] .spot-detail-slider__title-character');
      const travel = direction === 'next' ? 112 : -112;
      const timeline = gsap.timeline({
        onComplete: () => {
          if (titleLines.previous) {
            setTitleLines((current) => ({ ...current, previous: undefined }));
          }
          isAnimatingRef.current = false;
        },
      });

      if (!firstRender) {
        timeline.fromTo(
          photoCards,
          { '--stack-motion-y': `${direction === 'next' ? 72 : -72}px`, opacity: 0.35 },
          { '--stack-motion-y': '0px', opacity: 1, duration, stagger: 0.045, ease: 'power3.inOut' },
          0,
        );
      }

      if (outgoingCharacters.length) {
        timeline.to(
          outgoingCharacters,
          { yPercent: -travel, duration, stagger: reducedMotion ? 0 : 0.035, ease: 'expo.inOut' },
          0,
        );
      }
      if (incomingCharacters.length) {
        timeline.fromTo(
          incomingCharacters,
          { yPercent: travel },
          { yPercent: 0, duration, stagger: reducedMotion ? 0 : 0.035, ease: 'expo.inOut' },
          0,
        );
      }
    }, root);

    return () => animationContext.revert();
  }, [activeIndex, direction, reducedMotion]);

  useEffect(() => {
    if (slides.length < 2 || reducedMotion) return undefined;
    const interval = window.setInterval(() => {
      if (!document.hidden) go('next');
    }, AUTOPLAY_DELAY_MS);
    return () => window.clearInterval(interval);
  }, [go, reducedMotion, slides.length]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const handleWheel = (event: globalThis.WheelEvent) => {
      if (slides.length < 2 || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (Math.abs(delta) > 4) go(delta > 0 ? 'next' : 'prev');
    };
    root.addEventListener('wheel', handleWheel, { passive: false });
    return () => root.removeEventListener('wheel', handleWheel);
  }, [go, slides.length]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      go('next');
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      go('prev');
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') touchStartYRef.current = event.clientY;
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch' || touchStartYRef.current === undefined) return;
    const delta = touchStartYRef.current - event.clientY;
    touchStartYRef.current = undefined;
    if (Math.abs(delta) >= SWIPE_THRESHOLD_PX) go(delta > 0 ? 'next' : 'prev');
  };

  const updateCursor = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse' || !cursorRef.current) return;
    cursorRef.current.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
    cursorRef.current.dataset.visible = 'true';
  };

  const hideCursor = () => {
    if (cursorRef.current) cursorRef.current.dataset.visible = 'false';
  };

  const visibleSlides = [-1, 0, 1].map((offset) => ({
    offset,
    slide: slides[modulo(activeIndex + offset, slides.length)],
  }));
  const rootStyle = { '--detail-tone': activeTone } as CSSProperties;
  const titleLineClass = (title: string) =>
    `spot-detail-slider__title-line ${title === spot.name ? 'is-scenic-name' : 'is-keyword'}`;

  return (
    <main
      className="spot-detail-slider"
      data-testid="spot-detail-slider"
      ref={rootRef}
      style={rootStyle}
      tabIndex={0}
      aria-label={`${spot.name}照片导览`}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={updateCursor}
      onPointerLeave={hideCursor}
    >
      <svg className="spot-detail-slider__filter" aria-hidden="true" focusable="false">
        <filter id="spot-glass-distortion" x="0%" y="0%" width="100%" height="100%" filterUnits="objectBoundingBox">
          <feTurbulence type="fractalNoise" baseFrequency="0.001 0.005" numOctaves="1" seed="17" result="turbulence" />
          <feComponentTransfer in="turbulence" result="mapped">
            <feFuncR type="gamma" amplitude="1" exponent="10" offset="0.5" />
            <feFuncG type="gamma" amplitude="0" exponent="1" offset="0" />
            <feFuncB type="gamma" amplitude="0" exponent="1" offset="0.5" />
          </feComponentTransfer>
          <feGaussianBlur in="turbulence" stdDeviation="3" result="softMap" />
          <feDisplacementMap in="SourceGraphic" in2="softMap" scale="200" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      <span className="spot-detail-slider__glass" aria-hidden="true" />
      <Link className="spot-detail-slider__back" to="/spots" aria-label="返回景点列表">
        <ArrowLeftOutlined />
        <span>景点</span>
      </Link>

      <section className="spot-detail-slider__content">
        <div className="spot-detail-slider__copy">
          <span className="spot-detail-slider__spot-id">[ {spot.id.toUpperCase()} ]</span>
          <h1
            className={`spot-detail-slider__title ${activeSlide.title === spot.name ? 'is-scenic-name' : 'is-keyword'} ${
              spot.id === 'spot_ls_012' && activeSlide.title === spot.name ? 'is-cultural-museum-title' : ''
            }`}
            aria-live="polite"
            style={{ '--detail-title-size': titleSize(activeSlide.title) } as CSSProperties}
          >
            {titleLines.previous ? (
              <span className={titleLineClass(titleLines.previous)} data-title-line="previous" aria-hidden="true">
                {[...titleLines.previous].map((character, index) => (
                  <span className="spot-detail-slider__title-character" key={`${character}-${index}`}>
                    {character === ' ' ? '\u00a0' : character}
                  </span>
                ))}
              </span>
            ) : null}
            <span className={titleLineClass(titleLines.current)} data-title-line="current">
              {[...titleLines.current].map((character, index) => (
                <span className="spot-detail-slider__title-character" key={`${character}-${index}`}>
                  {character === ' ' ? '\u00a0' : character}
                </span>
              ))}
            </span>
          </h1>
          <span className="spot-detail-slider__subtitle">{spot.subtitle}</span>
        </div>

        <section className="spot-detail-slider__photos" aria-label="景点照片轮播">
          {visibleSlides.map(({ offset, slide }) => (
            <figure className="spot-detail-slider__photo-card" data-slot={offset} key={`${offset}-${slide.source}`}>
              <img
                src={slide.source}
                alt={offset === 0 ? `${spot.name}照片 ${activeIndex + 1}` : ''}
                aria-hidden={offset !== 0}
                onError={(event) => {
                  event.currentTarget.onerror = null;
                  event.currentTarget.src = fallbackSpotImage;
                }}
              />
            </figure>
          ))}
          {slides.length > 1 ? (
            <span className="spot-detail-slider__scroll-hint" aria-hidden="true">
              <DownOutlined /> 滚动切换
            </span>
          ) : null}
        </section>

        <section className="spot-detail-slider__details" aria-label="景点简介与 AI 提问">
          <p className="spot-detail-slider__summary">{spot.summary}</p>
          <div className="spot-detail-slider__questions" aria-label="可以这样问 AI">
            <span className="spot-detail-slider__questions-label">可以这样问 AI</span>
            {questions.map((question) => (
              <LiquidGuideQuestion key={question.to} to={question.to}>
                {question.label}
              </LiquidGuideQuestion>
            ))}
          </div>
        </section>
      </section>

      <span className="spot-detail-slider__cursor" ref={cursorRef} data-testid="spot-detail-cursor" data-visible="false" aria-hidden="true">
        +
      </span>
    </main>
  );
}
