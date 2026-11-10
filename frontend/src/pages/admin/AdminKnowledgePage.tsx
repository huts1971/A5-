import {
  CloudSyncOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeInvisibleOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Popconfirm, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  deleteKnowledgeDoc,
  deleteOfficialWebFact,
  listKnowledgeDocs,
  listOfficialWebFacts,
  listWebFactCandidates,
  rebuildKnowledgeIndex,
  reviewWebFactCandidate,
  updateOfficialWebFact,
  updateWebFactCandidate,
  uploadKnowledgeDoc,
} from '../../api';
import { toApiError } from '../../api/client';
import type {
  KnowledgeDocItem,
  OfficialWebFact,
  OfficialWebFactUpdate,
  WebFactCandidate,
  WebFactCandidateStatus,
  WebFactReviewAction,
} from '../../types/api';

type CandidateFilter = WebFactCandidateStatus | '';
export type KnowledgeView = 'docs' | 'facts' | 'candidates';

interface CandidateFormValues {
  factKey: string;
  factValue: string;
  sourceUrl: string;
  sourceLevel: string;
}

interface OfficialFactFormValues {
  factKey: string;
  factValue: string;
  sourceUrl: string;
}

const FACT_KEY_OPTIONS = [
  { value: 'opening_time', label: '开放时间' },
  { value: 'ticket', label: '票务信息' },
  { value: 'traffic', label: '交通到达' },
  { value: 'night_view', label: '夜间景观' },
  { value: 'performance', label: '演艺活动' },
  { value: 'photo_spot', label: '摄影打卡' },
  { value: 'service', label: '服务设施' },
  { value: 'weather', label: '天气信息' },
  { value: 'visit_minutes', label: '建议游览时长' },
  { value: 'suitability', label: '适合情况' },
  { value: 'web_supplement', label: '联网补充' },
];

const SOURCE_LEVEL_OPTIONS = [
  { value: 'official', label: '官方' },
  { value: 'authoritative', label: '权威' },
  { value: 'ordinary', label: '普通' },
];

const FACT_KEY_LABELS = Object.fromEntries(
  FACT_KEY_OPTIONS.map((option) => [option.value, option.label]),
) as Record<string, string>;

const SOURCE_LEVEL_LABELS = Object.fromEntries(
  SOURCE_LEVEL_OPTIONS.map((option) => [option.value, option.label]),
) as Record<string, string>;

function factKeyLabel(value: string) {
  return FACT_KEY_LABELS[value] ?? value;
}

function sourceLevelLabel(value: string) {
  return SOURCE_LEVEL_LABELS[value] ?? value;
}

function sourceLevelColor(value: string) {
  if (value === 'official') {
    return 'green';
  }
  if (value === 'authoritative') {
    return 'blue';
  }
  return 'default';
}

function docStatusTag(indexed: boolean) {
  return indexed ? <Tag color="green">已索引</Tag> : <Tag color="gold">待重建</Tag>;
}

function docSourceTag(sourceType: string) {
  const normalized = sourceType.toLowerCase();
  if (normalized === 'docx') {
    return <Tag color="blue">Word 文档</Tag>;
  }
  if (normalized === 'md' || normalized === 'markdown') {
    return <Tag color="green">Markdown</Tag>;
  }
  if (normalized === 'txt') {
    return <Tag color="cyan">文本文件</Tag>;
  }
  return <Tag>{sourceType}</Tag>;
}

function candidateStatusTag(status: WebFactCandidate['status']) {
  const map = {
    pending_review: { color: 'gold', label: '待审核' },
    approved_supplemental: { color: 'blue', label: '已补充' },
    approved_official: { color: 'green', label: '已入库' },
    rejected: { color: 'red', label: '已拒绝' },
    ignored: { color: 'default', label: '已忽略' },
  } as const;
  return <Tag color={map[status].color}>{map[status].label}</Tag>;
}

interface AdminKnowledgePageProps {
  view?: KnowledgeView;
}

export default function AdminKnowledgePage({ view = 'docs' }: AdminKnowledgePageProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const [candidateForm] = Form.useForm<CandidateFormValues>();
  const [officialFactForm] = Form.useForm<OfficialFactFormValues>();
  const docUploadInputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<KnowledgeDocItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string>();
  const [rebuilding, setRebuilding] = useState(false);
  const [officialFacts, setOfficialFacts] = useState<OfficialWebFact[]>([]);
  const [officialFactsLoading, setOfficialFactsLoading] = useState(false);
  const [editingOfficialFact, setEditingOfficialFact] = useState<OfficialWebFact>();
  const [savingOfficialFact, setSavingOfficialFact] = useState(false);
  const [deletingOfficialFactId, setDeletingOfficialFactId] = useState<number>();
  const [candidates, setCandidates] = useState<WebFactCandidate[]>([]);
  const [candidateStatus, setCandidateStatus] = useState<CandidateFilter>('pending_review');
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState<number>();
  const [editingCandidate, setEditingCandidate] = useState<WebFactCandidate>();
  const [detailCandidate, setDetailCandidate] = useState<WebFactCandidate>();
  const [savingCandidate, setSavingCandidate] = useState(false);

  const stats = useMemo(() => {
    const indexedDocs = docs.filter((doc) => doc.indexed).length;
    return {
      indexedDocs,
      pendingDocs: docs.length - indexedDocs,
    };
  }, [docs]);

  const loadDocs = async () => {
    setDocsLoading(true);
    try {
      setDocs(await listKnowledgeDocs());
    } catch (error) {
      const apiError = toApiError(error);
      messageApi.error(apiError.message);
    } finally {
      setDocsLoading(false);
    }
  };

  const loadOfficialFacts = async () => {
    setOfficialFactsLoading(true);
    try {
      setOfficialFacts(await listOfficialWebFacts());
    } catch (error) {
      const apiError = toApiError(error);
      messageApi.error(apiError.message);
    } finally {
      setOfficialFactsLoading(false);
    }
  };

  const loadCandidates = async (status = candidateStatus) => {
    setCandidatesLoading(true);
    try {
      setCandidates(await listWebFactCandidates(status));
    } catch (error) {
      const apiError = toApiError(error);
      messageApi.error(apiError.message);
    } finally {
      setCandidatesLoading(false);
    }
  };

  useEffect(() => {
    if (view === 'docs') {
      void loadDocs();
    }
    if (view === 'facts') {
      void loadOfficialFacts();
    }
  }, [view]);

  useEffect(() => {
    if (view === 'candidates') {
      void loadCandidates(candidateStatus);
    }
  }, [candidateStatus, view]);

  const rebuild = async () => {
    setRebuilding(true);
    try {
      const result = await rebuildKnowledgeIndex();
      await loadDocs();
      messageApi.success(result.message);
    } catch (error) {
      const apiError = toApiError(error);
      messageApi.error(apiError.message);
    } finally {
      setRebuilding(false);
    }
  };

  const openDocUploadPicker = () => {
    docUploadInputRef.current?.click();
  };

  const uploadDoc = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    setUploadingDoc(true);
    try {
      await uploadKnowledgeDoc(file);
      await loadDocs();
      messageApi.success('知识文档已上传并完成切片');
    } catch (error) {
      const apiError = toApiError(error);
      messageApi.error(apiError.message);
    } finally {
      setUploadingDoc(false);
    }
  };

  const removeDoc = async (docId: string) => {
    setDeletingDocId(docId);
    try {
      await deleteKnowledgeDoc(docId);
      await loadDocs();
      messageApi.success('知识文档已删除');
    } catch (error) {
      const apiError = toApiError(error);
      messageApi.error(apiError.message);
    } finally {
      setDeletingDocId(undefined);
    }
  };

  const reviewCandidate = async (candidateId: number, action: WebFactReviewAction) => {
    setReviewingId(candidateId);
    try {
      await reviewWebFactCandidate(candidateId, action);
      await loadCandidates(candidateStatus);
      if (action === 'approve_official') {
        await loadOfficialFacts();
      }
      messageApi.success('联网事实候选已处理');
    } catch (error) {
      const apiError = toApiError(error);
      messageApi.error(apiError.message);
    } finally {
      setReviewingId(undefined);
    }
  };

  const openCandidateEditor = (candidate: WebFactCandidate) => {
    setEditingCandidate(candidate);
    candidateForm.setFieldsValue({
      factKey: candidate.factKey,
      factValue: candidate.factValue,
      sourceUrl: candidate.sourceUrl,
      sourceLevel: candidate.sourceLevel || 'ordinary',
    });
  };

  const saveCandidateDraft = async () => {
    if (!editingCandidate) {
      return;
    }
    const values = await candidateForm.validateFields();
    setSavingCandidate(true);
    try {
      await updateWebFactCandidate(editingCandidate.id, {
        factKey: values.factKey,
        factValue: values.factValue,
        sourceUrl: values.sourceUrl,
        sourceLevel: values.sourceLevel,
      });
      setEditingCandidate(undefined);
      await loadCandidates(candidateStatus);
      messageApi.success('候选事实已补充，仍保持待审核');
    } catch (error) {
      const apiError = toApiError(error);
      messageApi.error(apiError.message);
    } finally {
      setSavingCandidate(false);
    }
  };

  const openOfficialFactEditor = (fact: OfficialWebFact) => {
    setEditingOfficialFact(fact);
    officialFactForm.setFieldsValue({
      factKey: fact.factKey,
      factValue: fact.factValue,
      sourceUrl: fact.sourceUrl,
    });
  };

  const saveOfficialFact = async () => {
    if (!editingOfficialFact) {
      return;
    }
    const values = await officialFactForm.validateFields();
    setSavingOfficialFact(true);
    try {
      const payload: OfficialWebFactUpdate = {
        factKey: values.factKey,
        factValue: values.factValue,
        sourceUrl: values.sourceUrl,
      };
      await updateOfficialWebFact(editingOfficialFact.id, payload);
      setEditingOfficialFact(undefined);
      await loadOfficialFacts();
      messageApi.success('入库事实已更新');
    } catch (error) {
      const apiError = toApiError(error);
      messageApi.error(apiError.message);
    } finally {
      setSavingOfficialFact(false);
    }
  };

  const removeOfficialFact = async (factId: number) => {
    setDeletingOfficialFactId(factId);
    try {
      await deleteOfficialWebFact(factId);
      await loadOfficialFacts();
      messageApi.success('入库事实已删除');
    } catch (error) {
      const apiError = toApiError(error);
      messageApi.error(apiError.message);
    } finally {
      setDeletingOfficialFactId(undefined);
    }
  };

  const docColumns: ColumnsType<KnowledgeDocItem> = [
    {
      title: '知识文档',
      dataIndex: 'title',
      width: 300,
      render: (_, doc) => <Typography.Text strong>{doc.title}</Typography.Text>,
    },
    {
      title: '来源类型',
      dataIndex: 'sourceType',
      width: 140,
      render: (_, doc) => docSourceTag(doc.sourceType),
    },
    {
      title: '索引状态',
      dataIndex: 'indexed',
      width: 110,
      render: docStatusTag,
    },
    {
      title: '切片数',
      dataIndex: 'chunkCount',
      width: 90,
    },
    {
      title: '存储路径',
      dataIndex: 'path',
      render: (path: string) => (
        <Typography.Text code copyable ellipsis={{ tooltip: path }}>
          {path}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      width: 110,
      fixed: 'right',
      render: (_, doc) => (
        <Popconfirm
          title="删除这份知识文档？"
          description="删除后会同时移除对应切片，并从检索索引中移除。"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => removeDoc(doc.id)}
        >
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
            loading={deletingDocId === doc.id}
          >
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  const candidateColumns: ColumnsType<WebFactCandidate> = [
    {
      title: '事实候选',
      dataIndex: 'factValue',
      width: 360,
      render: (_, candidate) => (
        <div className="candidate-fact-cell">
          <Typography.Text className="candidate-fact-preview" strong>
            {candidate.factValue}
          </Typography.Text>
          <div className="candidate-fact-cell__footer">
            <Typography.Text className="candidate-question-preview" type="secondary">
              {candidate.question}
            </Typography.Text>
            <Button
              className="candidate-detail-link"
              type="link"
              size="small"
              onClick={() => setDetailCandidate(candidate)}
            >
              查看详情
            </Button>
          </div>
        </div>
      ),
    },
    {
      title: '字段',
      dataIndex: 'factKey',
      width: 120,
      render: (value: string) => <Tag>{factKeyLabel(value)}</Tag>,
    },
    {
      title: '来源',
      dataIndex: 'sourceUrl',
      width: 260,
      render: (_, candidate) => (
        <Space direction="vertical" size={2}>
          <Tag color={sourceLevelColor(candidate.sourceLevel)}>
            {sourceLevelLabel(candidate.sourceLevel)}
          </Tag>
          <Typography.Link href={candidate.sourceUrl} target="_blank" rel="noreferrer" ellipsis>
            <LinkOutlined /> {candidate.sourceUrl}
          </Typography.Link>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: candidateStatusTag,
    },
    {
      title: '操作',
      width: 320,
      render: (_, candidate) => (
        <Space wrap>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => openCandidateEditor(candidate)}
          >
            补充
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<DatabaseOutlined />}
            loading={reviewingId === candidate.id}
            onClick={() => reviewCandidate(candidate.id, 'approve_official')}
          >
            入库
          </Button>
          <Button
            size="small"
            danger
            icon={<CloseCircleOutlined />}
            loading={reviewingId === candidate.id}
            onClick={() => reviewCandidate(candidate.id, 'reject')}
          >
            拒绝
          </Button>
          <Button
            size="small"
            icon={<EyeInvisibleOutlined />}
            loading={reviewingId === candidate.id}
            onClick={() => reviewCandidate(candidate.id, 'ignore')}
          >
            忽略
          </Button>
        </Space>
      ),
    },
  ];

  const officialFactColumns: ColumnsType<OfficialWebFact> = [
    {
      title: '入库事实',
      dataIndex: 'factValue',
      width: 420,
      render: (_, fact) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{fact.spotName}</Typography.Text>
          <Typography.Text>{fact.factValue}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '字段',
      dataIndex: 'factKey',
      width: 160,
      render: (_, fact) => (
        <Space direction="vertical" size={2}>
          <Tag color="green">{fact.factLabel || factKeyLabel(fact.factKey)}</Tag>
        </Space>
      ),
    },
    {
      title: '来源',
      dataIndex: 'sourceUrl',
      width: 260,
      render: (sourceUrl: string) => (
        <Typography.Link href={sourceUrl} target="_blank" rel="noreferrer" ellipsis>
          <LinkOutlined /> {sourceUrl}
        </Typography.Link>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 190,
      render: (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false }),
    },
    {
      title: '操作',
      width: 170,
      fixed: 'right',
      render: (_, fact) => (
        <Space wrap>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => openOfficialFactEditor(fact)}
          >
            编辑
          </Button>
          <Popconfirm
            title="删除这条入库事实？"
            description="删除后会从正式检索中移除。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => removeOfficialFact(fact.id)}
          >
            <Button
              danger
              size="small"
              icon={<DeleteOutlined />}
              loading={deletingOfficialFactId === fact.id}
            >
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
      {view === 'docs' ? (
        <>
          <input
            ref={docUploadInputRef}
            type="file"
            accept=".md,.markdown,.txt,.docx"
            style={{ display: 'none' }}
            onChange={uploadDoc}
          />
          <Space size={16} wrap>
            <Card>
              <Statistic title="知识文档" value={docs.length} suffix="份" />
            </Card>
          </Space>

          {stats.pendingDocs > 0 ? (
            <Alert
              type="warning"
              showIcon
              message="存在待重建文档"
              description={`当前有 ${stats.pendingDocs} 份文档尚未标记为已索引。点击“重建索引”后，后端会刷新索引状态。`}
            />
          ) : null}

          <Card
            className="admin-table-card"
            title="后端知识文档"
            extra={
              <Space wrap>
                <Button icon={<ReloadOutlined />} loading={docsLoading} onClick={loadDocs}>
                  刷新文档
                </Button>
                <Button icon={<CloudSyncOutlined />} loading={rebuilding} onClick={rebuild}>
                  重建索引
                </Button>
                <Button
                  icon={<PlusOutlined />}
                  loading={uploadingDoc}
                  onClick={openDocUploadPicker}
                >
                  增加
                </Button>
              </Space>
            }
          >
            <Table
              rowKey="id"
              columns={docColumns}
              dataSource={docs}
              loading={docsLoading}
              pagination={{ pageSize: 8 }}
              scroll={{ x: 1120 }}
            />
          </Card>
        </>
      ) : null}

      {view === 'facts' ? (
        <>
          <Space size={16} wrap>
            <Card>
              <Statistic title="已入库联网事实" value={officialFacts.length} suffix="条" />
            </Card>
          </Space>

          <Card
            className="admin-table-card"
            title="已入库联网事实"
            extra={
              <Button loading={officialFactsLoading} onClick={loadOfficialFacts}>
                刷新
              </Button>
            }
          >
            <Table
              className="official-web-fact-table"
              rowKey="id"
              columns={officialFactColumns}
              dataSource={officialFacts}
              loading={officialFactsLoading}
              pagination={{ pageSize: 5 }}
              scroll={{ x: 1120 }}
            />
          </Card>

          <Modal
            className="admin-spot-modal"
            title="编辑入库事实"
            open={Boolean(editingOfficialFact)}
            okText="保存"
            cancelText="取消"
            confirmLoading={savingOfficialFact}
            onOk={saveOfficialFact}
            onCancel={() => setEditingOfficialFact(undefined)}
            destroyOnClose
          >
            <Form form={officialFactForm} layout="vertical" preserve={false}>
              <Form.Item name="factKey" label="字段" rules={[{ required: true, message: '请选择字段' }]}>
                <Select options={FACT_KEY_OPTIONS} />
              </Form.Item>
              <Form.Item name="factValue" label="事实内容" rules={[{ required: true, message: '请输入事实内容' }]}>
                <Input.TextArea rows={4} />
              </Form.Item>
              <Form.Item name="sourceUrl" label="来源链接">
                <Input />
              </Form.Item>
            </Form>
          </Modal>
        </>
      ) : null}

      {view === 'candidates' ? (
        <>
          <Space size={16} wrap>
            <Card>
              <Statistic title="当前候选事实" value={candidates.length} suffix="条" />
            </Card>
          </Space>

          <Card
            className="admin-table-card"
            title="联网事实候选"
            extra={
              <Space wrap>
                <Select<CandidateFilter>
                  value={candidateStatus}
                  style={{ width: 150 }}
                  onChange={setCandidateStatus}
                  options={[
                    { value: 'pending_review', label: '待审核' },
                    { value: 'approved_official', label: '已入库' },
                    { value: 'rejected', label: '已拒绝' },
                    { value: 'ignored', label: '已忽略' },
                    { value: '', label: '全部状态' },
                  ]}
                />
                <Button loading={candidatesLoading} onClick={() => loadCandidates()}>
                  刷新
                </Button>
              </Space>
            }
          >
            <Table
              className="web-fact-candidate-table"
              rowKey="id"
              columns={candidateColumns}
              dataSource={candidates}
              loading={candidatesLoading}
              pagination={{ pageSize: 5 }}
              scroll={{ x: 1120 }}
            />
          </Card>

          <Modal
            className="admin-spot-modal"
            title="补充候选事实"
            open={Boolean(editingCandidate)}
            okText="保存候选"
            cancelText="取消"
            confirmLoading={savingCandidate}
            onOk={saveCandidateDraft}
            onCancel={() => setEditingCandidate(undefined)}
            destroyOnClose
          >
            <Form form={candidateForm} layout="vertical" preserve={false}>
              <Form.Item name="factKey" label="字段" rules={[{ required: true, message: '请选择字段' }]}>
                <Select options={FACT_KEY_OPTIONS} />
              </Form.Item>
              <Form.Item name="factValue" label="事实内容" rules={[{ required: true, message: '请输入事实内容' }]}>
                <Input.TextArea rows={4} />
              </Form.Item>
              <Form.Item name="sourceUrl" label="来源链接" rules={[{ required: true, message: '请输入来源链接' }]}>
                <Input />
              </Form.Item>
              <Form.Item name="sourceLevel" label="来源级别" rules={[{ required: true, message: '请选择来源级别' }]}>
                <Select options={SOURCE_LEVEL_OPTIONS} />
              </Form.Item>
            </Form>
          </Modal>

          <Modal
            className="admin-spot-modal candidate-detail-modal"
            title="候选事实详情"
            open={Boolean(detailCandidate)}
            width={760}
            footer={<Button onClick={() => setDetailCandidate(undefined)}>关闭</Button>}
            onCancel={() => setDetailCandidate(undefined)}
            destroyOnClose
          >
            {detailCandidate ? (
              <Descriptions
                className="candidate-detail-descriptions"
                bordered
                column={1}
                size="small"
              >
                <Descriptions.Item label="事实内容">
                  <Typography.Paragraph className="candidate-detail-text">
                    {detailCandidate.factValue}
                  </Typography.Paragraph>
                </Descriptions.Item>
                <Descriptions.Item label="原始问题">
                  <Typography.Paragraph className="candidate-detail-text">
                    {detailCandidate.question || '无'}
                  </Typography.Paragraph>
                </Descriptions.Item>
                <Descriptions.Item label="回答片段">
                  <Typography.Paragraph className="candidate-detail-text">
                    {detailCandidate.answerExcerpt || '无'}
                  </Typography.Paragraph>
                </Descriptions.Item>
                <Descriptions.Item label="字段">{factKeyLabel(detailCandidate.factKey)}</Descriptions.Item>
                <Descriptions.Item label="来源级别">
                  <Tag color={sourceLevelColor(detailCandidate.sourceLevel)}>
                    {sourceLevelLabel(detailCandidate.sourceLevel)}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="状态">
                  {candidateStatusTag(detailCandidate.status)}
                </Descriptions.Item>
                <Descriptions.Item label="来源链接">
                  <Typography.Link
                    className="candidate-detail-url"
                    href={detailCandidate.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {detailCandidate.sourceUrl || '无'}
                  </Typography.Link>
                </Descriptions.Item>
              </Descriptions>
            ) : null}
          </Modal>
        </>
      ) : null}
    </div>
  );
}
