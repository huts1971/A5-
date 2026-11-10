import { ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Collapse, Empty, List, Progress, Rate, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { getUserFeedback } from '../../api/feedback';
import { toApiError } from '../../api/client';
import type { UserFeedbackItem } from '../../types/api';

export default function AdminFeedbackPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [items, setItems] = useState<UserFeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    getUserFeedback()
      .then(setItems)
      .catch((err) => {
        const apiError = toApiError(err);
        setError(apiError.message);
        messageApi.error(apiError.message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const feedbackStats = useMemo(() => buildFeedbackStats(items), [items]);

  const columns: ColumnsType<UserFeedbackItem> = [
    {
      title: '反馈时间',
      dataIndex: 'createdAt',
      width: 190,
      render: (value: string) => {
        const time = formatFeedbackDateTime(value);
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text>{time.date}</Typography.Text>
            <Typography.Text type="secondary">{time.time}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '评分',
      dataIndex: 'rating',
      width: 190,
      render: (value: number) => (
        <Space size={8} wrap>
          <Rate className="admin-feedback-rating" disabled value={value} />
          {isLowRating(value) ? <Tag color="error">需关注</Tag> : null}
        </Space>
      ),
    },
    {
      title: '反馈内容',
      dataIndex: 'content',
      render: (value: string) => (
        <Typography.Paragraph style={{ margin: 0 }} ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}>
          {value}
        </Typography.Paragraph>
      ),
    },
  ];

  return (
    <div className="admin-page">
      {contextHolder}
      <div className="admin-toolbar">
        <Typography.Text type="secondary">共 {items.length} 条</Typography.Text>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
          刷新
        </Button>
      </div>

      {error ? <Alert type="warning" showIcon message="反馈加载失败" description={error} /> : null}

      <div className="admin-feedback-overview">
        <Card size="small" className="admin-feedback-overview-card">
          <Typography.Text type="secondary">平均评分</Typography.Text>
          <Space align="baseline" size={8}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {feedbackStats.total ? feedbackStats.averageRating.toFixed(1) : '--'}
            </Typography.Title>
            <Typography.Text type="secondary">/ 5</Typography.Text>
          </Space>
          <Tag color={feedbackStats.summary.color}>{feedbackStats.summary.label}</Tag>
        </Card>

        <Card size="small" className="admin-feedback-overview-card">
          <Typography.Text type="secondary">低分反馈</Typography.Text>
          <Space align="baseline" size={8}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {feedbackStats.lowRatingCount}
            </Typography.Title>
            <Typography.Text type="secondary">条</Typography.Text>
          </Space>
          <Typography.Text type="secondary">占比 {feedbackStats.lowRatingRate.toFixed(0)}%</Typography.Text>
        </Card>

        <Card size="small" className="admin-feedback-distribution-card" title="评分分布">
          <div className="admin-feedback-distribution">
            {feedbackStats.ratingDistribution.map((bucket) => (
              <div className="admin-feedback-distribution__row" key={bucket.rating}>
                <Typography.Text>{bucket.rating} 星</Typography.Text>
                <Progress percent={bucket.share} showInfo={false} size="small" />
                <Typography.Text type="secondary">{bucket.count} 条</Typography.Text>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Collapse
        className="admin-feedback-low-collapse"
        items={[
          {
            key: 'low-feedback',
            label: `低分反馈汇总（≤2 星 ${feedbackStats.lowRatingCount} 条）`,
            children: feedbackStats.lowRatingItems.length ? (
              <List
                size="small"
                dataSource={feedbackStats.lowRatingItems}
                renderItem={(item) => {
                  const time = formatFeedbackDateTime(item.createdAt);
                  return (
                    <List.Item>
                      <Space direction="vertical" size={4} className="admin-feedback-low-item">
                        <Space size={8} wrap>
                          <Rate className="admin-feedback-rating" disabled value={item.rating} />
                          <Typography.Text type="secondary">
                            {time.date} {time.time}
                          </Typography.Text>
                        </Space>
                        <Typography.Paragraph
                          style={{ margin: 0 }}
                          ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
                        >
                          {item.content}
                        </Typography.Paragraph>
                      </Space>
                    </List.Item>
                  );
                }}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无低分反馈" />
            ),
          },
        ]}
      />

      <Card className="admin-table-card">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          rowClassName={(record) => (isLowRating(record.rating) ? 'admin-feedback-row--low' : '')}
          scroll={{ x: 760 }}
        />
      </Card>
    </div>
  );
}

function formatFeedbackDateTime(value: string) {
  const [datePart = '', rawTimePart = ''] = value.split(/[T\s]/);
  const timePart = rawTimePart.split(/[.+Z]/)[0] ?? '';
  return {
    date: datePart || '未知日期',
    time: timePart.slice(0, 8) || '未知时间',
  };
}

function buildFeedbackStats(items: UserFeedbackItem[]) {
  const total = items.length;
  const ratingSum = items.reduce((sum, item) => sum + item.rating, 0);
  const averageRating = total ? ratingSum / total : 0;
  const lowRatingItems = items.filter((item) => isLowRating(item.rating));
  const ratingDistribution = [5, 4, 3, 2, 1].map((rating) => {
    const count = items.filter((item) => item.rating === rating).length;
    return {
      rating,
      count,
      share: total ? Number(((count / total) * 100).toFixed(1)) : 0,
    };
  });

  return {
    total,
    averageRating,
    lowRatingItems,
    lowRatingCount: lowRatingItems.length,
    lowRatingRate: total ? (lowRatingItems.length / total) * 100 : 0,
    ratingDistribution,
    summary: getFeedbackSummary(averageRating, total),
  };
}

function isLowRating(rating: number) {
  return rating <= 2;
}

function getFeedbackSummary(averageRating: number, total: number) {
  if (!total) {
    return { label: '暂无反馈数据', color: 'default' };
  }
  if (averageRating >= 4.5) {
    return { label: '整体体验优秀', color: 'success' };
  }
  if (averageRating >= 4) {
    return { label: '整体反馈良好', color: 'processing' };
  }
  if (averageRating >= 3) {
    return { label: '整体体验一般', color: 'warning' };
  }
  return { label: '需重点关注', color: 'error' };
}
