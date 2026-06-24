import { useEffect, useRef } from 'react';
import { EnvironmentOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Empty, Skeleton, Space, Tag, Typography } from 'antd';
import type { RoutePlan } from '../../types/scenic';
import styles from './RouteCard.module.css';

export interface RouteCardProps {
  route?: RoutePlan;
  loading?: boolean;
  error?: string;
  emptyText?: string;
  onRetry?: () => void;
  activeSpotId?: string;
  mappedSpotIds?: ReadonlySet<string>;
  onSpotActivate?: (spotId: string) => void;
  scrollToActive?: boolean;
}

export default function RouteCard({
  route,
  loading = false,
  error,
  emptyText = '暂无推荐路线',
  onRetry,
  activeSpotId,
  mappedSpotIds,
  onSpotActivate,
  scrollToActive = false,
}: RouteCardProps) {
  const spotRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!activeSpotId || !scrollToActive) {
      return;
    }
    spotRefs.current[activeSpotId]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [activeSpotId, scrollToActive]);

  if (loading) {
    return (
      <Card className="route-card">
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="route-card">
        <Alert
          type="warning"
          showIcon
          message="路线加载失败"
          description={error}
          action={
            onRetry ? (
              <Button size="small" onClick={onRetry}>
                重试
              </Button>
            ) : null
          }
        />
      </Card>
    );
  }

  if (!route) {
    return (
      <Card className="route-card">
        <Empty description={emptyText} />
      </Card>
    );
  }
  return (
    <Card
      className="route-card"
      data-cue="[ ROUTE ]"
      title={route.name}
      extra={
        <Tag color="green" icon={<EnvironmentOutlined />}>
          {route.spots.length} 个点位
        </Tag>
      }
    >
      <Space className="route-card-content" direction="vertical" size={12} style={{ width: '100%' }}>
        {route.pathComplete === false ? (
          <Alert
            type="info"
            showIcon
            message="部分道路折线待补充"
            description="地图只显示已人工校准的道路段，不会用直线连接景点。"
          />
        ) : null}
        <div className="route-timeline">
          {route.spots.map((spot, index) => {
            const isActive = activeSpotId === spot.spotId;
            const hasMapPoint = mappedSpotIds?.has(spot.spotId) ?? true;
            return (
              <div
                ref={(element) => {
                  spotRefs.current[spot.spotId] = element;
                }}
                className={[
                  'route-timeline-item',
                  styles.timelineItemInteractive,
                  isActive ? styles.timelineItemActive : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={`${route.id}-${spot.spotId}`}
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
                onClick={() => onSpotActivate?.(spot.spotId)}
                onFocus={() => onSpotActivate?.(spot.spotId)}
                onMouseEnter={() => onSpotActivate?.(spot.spotId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSpotActivate?.(spot.spotId);
                  }
                }}
              >
                <div className="route-step-index">{String(index + 1).padStart(2, '0')}</div>
                <div>
                  <Typography.Text strong>
                    {spot.name} · {spot.stayMinutes} 分钟
                  </Typography.Text>
                  <span
                    className={[
                      styles.transition,
                      index > 0 && spot.transitionMinutes == null
                        ? styles.transitionMissing
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    title={spot.transitionNote}
                  >
                    {index === 0
                      ? '路线起点'
                      : spot.transitionMinutes == null
                        ? '上一站至此：时间待补充'
                        : `上一站至此约 ${spot.transitionMinutes} 分钟`}
                  </span>
                  {!hasMapPoint ? (
                    <span className={styles.missingPoint}>[ 地图点位待补充 ]</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </Space>
    </Card>
  );
}
