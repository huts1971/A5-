import {
  CheckCircleOutlined,
  FlagOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { Button } from 'antd';
import { useEffect, useRef } from 'react';
import type {
  GuideRouteContext,
  GuideRouteContextSpot,
} from '../../types/scenic';
import styles from './RouteProgressStrip.module.css';

export interface RouteProgressStripProps {
  context: GuideRouteContext;
  displayIndex: number;
  realCurrentIndex?: number;
  disabled?: boolean;
  completing?: boolean;
  className?: string;
  onSelectSpot: (index: number, spot: GuideRouteContextSpot) => void;
  onPrevious: () => void;
  onNext: () => void;
  onCompleteCurrent?: () => void;
}

function clampIndex(index: number, length: number) {
  if (length <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), length - 1);
}

function joinClassNames(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ');
}

export default function RouteProgressStrip({
  context,
  displayIndex,
  realCurrentIndex = context.currentIndex,
  disabled = false,
  completing = false,
  className,
  onSelectSpot,
  onPrevious,
  onNext,
  onCompleteCurrent,
}: RouteProgressStripProps) {
  const spots = context.orderedSpots;
  const safeDisplayIndex = clampIndex(displayIndex, spots.length);
  const hasVisibleRealCurrent =
    realCurrentIndex >= 0 && realCurrentIndex < spots.length;
  const safeRealCurrentIndex = hasVisibleRealCurrent
    ? realCurrentIndex
    : -1;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stopRefs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const selectedStop = stopRefs.current[safeDisplayIndex];
    if (!scroller || !selectedStop) {
      return;
    }

    const targetLeft =
      selectedStop.offsetLeft - (scroller.clientWidth - selectedStop.offsetWidth) / 2;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    scroller.scrollTo({
      left: Math.max(0, targetLeft),
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [safeDisplayIndex]);

  if (spots.length === 0) {
    return (
      <section
        className={joinClassNames(styles.strip, styles.empty, className)}
        data-testid="scene-route-progress-strip"
        aria-label="场景导览路线"
      >
        <div>
          <strong>路线中暂时没有可预览的点位</strong>
        </div>
      </section>
    );
  }

  const isTour = context.status === 'tour' && Boolean(context.tourId);
  const atRealTourSpot =
    isTour &&
    hasVisibleRealCurrent &&
    safeDisplayIndex === safeRealCurrentIndex;
  const realSpot =
    safeRealCurrentIndex >= 0 ? spots[safeRealCurrentIndex] : undefined;
  const realSpotFinished =
    realSpot?.status === 'completed' || realSpot?.status === 'skipped';
  const canCompleteCurrent =
    Boolean(onCompleteCurrent) &&
    Boolean(realSpot) &&
    atRealTourSpot &&
    !realSpotFinished;
  const isLastRealSpot = safeRealCurrentIndex === spots.length - 1;
  const routeMeta = isTour
    ? !hasVisibleRealCurrent
      ? `真实行程尚未进入可讲解景点 · 正在预览第 ${safeDisplayIndex + 1} 站`
      : safeDisplayIndex === safeRealCurrentIndex
        ? `行程与预览均在第 ${safeDisplayIndex + 1} 站`
        : `行程第 ${safeRealCurrentIndex + 1} 站 · 正在预览第 ${safeDisplayIndex + 1} 站`
    : `正在预览第 ${safeDisplayIndex + 1} 站 · 共 ${spots.length} 站`;

  return (
    <section
      className={joinClassNames(styles.strip, className)}
      data-testid="scene-route-progress-strip"
      aria-label={`${context.routeName || '场景导览路线'}，${routeMeta}`}
    >
      <Button
        className={joinClassNames(styles.navButton, styles.previousButton)}
        type="text"
        shape="circle"
        icon={<LeftOutlined />}
        disabled={disabled || safeDisplayIndex <= 0}
        onClick={onPrevious}
        data-testid="scene-route-previous"
        aria-label="预览上一站"
      />

      <div
        ref={scrollerRef}
        className={styles.scroller}
        role="region"
        aria-label="路线点位，可横向滚动"
        tabIndex={0}
      >
        <ol className={styles.stopList}>
          {spots.map((spot, index) => {
            const isPreview = index === safeDisplayIndex;
            const isRealCurrent = isTour && index === safeRealCurrentIndex;
            const isFinished =
              spot.status === 'completed' || spot.status === 'skipped';
            const stateDescription = [
              isPreview ? '当前预览点' : '',
              isRealCurrent ? '真实行程当前点' : '',
              spot.status === 'completed'
                ? '已完成'
                : spot.status === 'skipped'
                  ? '已跳过'
                  : '',
            ]
              .filter(Boolean)
              .join('，');

            return (
              <li
                key={`${spot.spotId}-${index}`}
                ref={(node) => {
                  stopRefs.current[index] = node;
                }}
                className={joinClassNames(
                  styles.stop,
                  isPreview && styles.previewStop,
                  isRealCurrent && styles.realStop,
                  isFinished && styles.finishedStop,
                )}
              >
                <button
                  type="button"
                  className={styles.stopButton}
                  onClick={() => onSelectSpot(index, spot)}
                  disabled={disabled}
                  aria-current={isPreview ? 'step' : undefined}
                  aria-label={`第 ${index + 1} 站，${spot.name}${stateDescription ? `，${stateDescription}` : ''}`}
                  data-testid={`scene-route-stop-${spot.spotId}`}
                >
                  <span className={styles.stopMarker} aria-hidden="true">
                    {isFinished ? <CheckCircleOutlined /> : index + 1}
                  </span>
                  <span className={styles.stopName} title={spot.name}>
                    {spot.name}
                  </span>
                  {isRealCurrent ? (
                    <span className={styles.realBadge} aria-hidden="true">
                      <FlagOutlined />
                      行程
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <Button
        className={joinClassNames(styles.navButton, styles.nextButton)}
        type="text"
        shape="circle"
        icon={<RightOutlined />}
        disabled={disabled || safeDisplayIndex >= spots.length - 1}
        onClick={onNext}
        data-testid="scene-route-next"
        aria-label="预览下一站"
      />

      {canCompleteCurrent ? (
        <Button
          className={styles.completeButton}
          type="primary"
          icon={<CheckCircleOutlined />}
          loading={completing}
          disabled={disabled}
          onClick={onCompleteCurrent}
          data-testid="scene-route-complete"
          aria-label={
            isLastRealSpot
              ? `完成当前点位 ${realSpot?.name ?? ''}`
              : `完成当前点位 ${realSpot?.name ?? ''} 并前往下一站`
          }
        >
          {isLastRealSpot ? '完成本点' : '完成本点并前往下一站'}
        </Button>
      ) : null}
    </section>
  );
}
