import { PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { getSpots } from '../../api';
import { toApiError } from '../../api/client';
import type { ScenicSpot, SpotTone } from '../../types/scenic';

interface SpotFormValues {
  name: string;
  subtitle: string;
  summary: string;
  story: string;
  tags: string;
  crowdTypes: string;
  durationMinutes: number;
  openInfo: string;
  serviceHint: string;
  coverTone: SpotTone;
  highlights: string;
}

const toneOptions: Array<{ value: SpotTone; label: string }> = [
  { value: 'water', label: '水景' },
  { value: 'culture', label: '文化' },
  { value: 'garden', label: '园林' },
  { value: 'service', label: '服务' },
];

function splitText(value: string) {
  return value
    .split(/[，,、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function spotToForm(spot: ScenicSpot): SpotFormValues {
  return {
    ...spot,
    tags: spot.tags.join('，'),
    crowdTypes: spot.crowdTypes.join('，'),
    highlights: spot.highlights.join('，'),
  };
}

function formToSpot(values: SpotFormValues, previous?: ScenicSpot): ScenicSpot {
  return {
    id: previous?.id ?? `spot-${Date.now()}`,
    name: values.name,
    subtitle: values.subtitle,
    summary: values.summary,
    story: values.story,
    tags: splitText(values.tags),
    crowdTypes: splitText(values.crowdTypes),
    durationMinutes: values.durationMinutes,
    openInfo: values.openInfo,
    serviceHint: values.serviceHint,
    coverTone: values.coverTone,
    highlights: splitText(values.highlights),
  };
}

export default function AdminSpotPage() {
  const [form] = Form.useForm<SpotFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [spots, setSpots] = useState<ScenicSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSpot, setEditingSpot] = useState<ScenicSpot>();

  const load = () => {
    setLoading(true);
    getSpots()
      .then(setSpots)
      .catch((error) => messageApi.error(toApiError(error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditingSpot(undefined);
    form.setFieldsValue({
      name: '',
      subtitle: '',
      summary: '',
      story: '',
      tags: '佛教文化，建筑艺术',
      crowdTypes: '研学，拍照',
      durationMinutes: 20,
      openInfo: '随景区开放时间参观',
      serviceHint: '请注意现场导览标识',
      coverTone: 'garden',
      highlights: '适合讲解，适合拍照',
    });
    setModalOpen(true);
  };

  const openEdit = (spot: ScenicSpot) => {
    setEditingSpot(spot);
    form.setFieldsValue(spotToForm(spot));
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const nextSpot = formToSpot(values, editingSpot);
      setSpots((current) =>
        editingSpot
          ? current.map((item) => (item.id === editingSpot.id ? nextSpot : item))
          : [nextSpot, ...current],
      );
      messageApi.success(editingSpot ? '景点已更新' : '景点已新增');
      setModalOpen(false);
    } catch {
      messageApi.error('请检查景点表单必填项');
    } finally {
      setSaving(false);
    }
  };

  const remove = (spotId: string) => {
    setSpots((current) => current.filter((spot) => spot.id !== spotId));
    messageApi.success('景点已删除');
  };

  const columns: ColumnsType<ScenicSpot> = [
    {
      title: '景点名称',
      dataIndex: 'name',
      width: 150,
      render: (_, spot) => <Typography.Text strong>{spot.name}</Typography.Text>,
    },
    {
      title: '标签',
      dataIndex: 'tags',
      render: (tags: string[]) =>
        tags.length ? (
          tags.map((tag) => <Tag key={tag}>{tag}</Tag>)
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
    },
    {
      title: '适合人群',
      dataIndex: 'crowdTypes',
      render: (crowdTypes: string[]) => crowdTypes.map((item) => <Tag color="green" key={item}>{item}</Tag>),
    },
    {
      title: '时长',
      dataIndex: 'durationMinutes',
      width: 90,
      render: (value: number) => `${value} 分钟`,
    },
    {
      title: '开放信息',
      dataIndex: 'openInfo',
      ellipsis: true,
    },
    {
      title: '操作',
      width: 150,
      render: (_, spot) => (
        <Space>
          <Button type="link" onClick={() => openEdit(spot)}>
            编辑
          </Button>
          <Popconfirm title="确认删除该景点？" onConfirm={() => remove(spot.id)}>
            <Button type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="admin-page">
      {contextHolder}
      <div className="admin-toolbar">
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增景点
        </Button>
      </div>

      <Card className="admin-table-card">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={spots}
          pagination={{ pageSize: 6 }}
          scroll={{ x: 940 }}
        />
      </Card>

      <Modal
        className="admin-spot-modal"
        title={editingSpot ? '编辑景点' : '新增景点'}
        open={modalOpen}
        width={760}
        confirmLoading={saving}
        onOk={submit}
        onCancel={() => setModalOpen(false)}
        forceRender
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="景点名称" rules={[{ required: true, message: '请输入景点名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="subtitle" label="副标题" rules={[{ required: true, message: '请输入副标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="summary" label="简介" rules={[{ required: true, message: '请输入景点简介' }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="story" label="讲解词" rules={[{ required: true, message: '请输入讲解词' }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Space size={16} style={{ width: '100%' }} align="start">
            <Form.Item name="durationMinutes" label="建议停留（分钟）" rules={[{ required: true }]} style={{ width: 180 }}>
              <InputNumber min={5} max={180} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="coverTone" label="视觉类型" rules={[{ required: true }]} style={{ width: 180 }}>
              <Select options={toneOptions} />
            </Form.Item>
          </Space>
          <Form.Item name="tags" label="标签">
            <Input placeholder="佛教文化，建筑艺术，摄影打卡；景区入口可留空" />
          </Form.Item>
          <Form.Item name="crowdTypes" label="适合人群" rules={[{ required: true, message: '请输入适合人群' }]}>
            <Input placeholder="亲子，长者，拍照" />
          </Form.Item>
          <Form.Item name="openInfo" label="开放信息" rules={[{ required: true, message: '请输入开放信息' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="serviceHint" label="服务提醒" rules={[{ required: true, message: '请输入服务提醒' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="highlights" label="讲解亮点">
            <Input placeholder="适合讲解，适合拍照" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
