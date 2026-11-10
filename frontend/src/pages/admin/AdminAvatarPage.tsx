import { CheckCircleOutlined, DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, RobotOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Space, Table, Tag, Typography, Upload, message } from 'antd';
import type { UploadFile } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import {
  activateDigitalHumanAvatar,
  deleteDigitalHumanAvatar,
  getDigitalHumanAvatarPreview,
  listDigitalHumanAvatars,
  updateDigitalHumanAvatar,
  uploadDigitalHumanAvatar,
} from '../../api';
import { toApiError } from '../../api/client';
import type { DigitalHumanAvatar } from '../../types/api';
import type { DigitalHumanRuntimeConfig } from '../../types/api';
import UnityWebGLGuideStage from '../../components/guide/UnityWebGLGuideStage';

const BUILTIN_AVATAR_ID = 'builtin-avatar151';
const DEMO_AVATARS = [
  { id: 'demo-ling-xiaoyu', name: '灵小语' },
  { id: 'demo-qingyin', name: '晴音' },
] as const;
const DEMO_AVATAR_IDS = new Set<string>(DEMO_AVATARS.map((item) => item.id));

export default function AdminAvatarPage() {
  const [items, setItems] = useState<DigitalHumanAvatar[]>([]);
  const [messageApi, contextHolder] = message.useMessage();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<DigitalHumanAvatar | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [preview, setPreview] = useState<DigitalHumanRuntimeConfig | null>(null);
  const [previewingId, setPreviewingId] = useState('');
  const [activatingId, setActivatingId] = useState('');
  const [previewPhase, setPreviewPhase] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [previewProgress, setPreviewProgress] = useState(0);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [form] = Form.useForm<{ name: string; note: string }>();
  const [editForm] = Form.useForm<{ name: string; note: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const displayItems = useMemo(() => {
    const renamedItems = items.map((item) => (
      item.id === BUILTIN_AVATAR_ID ? { ...item, name: '灵诗音' } : item
    ));
    const builtinAvatar = renamedItems.find((item) => item.id === BUILTIN_AVATAR_ID);
    if (!builtinAvatar) return renamedItems;

    return [
      ...renamedItems,
      ...DEMO_AVATARS.map(({ id, name }) => ({
        ...builtinAvatar,
        id,
        name,
        note: '演示形象',
        sourceFilename: '',
        resourceSize: 0,
        isBuiltin: true,
        isActive: false,
        activatedAt: undefined,
      })),
    ];
  }, [items]);
  const current = useMemo(
    () => displayItems.find((item) => item.isActive),
    [displayItems],
  );

  useEffect(() => {
    listDigitalHumanAvatars()
      .then(setItems)
      .catch((reason) => setError(toApiError(reason).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (editing) {
      editForm.setFieldsValue({ name: editing.name, note: editing.note });
    }
  }, [editForm, editing]);

  const columns: ColumnsType<DigitalHumanAvatar> = [
    {
      title: '形象信息',
      dataIndex: 'name',
      render: (name: string, item) => (
        <div style={{ minWidth: 0, wordBreak: 'break-word' }}>
          <Typography.Text strong>{name}</Typography.Text>
          {!item.isBuiltin && item.note ? (
            <div><Typography.Text type="secondary">{item.note}</Typography.Text></div>
          ) : null}
        </div>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      render: (_, item) => (
        <Tag color={item.isActive ? 'green' : 'default'}>
          {item.isActive ? '当前使用' : '候选'}
        </Tag>
      ),
    },
    {
      title: '文件信息',
      key: 'file',
      responsive: ['lg'],
      render: (_, item) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{item.sourceFilename || '-'}</Typography.Text>
          <Typography.Text type="secondary">
            {item.resourceSize ? `${(item.resourceSize / 1024 / 1024).toFixed(2)} MB` : '-'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '管理记录',
      key: 'history',
      width: 300,
      responsive: ['lg'],
      render: (_, item) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>上传：{item.uploadedBy} · {new Date(item.createdAt).toLocaleString('zh-CN')}</Typography.Text>
          <Typography.Text type="secondary">修改：{new Date(item.updatedAt).toLocaleString('zh-CN')}</Typography.Text>
          <Typography.Text type="secondary">
            启用：{item.activatedAt ? new Date(item.activatedAt).toLocaleString('zh-CN') : '-'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 84,
      render: (_, item) => (
        DEMO_AVATAR_IDS.has(item.id) || (item.isBuiltin && item.isActive) ? (
          <Typography.Text type="secondary">-</Typography.Text>
        ) : <Space size={2} wrap>
          {!item.isBuiltin ? (
            <Button
              size="small"
              icon={<EyeOutlined />}
              aria-label={`预览 ${item.name}`}
              loading={previewingId === item.id}
              onClick={() => handlePreview(item)}
            />
          ) : null}
          <Button
            size="small"
            icon={<EditOutlined />}
            aria-label={`编辑 ${item.name}`}
            disabled={item.isBuiltin}
            onClick={() => {
              setEditing(item);
            }}
          />
          {!item.isActive ? (
            <Popconfirm
              title={`将“${item.name}”设为当前形象？`}
              description="新打开或刷新的游客端页面将使用该版本。"
              okText="确认启用"
              cancelText="取消"
              onConfirm={() => handleActivate(item)}
            >
              <Button
                size="small"
                icon={<CheckCircleOutlined />}
                aria-label={`设为当前 ${item.name}`}
                loading={activatingId === item.id}
              />
            </Popconfirm>
          ) : null}
          <Popconfirm
            title="删除这个候选数字人？"
            description="删除后本地资源将一并移除。"
            okText="确认删除"
            cancelText="取消"
            disabled={item.isBuiltin || item.isActive}
            onConfirm={() => handleDelete(item)}
          >
            <Button
              danger
              size="small"
              icon={<DeleteOutlined />}
              aria-label={`删除 ${item.name}`}
              disabled={item.isBuiltin || item.isActive}
              loading={deletingId === item.id}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const submitUpload = async () => {
    const values = await form.validateFields();
    const file = files[0]?.originFileObj;
    if (!file) {
      messageApi.error('请选择 Unity WebGL ZIP 文件');
      return;
    }
    setUploading(true);
    try {
      const imported = await uploadDigitalHumanAvatar(values.name, values.note ?? '', file);
      setItems((current) => [imported, ...current]);
      form.resetFields();
      setFiles([]);
      setUploadOpen(false);
      messageApi.success('数字人导入成功，已保存为候选版本');
    } catch (reason) {
      messageApi.error(toApiError(reason).message);
    } finally {
      setUploading(false);
    }
  };

  const submitEdit = async () => {
    if (!editing) return;
    const values = await editForm.validateFields();
    setSaving(true);
    try {
      const updated = await updateDigitalHumanAvatar(
        editing.id,
        values.name,
        values.note ?? '',
      );
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditing(null);
      messageApi.success('数字人信息已更新');
    } catch (reason) {
      messageApi.error(toApiError(reason).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: DigitalHumanAvatar) => {
    setDeletingId(item.id);
    try {
      await deleteDigitalHumanAvatar(item.id);
      setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
      messageApi.success('候选数字人已删除');
    } catch (reason) {
      messageApi.error(toApiError(reason).message);
    } finally {
      setDeletingId('');
    }
  };

  const handlePreview = async (item: DigitalHumanAvatar) => {
    setPreviewingId(item.id);
    setPreviewPhase('loading');
    setPreviewProgress(0);
    try {
      setPreview(await getDigitalHumanAvatarPreview(item.id));
    } catch (reason) {
      messageApi.error(toApiError(reason).message);
    } finally {
      setPreviewingId('');
    }
  };

  const handleActivate = async (item: DigitalHumanAvatar) => {
    setActivatingId(item.id);
    try {
      const activated = await activateDigitalHumanAvatar(item.id);
      setItems((current) =>
        current.map((currentItem) => ({
          ...currentItem,
          isActive: currentItem.id === activated.id,
          activatedAt:
            currentItem.id === activated.id
              ? activated.activatedAt
              : currentItem.activatedAt,
        })),
      );
      messageApi.success('数字人已切换，游客端刷新后生效');
    } catch (reason) {
      messageApi.error(toApiError(reason).message);
    } finally {
      setActivatingId('');
    }
  };

  return (
    <div className="admin-page">
      {contextHolder}
      <Space align="start" style={{ justifyContent: 'space-between', width: '100%' }} wrap>
        <span />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setUploadOpen(true)}>
          导入数字人
        </Button>
      </Space>

      {error ? <Alert type="error" showIcon message="数字人版本加载失败" description={error} /> : null}

      <Card loading={loading} title="当前形象">
        {current ? (
          <Space align="start">
            <RobotOutlined style={{ fontSize: 28 }} />
            <Space direction="vertical" size={0}>
              <Space>
                <Typography.Text strong>{current.name}</Typography.Text>
                <Tag color="green">当前使用</Tag>
              </Space>
              {!current.isBuiltin && current.note ? (
                <Typography.Text type="secondary">{current.note}</Typography.Text>
              ) : null}
            </Space>
          </Space>
        ) : null}
      </Card>

      <Card className="admin-table-card" title="形象版本">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={displayItems}
          pagination={false}
          tableLayout="fixed"
        />
      </Card>

      <Modal
        className="admin-avatar-modal"
        title="导入 Unity WebGL 数字人"
        open={uploadOpen}
        onCancel={() => setUploadOpen(false)}
        onOk={submitUpload}
        okText={uploading ? '上传并校验中' : '开始导入'}
        cancelText="取消"
        confirmLoading={uploading}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="形象名称"
            rules={[{ required: true, whitespace: true, message: '请输入形象名称' }]}
          >
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea maxLength={500} rows={3} />
          </Form.Item>
          <Form.Item label="Unity WebGL ZIP">
            <Upload
              accept=".zip,application/zip"
              beforeUpload={() => false}
              fileList={files}
              maxCount={1}
              onChange={({ fileList }) => setFiles(fileList.slice(-1))}
            >
              <Button icon={<UploadOutlined />}>选择 ZIP 文件</Button>
            </Upload>
          </Form.Item>
          <Typography.Text type="secondary">
            ZIP 最大 100 MB，需包含唯一的 Unity WebGL Build 目录。
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        className="admin-avatar-modal"
        title="预览数字人"
        open={Boolean(preview)}
        onCancel={() => setPreview(null)}
        footer={
          <Button onClick={() => setPreview(null)}>
            关闭
          </Button>
        }
        width={620}
        destroyOnHidden
      >
        {preview ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text>
              {previewPhase === 'ready'
                ? '加载完成'
                : previewPhase === 'fallback'
                  ? '加载失败，已显示兜底形象'
                  : `加载进度 ${Math.round(previewProgress * 100)}%`}
            </Typography.Text>
            <div className="admin-avatar-preview">
              <UnityWebGLGuideStage
                status="idle"
                audioState="idle"
                runtimeConfig={preview}
                fallbackImageUrl={preview.fallbackUrl || undefined}
                ariaLabel="Unity WebGL 数字人预览"
                onPhaseChange={setPreviewPhase}
                onProgressChange={setPreviewProgress}
              />
            </div>
          </Space>
        ) : null}
      </Modal>

      <Modal
        className="admin-avatar-modal"
        title="编辑数字人信息"
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={submitEdit}
        okText="保存修改"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="name"
            label="形象名称"
            rules={[{ required: true, whitespace: true, message: '请输入形象名称' }]}
          >
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea maxLength={500} rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
