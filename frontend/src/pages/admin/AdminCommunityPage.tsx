import {
  EyeInvisibleOutlined,
  EyeOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import {
  getAdminCommunityPosts,
  moderateCommunityPost,
} from '../../api/community';
import { toApiError } from '../../api/client';
import type {
  CommunityPost,
  CommunityPostStatus,
} from '../../types/community';

const PAGE_SIZE = 20;

type CommunityStatusFilter = 'all' | CommunityPostStatus;

export default function AdminCommunityPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [items, setItems] = useState<CommunityPost[]>([]);
  const [status, setStatus] = useState<CommunityStatusFilter>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [moderatingId, setModeratingId] = useState<number>();

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    getAdminCommunityPosts({ status, page, pageSize: PAGE_SIZE })
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
        if (result.items.length === 0 && page > 1) {
          setPage(Math.max(1, page - 1));
        }
      })
      .catch((loadError) => {
        const apiError = toApiError(loadError, '社区留言加载失败，请稍后重试。');
        setError(apiError.message);
        messageApi.error(apiError.message);
      })
      .finally(() => setLoading(false));
  }, [messageApi, page, status]);

  useEffect(() => {
    load();
  }, [load]);

  const handleModerate = async (
    post: CommunityPost,
    nextStatus: Extract<CommunityPostStatus, 'published' | 'hidden'>,
  ) => {
    setModeratingId(post.id);
    try {
      await moderateCommunityPost(post.id, nextStatus);
      messageApi.success(nextStatus === 'hidden' ? '留言已隐藏。' : '留言已恢复公开。');
      load();
    } catch (moderateError) {
      messageApi.error(toApiError(moderateError, '操作失败，请稍后重试。').message);
    } finally {
      setModeratingId(undefined);
    }
  };

  const columns: ColumnsType<CommunityPost> = [
    {
      title: '发布时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (value: string) => {
        const time = formatDateTime(value);
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text>{time.date}</Typography.Text>
            <Typography.Text type="secondary">{time.time}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '游客',
      dataIndex: 'authorName',
      width: 170,
      ellipsis: true,
    },
    {
      title: '留言内容',
      dataIndex: 'content',
      render: (value: string) => (
        <Typography.Paragraph
          style={{ margin: 0 }}
          ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
        >
          {value}
        </Typography.Paragraph>
      ),
    },
    {
      title: '关联景点',
      dataIndex: 'spot',
      width: 150,
      render: (spot: CommunityPost['spot']) =>
        spot ? <Tag color="green">{spot.name}</Tag> : <Typography.Text type="secondary">未关联</Typography.Text>,
    },
    {
      title: '点赞',
      dataIndex: 'likeCount',
      width: 80,
      align: 'center',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: CommunityPostStatus) => communityStatusTag(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 130,
      fixed: 'right',
      render: (_, post) => {
        if (post.status === 'deleted') {
          return <Typography.Text type="secondary">游客已删除</Typography.Text>;
        }
        const nextStatus = post.status === 'hidden' ? 'published' : 'hidden';
        const restore = nextStatus === 'published';
        return (
          <Popconfirm
            title={restore ? '恢复公开这条留言？' : '隐藏这条留言？'}
            description={
              restore
                ? '恢复后，所有游客都可以再次看到它。'
                : '隐藏后，仅发布者和管理员仍可查看。'
            }
            okText={restore ? '恢复' : '隐藏'}
            cancelText="取消"
            onConfirm={() => handleModerate(post, nextStatus)}
          >
            <Button
              icon={restore ? <EyeOutlined /> : <EyeInvisibleOutlined />}
              loading={moderatingId === post.id}
            >
              {restore ? '恢复' : '隐藏'}
            </Button>
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <div className="admin-page">
      {contextHolder}
      <div className="admin-toolbar">
        <Space wrap>
          <Typography.Text type="secondary">共 {total} 条</Typography.Text>
          <Select
            value={status}
            style={{ width: 140 }}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'published', label: '公开中' },
              { value: 'hidden', label: '已隐藏' },
              { value: 'deleted', label: '游客已删除' },
            ]}
            onChange={(value: CommunityStatusFilter) => {
              setStatus(value);
              setPage(1);
            }}
            aria-label="留言状态筛选"
          />
        </Space>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
          刷新
        </Button>
      </div>

      {error ? (
        <Alert
          type="warning"
          showIcon
          message="社区留言加载失败"
          description={error}
          action={<Button onClick={load}>重试</Button>}
        />
      ) : null}

      <Card className="admin-table-card">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          scroll={{ x: 1050 }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            onChange: setPage,
          }}
        />
      </Card>
    </div>
  );
}

function communityStatusTag(status: CommunityPostStatus) {
  if (status === 'published') return <Tag color="success">公开中</Tag>;
  if (status === 'hidden') return <Tag color="warning">已隐藏</Tag>;
  return <Tag>游客已删除</Tag>;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: '未知日期', time: '未知时间' };
  }
  return {
    date: new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date),
    time: new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date),
  };
}
