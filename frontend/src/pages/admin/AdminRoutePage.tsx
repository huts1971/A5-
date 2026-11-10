import { PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { routePlans } from '../../api/mock/adminRouteData';
import type { RoutePlan, RouteSpot } from '../../types/scenic';

interface RouteFormValues {
  name: string;
  theme: string;
  durationMinutes: number;
  suitableCrowd: string;
  description: string;
  reason: string;
  spotsText: string;
}

function splitText(value: string) {
  return value
    .split(/[，,、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function routeToForm(route: RoutePlan): RouteFormValues {
  return {
    name: route.name,
    theme: route.theme,
    durationMinutes: route.durationMinutes,
    suitableCrowd: route.suitableCrowd.join('，'),
    description: route.description,
    reason: route.reason,
    spotsText: route.spots.map((spot) => `${spot.name}，${spot.stayMinutes}，${spot.reason}`).join('\n'),
  };
}

function parseRouteSpots(text: string): RouteSpot[] {
  return text
    .split('\n')
    .map((line, index) => {
      const [name = `景点 ${index + 1}`, minutes = '15', reason = '路线节点'] = line
        .split(/[，,]/)
        .map((item) => item.trim());
      return {
        spotId: `route-spot-${index + 1}`,
        name,
        stayMinutes: Number(minutes) || 15,
        reason,
      };
    })
    .filter((spot) => spot.name);
}

function formToRoute(values: RouteFormValues, previous?: RoutePlan): RoutePlan {
  return {
    id: previous?.id ?? `route-${Date.now()}`,
    mapId: previous?.mapId ?? 'ling-shan',
    name: values.name,
    theme: values.theme,
    durationMinutes: values.durationMinutes,
    suitableCrowd: splitText(values.suitableCrowd),
    description: values.description,
    reason: values.reason,
    spots: parseRouteSpots(values.spotsText),
  };
}

export default function AdminRoutePage() {
  const [form] = Form.useForm<RouteFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [routes, setRoutes] = useState<RoutePlan[]>(routePlans);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<RoutePlan>();
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditingRoute(undefined);
    form.setFieldsValue({
      name: '',
      theme: '演艺亲子、自然休闲',
      durationMinutes: 90,
      suitableCrowd: '亲子，休闲，拍照',
      description: '适合家庭游客的轻松路线，兼顾互动、休息和拍照。',
      reason: '路线减少高强度步行，优先选择更容易互动和停留的节点。',
      spotsText: '景区入口，5，确认入园与动线\n九龙灌浴，25，观看动态演艺\n百子戏弥勒，20，亲子互动拍照\n灵山大佛，30，核心地标收束',
    });
    setModalOpen(true);
  };

  const openEdit = (route: RoutePlan) => {
    setEditingRoute(route);
    form.setFieldsValue(routeToForm(route));
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const nextRoute = formToRoute(values, editingRoute);
      setRoutes((current) =>
        editingRoute
          ? current.map((item) => (item.id === editingRoute.id ? nextRoute : item))
          : [nextRoute, ...current],
      );
      messageApi.success(editingRoute ? '路线已更新' : '路线已新增');
      setModalOpen(false);
    } catch {
      messageApi.error('请检查路线表单必填项');
    } finally {
      setSaving(false);
    }
  };

  const remove = (routeId: string) => {
    setRoutes((current) => current.filter((route) => route.id !== routeId));
    messageApi.success('路线已删除');
  };

  const columns: ColumnsType<RoutePlan> = [
    {
      title: '路线名称',
      dataIndex: 'name',
      width: 180,
      render: (_, route) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{route.name}</Typography.Text>
          <Typography.Text type="secondary">{route.description}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '主题',
      dataIndex: 'theme',
      width: 110,
      render: (theme: string) => splitText(theme).map((item) => <Tag color="gold" key={item}>{item}</Tag>),
    },
    {
      title: '时长',
      dataIndex: 'durationMinutes',
      width: 90,
      render: (value: number) => `${value} 分钟`,
    },
    {
      title: '适合人群',
      dataIndex: 'suitableCrowd',
      render: (items: string[]) => items.map((item) => <Tag color="green" key={item}>{item}</Tag>),
    },
    {
      title: '景点顺序',
      dataIndex: 'spots',
      render: (spots: RouteSpot[]) => spots.map((spot) => spot.name).join(' → '),
    },
    {
      title: '操作',
      width: 150,
      render: (_, route) => (
        <Space>
          <Button type="link" onClick={() => openEdit(route)}>
            编辑
          </Button>
          <Popconfirm title="确认删除该路线？" onConfirm={() => remove(route.id)}>
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
          新增路线
        </Button>
      </div>

      <Card className="admin-table-card">
        <Table rowKey="id" columns={columns} dataSource={routes} pagination={{ pageSize: 6 }} scroll={{ x: 980 }} />
      </Card>

      <Modal
        className="admin-route-modal"
        title={editingRoute ? '编辑路线' : '新增路线'}
        open={modalOpen}
        width={760}
        confirmLoading={saving}
        onOk={submit}
        onCancel={() => setModalOpen(false)}
        forceRender
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="路线名称" rules={[{ required: true, message: '请输入路线名称' }]}>
            <Input />
          </Form.Item>
          <Space size={16} style={{ width: '100%' }} align="start">
            <Form.Item name="theme" label="主题" rules={[{ required: true }]} style={{ width: 180 }}>
              <Input />
            </Form.Item>
            <Form.Item name="durationMinutes" label="总时长（分钟）" rules={[{ required: true }]} style={{ width: 180 }}>
              <InputNumber min={30} max={360} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="suitableCrowd" label="适合人群" rules={[{ required: true, message: '请输入适合人群' }]}>
            <Input placeholder="亲子，休闲，拍照" />
          </Form.Item>
          <Form.Item name="description" label="路线描述" rules={[{ required: true, message: '请输入路线描述' }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="reason" label="推荐理由" rules={[{ required: true, message: '请输入推荐理由' }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="spotsText"
            label="景点顺序"
            tooltip="每行格式：景点名称，停留分钟，推荐原因"
            rules={[{ required: true, message: '请输入景点顺序' }]}
          >
            <Input.TextArea rows={5} placeholder="景区入口，5，确认入园与动线" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
