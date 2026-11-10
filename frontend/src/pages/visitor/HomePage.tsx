import { Typography } from 'antd';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import Snap from 'lenis/snap';
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import AvatarGuide from '../../components/guide/AvatarGuide';

type HeroTuning = {
  titleLines?: string[];
  fontSize?: number;
  lineHeight?: number;
  titleX?: number;
  titleY?: number;
  imageScale?: number;
  imageX?: number;
  imageY?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  overlayOpacity?: number;
  titleWidth?: number;
  titleColor?: string;
};

type HeroScene = {
  key: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  subtitleEn?: string;
  image: string;
  tone: 'jade' | 'amber' | 'water';
  tuning?: HeroTuning;
};

const heroScenes: HeroScene[] = [
  {
    key: 'buddha',
    eyebrow: 'Ling Shan Scenic Area',
    title: '靈山勝境',
    subtitle: '以数字人导游陪你看见山水、佛韵与游线之间的秩序。',
    image: '/scenic/spots/photos/NH-001_拈花广场/1.jpg',
    tone: 'jade',
  },
  {
    key: 'palace',
    eyebrow: 'Brahma Palace',
    title: '典藏',
    subtitle: '用更安静的节奏收起复杂信息，让景点故事在需要时展开。',
    image: '/scenic/spots/photos/NH-003_香月花街/2.jpg',
    tone: 'amber',
  },
  {
    key: 'water',
    eyebrow: 'Nine Dragons Bathing',
    title: '路線优選',
    subtitle: '从亲子、长者、摄影到文化游，把路线建议做成从容的抵达。',
    image: '/scenic/spots/photos/NH-004_拈花堂/2.jpg',
    tone: 'water',
  },
];

function getHeroStyle(tuning?: HeroTuning): CSSProperties | undefined {
  if (!tuning) {
    return undefined;
  }

  return {
    '--hero-title-size': tuning.fontSize ? `${tuning.fontSize}px` : undefined,
    '--hero-line-height': tuning.lineHeight,
    '--hero-title-x': tuning.titleX !== undefined ? `${tuning.titleX}%` : undefined,
    '--hero-title-y': tuning.titleY !== undefined ? `${tuning.titleY}%` : undefined,
    '--hero-title-width': tuning.titleWidth !== undefined ? `${tuning.titleWidth}%` : undefined,
    '--hero-title-color': tuning.titleColor,
    '--hero-title-anchor-x': '-50%',
    '--hero-image-scale': tuning.imageScale,
    '--hero-image-x': tuning.imageX !== undefined ? `${tuning.imageX}%` : undefined,
    '--hero-image-y': tuning.imageY !== undefined ? `${tuning.imageY}%` : undefined,
    '--hero-image-pan-x': tuning.imageX !== undefined ? `${50 - tuning.imageX}%` : undefined,
    '--hero-image-pan-y': tuning.imageY !== undefined ? `${50 - tuning.imageY}%` : undefined,
    '--hero-brightness': tuning.brightness !== undefined ? `${tuning.brightness}%` : undefined,
    '--hero-contrast': tuning.contrast !== undefined ? `${tuning.contrast}%` : undefined,
    '--hero-saturation': tuning.saturation !== undefined ? `${tuning.saturation}%` : undefined,
    '--hero-overlay-opacity': tuning.overlayOpacity,
  } as CSSProperties;
}

export default function HomePage() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) {
      return undefined;
    }

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({
      wrapper,
      content,
      eventsTarget: window,
      infinite: true,
      syncTouch: true,
      lerp: 0.08,
      wheelMultiplier: 0.9,
    });
    const snap = new Snap(lenis, {
      type: 'mandatory',
      debounce: 420,
      duration: 0.9,
      easing: (t: number) => 1 - Math.pow(1 - t, 4),
    });
    snap.addElements(Array.from(wrapper.querySelectorAll<HTMLElement>('.luxury-hero-panel')), {
      align: 'start',
    });

    ScrollTrigger.scrollerProxy(wrapper, {
      scrollTop(value?: number) {
        if (typeof value === 'number') {
          lenis.scrollTo(value, { immediate: true });
        }
        return lenis.scroll;
      },
      getBoundingClientRect() {
        return {
          top: 0,
          left: 0,
          width: wrapper.clientWidth,
          height: wrapper.clientHeight,
        };
      },
      pinType: 'transform',
    });

    const ctx = gsap.context(() => {
      const marquee = document.querySelector('.luxury-marquee-track');
      if (marquee) {
        gsap.fromTo(
          marquee,
          { xPercent: 0 },
          {
            xPercent: -50,
            duration: 18,
            ease: 'none',
            repeat: -1,
          },
        );
      }

      wrapper.querySelectorAll<HTMLElement>('.luxury-hero-panel').forEach((panel) => {
        const art = panel.querySelector('.luxury-scene-backdrop');
        const copy = panel.querySelector('.luxury-scene-copy');
        const meta = panel.querySelector('.luxury-scene-meta');

        if (art) {
          gsap.fromTo(
            art,
            { yPercent: -18, scale: 1.12 },
            {
              yPercent: 18,
              scale: 1,
              ease: 'none',
              scrollTrigger: {
                scroller: wrapper,
                trigger: panel,
                start: 'top bottom',
                end: 'bottom top',
                scrub: true,
                fastScrollEnd: true,
              },
            },
          );
        }

        const animatedText = [copy, meta].filter(Boolean);
        if (animatedText.length > 0) {
          gsap.fromTo(
            animatedText,
            { opacity: 0.42, y: 38 },
            {
              opacity: 1,
              y: 0,
              ease: 'power2.out',
              scrollTrigger: {
                scroller: wrapper,
                trigger: panel,
                start: 'top 72%',
                end: 'top 28%',
                scrub: true,
              },
            },
          );
        }
      });
    }, wrapper);

    const update = (time: number) => {
      lenis.raf(time * 1000);
    };
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(update);
    gsap.ticker.lagSmoothing(0);
    ScrollTrigger.refresh();

    return () => {
      ctx.revert();
      snap.destroy();
      lenis.destroy();
      gsap.ticker.remove(update);
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      ScrollTrigger.clearScrollMemory();
    };
  }, []);

  return (
    <div className="luxury-home">
      <div className="luxury-scroll-wrapper" ref={wrapperRef}>
        <div className="luxury-scroll-content" ref={contentRef}>
          {heroScenes.map((scene, index) => (
            <section className={`luxury-hero-panel tone-${scene.tone}`} key={scene.key} style={getHeroStyle(scene.tuning)}>
              <div className="luxury-scene-backdrop">
                <img className="luxury-scenic-art" src={scene.image} alt="" aria-hidden="true" />
              </div>
              <div className="luxury-scene-copy">
                {scene.eyebrow ? <span className="luxury-eyebrow">{scene.eyebrow}</span> : null}
                <Typography.Title className="luxury-hero-title">
                  {(scene.tuning?.titleLines ?? [scene.title]).map((line) => (
                    <span className="luxury-hero-title-line" key={line}>
                      {line}
                    </span>
                  ))}
                </Typography.Title>
                <Typography.Paragraph className="luxury-hero-subtitle">
                  {scene.subtitle}
                  {scene.subtitleEn ? <span className="luxury-hero-subtitle-en">{scene.subtitleEn}</span> : null}
                </Typography.Paragraph>
              </div>
              <div className="luxury-scene-meta">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <i />
                <span>{scene.key.toUpperCase()}</span>
              </div>
            </section>
          ))}
          <section className="luxury-hero-panel tone-jade" aria-hidden="true">
            <div className="luxury-scene-backdrop">
              <img className="luxury-scenic-art" src={heroScenes[0].image} alt="" aria-hidden="true" />
            </div>
            <div className="luxury-scene-copy">
              <span className="luxury-eyebrow">{heroScenes[0].eyebrow}</span>
              <Typography.Title className="luxury-hero-title">
                <span className="luxury-hero-title-line">{heroScenes[0].title}</span>
              </Typography.Title>
              <Typography.Paragraph className="luxury-hero-subtitle">{heroScenes[0].subtitle}</Typography.Paragraph>
            </div>
            <div className="luxury-scene-meta">
              <span>01</span>
              <i />
              <span>{heroScenes[0].key.toUpperCase()}</span>
            </div>
          </section>
        </div>
      </div>

      <div className="luxury-fixed-layer">
        <div className="luxury-marquee" aria-hidden="true">
          <div className="luxury-marquee-track">
            {Array.from({ length: 6 }).map((_, index) => (
              <span key={index}>灵山胜境导览</span>
            ))}
          </div>
        </div>

        <div className="luxury-avatar-stage">
          <AvatarGuide
            status="idle"
            variant="stage"
            emotionCue="idle"
            stageMode="home"
            title="待命中"
            detail=""
            suppressInitialFallbackImage
          />
        </div>

        <div className="video-scroll-hint">[SCROLL DOWN]</div>
      </div>
    </div>
  );
}
