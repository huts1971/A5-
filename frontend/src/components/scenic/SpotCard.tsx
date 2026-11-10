import { ClockCircleOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Empty, Skeleton, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { fallbackSpotImage } from '../../api/spotImages';
import type { ScenicSpot } from '../../types/scenic';

export interface SpotCardProps {
  spot?: ScenicSpot;
  index?: number;
  loading?: boolean;
  error?: string;
  emptyText?: string;
  onRetry?: () => void;
  detailHref?: (spot: ScenicSpot) => string;
}

export default function SpotCard({
  spot,
  index,
  loading = false,
  error,
  emptyText = '暂无景点数据',
  onRetry,
  detailHref = (item) => `/spots/${item.id}`,
}: SpotCardProps) {
  if (loading) {
    return (
      <Card className="spot-card">
        <Skeleton.Image active style={{ width: '100%', height: 128 }} />
        <Skeleton active paragraph={{ rows: 4 }} style={{ marginTop: 18 }} />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="spot-card">
        <Alert
          type="warning"
          showIcon
          message="景点加载失败"
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

  if (!spot) {
    return (
      <Card className="spot-card">
        <Empty description={emptyText} />
      </Card>
    );
  }

  return (
    <Card
      className="spot-card"
      hoverable
      data-cue="[ OPEN ]"
      cover={
        spot.imageUrl ? (
          <img
            className="spot-image"
            src={spot.imageUrl}
            alt={`${spot.name}景点封面`}
            loading="lazy"
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = fallbackSpotImage;
            }}
          />
        ) : (
          <div className={`spot-visual tone-${spot.coverTone}`} aria-hidden="true" />
        )
      }
      actions={[
        <Link to={detailHref(spot)} key="detail">
          <Button type="link" icon={<EnvironmentOutlined />} data-cue="[ OPEN ]">
            [ OPEN ]
          </Button>
        </Link>,
      ]}
    >
      <Space className="spot-card-content" direction="vertical" size={10} style={{ width: '100%' }}>
        <div className="spot-card-kicker">
          <span>{index ? String(index).padStart(2, '0') : spot.id}</span>
          <span>[ SPOT ]</span>
        </div>
        <div className="spot-card-heading">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {spot.name}
          </Typography.Title>
          <Typography.Text type="secondary">{spot.subtitle}</Typography.Text>
        </div>
        <Typography.Paragraph className="spot-card-summary" ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
          {spot.summary}
        </Typography.Paragraph>
        <Space className="spot-card-tags" size={[6, 6]} wrap>
          {spot.tags.slice(0, 3).map((tag) => (
            <Tag key={tag} color="green">
              {tag}
            </Tag>
          ))}
        </Space>
        <Typography.Text className="spot-card-duration" type="secondary">
          <ClockCircleOutlined /> 建议停留 {spot.durationMinutes} 分钟
        </Typography.Text>
      </Space>
    </Card>
  );
}
