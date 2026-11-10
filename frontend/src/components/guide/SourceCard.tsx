import { FileSearchOutlined, LinkOutlined } from '@ant-design/icons';
import { Alert, Card, Empty, Skeleton, Space, Tag, Typography } from 'antd';
import type { ChatSource } from '../../types/scenic';

export interface SourceCardProps {
  source?: ChatSource;
  loading?: boolean;
  error?: string;
  emptyText?: string;
}

export default function SourceCard({
  source,
  loading = false,
  error,
  emptyText = '暂无来源资料',
}: SourceCardProps) {
  if (loading) {
    return (
      <Card size="small" className="source-card">
        <Skeleton active paragraph={{ rows: 2 }} />
      </Card>
    );
  }

  if (error) {
    return (
      <Card size="small" className="source-card">
        <Alert type="warning" showIcon message="来源加载失败" description={error} />
      </Card>
    );
  }

  if (!source) {
    return (
      <Card size="small" className="source-card">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
      </Card>
    );
  }

  return (
    <Card size="small" className="source-card" data-cue="[ SOURCE ]">
      <Space size={6} wrap>
        <Tag color={provenanceMeta(source).color}>{provenanceMeta(source).label}</Tag>
        {source.sourceLevel ? <Tag>{source.sourceLevel}</Tag> : null}
      </Space>
      <Typography.Text strong style={{ display: 'block', marginTop: 6 }}>
        <FileSearchOutlined /> {source.title}
      </Typography.Text>
      <Typography.Paragraph type="secondary" style={{ margin: '6px 0 0' }}>
        {source.spotName}：{source.snippet}
      </Typography.Paragraph>
      {source.sourceUrl ? (
        <Typography.Link href={source.sourceUrl} target="_blank" rel="noreferrer">
          <LinkOutlined /> {source.sourceUrl}
        </Typography.Link>
      ) : null}
    </Card>
  );
}

function provenanceMeta(source: ChatSource): { label: string; color: string } {
  if (source.sourceType === 'database') {
    return { label: '景区资料库', color: 'green' };
  }
  if (source.sourceType === 'approved_web') {
    return { label: '已审核联网补充', color: 'blue' };
  }
  if (source.sourceType === 'realtime_web') {
    return { label: '基于联网搜索', color: 'gold' };
  }
  return { label: source.section || '资料片段', color: 'default' };
}
