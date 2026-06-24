import { useEffect, useState } from 'react';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  FastForwardOutlined,
  RetweetOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Empty, Spin, Statistic, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { getTourRecap } from '../../api/tours';
import type { TourRecap } from '../../types/scenic';
import { loadTourRecovery } from '../../utils/tourRecovery';
import styles from './TourRecapPage.module.css';

function localRecap(tourId: string): TourRecap | undefined {
  const tour = loadTourRecovery(tourId);
  if (!tour) return undefined;
  const end = new Date(tour.finishedAt ?? tour.updatedAt).getTime();
  const start = new Date(tour.startedAt).getTime();
  return {
    id: tour.id,
    name: tour.name,
    status: tour.status,
    startedAt: tour.startedAt,
    finishedAt: tour.finishedAt,
    elapsedMinutes: Math.max(0, Math.ceil((end - start) / 60000)),
    completedCount: tour.spots.filter((spot) => spot.status === 'completed').length,
    skippedCount: tour.spots.filter((spot) => spot.status === 'skipped').length,
    adjustmentCount: 0,
    deviationCount: 0,
    recommendedOrder: tour.spots.map((spot) => spot.name),
    preferenceProfile: {},
    actualOrder: tour.spots
      .filter((spot) => spot.status === 'completed' || spot.status === 'skipped')
      .map((spot) => ({
        spotId: spot.spotId,
        name: spot.name,
        result: spot.status as 'completed' | 'skipped',
        occurredAt: spot.completedAt ?? tour.updatedAt,
      })),
    aiTopics: [],
  };
}

export default function TourRecapPage() {
  const { tourId = '' } = useParams();
  const [recap, setRecap] = useState<TourRecap>();
  const [localMode, setLocalMode] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getTourRecap(tourId)
      .then(setRecap)
      .catch(() => {
        const recovered = localRecap(tourId);
        if (recovered) {
          setRecap(recovered);
          setLocalMode(true);
        } else {
          setError('行程回顾加载失败。');
        }
      });
  }, [tourId]);

  if (error) return <Alert type="error" showIcon message={error} />;
  if (!recap) return <Spin size="large" tip="正在整理行程回顾" />;

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <Typography.Text className="mono-label">[ TOUR RECAP ]</Typography.Text>
        <Typography.Title level={1}>{recap.name}</Typography.Title>
        <Typography.Paragraph>
          这份回顾按实际完成与跳过事件生成，不会用原计划顺序冒充实际游览顺序。
        </Typography.Paragraph>
      </header>

      {localMode ? (
        <Alert type="warning" showIcon message="当前回顾由本地最近状态生成" />
      ) : null}

      <section className={styles.metrics}>
        <Card>
          <Statistic title="实际耗时" value={recap.elapsedMinutes} suffix="分钟" prefix={<ClockCircleOutlined />} />
        </Card>
        <Card>
          <Statistic title="完成景点" value={recap.completedCount} prefix={<CheckCircleOutlined />} />
        </Card>
        <Card>
          <Statistic title="跳过景点" value={recap.skippedCount} prefix={<FastForwardOutlined />} />
        </Card>
        <Card>
          <Statistic title="路线调整" value={recap.adjustmentCount} prefix={<RetweetOutlined />} />
        </Card>
        <Card>
          <Statistic title="计划差异" value={recap.deviationCount} prefix={<SwapOutlined />} />
        </Card>
      </section>

      <section className={styles.content}>
        <Card title="实际游览顺序">
          {recap.actualOrder.length > 0 ? (
            <div className={styles.orderList}>
              {recap.actualOrder.map((spot, index) => (
                <div key={`${spot.spotId}-${spot.occurredAt}`} className={styles.orderItem}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{spot.name}</strong>
                  <em>{spot.result === 'completed' ? '已完成' : '已跳过'}</em>
                </div>
              ))}
            </div>
          ) : (
            <Empty description="本次游览没有完成或跳过记录" />
          )}
        </Card>

        <div className={styles.sideCards}>
          <Card title="原推荐顺序">
            {recap.recommendedOrder.length > 0 ? (
              <ol className={styles.recommendedList}>
                {recap.recommendedOrder.map((name) => <li key={name}>{name}</li>)}
              </ol>
            ) : (
              <Empty description="暂无推荐路线快照" />
            )}
          </Card>
          <Card title="本次 AI 咨询主题">
            {recap.aiTopics.length > 0 ? (
              <ul>
                {recap.aiTopics.map((topic) => <li key={topic}>{topic}</li>)}
              </ul>
            ) : (
              <Empty description="本次尚未记录 AI 咨询主题" />
            )}
          </Card>
        </div>
      </section>

      <div className={styles.actions}>
        <Link to="/routes">
          <Button type="primary">重新规划路线</Button>
        </Link>
        <Link to="/guide">
          <Button>继续咨询 AI 导游</Button>
        </Link>
      </div>
    </div>
  );
}
