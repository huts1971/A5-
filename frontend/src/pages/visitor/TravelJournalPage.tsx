import {
  BookOutlined,
  CheckCircleOutlined,
  CloudDownloadOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  HighlightOutlined,
  LoadingOutlined,
  PlusOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  List,
  message,
  Modal,
  Pagination,
  Popconfirm,
  Radio,
  Segmented,
  Skeleton,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  copyTravelJournal,
  createTravelJournal,
  deleteTravelJournal,
  deleteTravelJournalImage,
  downloadTravelJournalPdf,
  generateTravelJournal,
  listTravelJournals,
  loadTravelJournalImage,
  publishTravelJournal,
  reorderTravelJournalImages,
  updateTravelJournal,
  uploadTravelJournalImages,
} from '../../api/travelJournals';
import type {
  TravelJournal,
  TravelJournalImage,
  TravelJournalTextSection,
} from '../../types/travelJournal';
import { toApiError } from '../../api/client';
import {
  consumeTourRecapJournalHandoff,
  type TourRecapJournalHandoff,
} from '../../utils/tourRecapHandoff';
import { useVisitorAuth } from '../../utils/visitorAuthContext';
import styles from './TravelJournalPage.module.css';

const WORD_PRESETS = [300, 600, 1000, 1500] as const;
const PAGE_SIZE = 9;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function TravelJournalPage() {
  const navigate = useNavigate();
  const { user } = useVisitorAuth();
  const [activeTab, setActiveTab] = useState<'create' | 'mine'>('create');
  const [journal, setJournal] = useState<TravelJournal>(() => emptyJournal());
  const [wordMode, setWordMode] = useState<string>('600');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveRetryKey, setSaveRetryKey] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [journals, setJournals] = useState<TravelJournal[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [listError, setListError] = useState('');
  const [draggedImageId, setDraggedImageId] = useState('');
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createPromiseRef = useRef<Promise<TravelJournal> | null>(null);
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const lastSavedSignature = useRef('');
  const generatingRef = useRef(false);
  const publishingRef = useRef(false);
  const pendingActionKeysRef = useRef<Set<string>>(new Set());

  const editable = journal.status === 'draft';
  const articleExists = hasArticle(journal);
  const signature = useMemo(() => journalSignature(journal), [journal]);

  const loadMyJournals = useCallback(async (nextPage = page) => {
    setListLoading(true);
    setListError('');
    try {
      const response = await listTravelJournals(nextPage, PAGE_SIZE);
      setJournals(response.items);
      setTotal(response.total);
    } catch (error) {
      setListError(toApiError(error, '手账列表加载失败，请稍后重试。').message);
    } finally {
      setListLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (activeTab === 'mine') {
      void loadMyJournals();
    }
  }, [activeTab, loadMyJournals]);

  useEffect(() => {
    const handoff = consumeTourRecapJournalHandoff();
    if (!handoff) return;
    setJournal((current) => {
      const hasUserContent = Boolean(
        current.id
        || current.description.trim()
        || current.images.length
        || hasArticle(current)
      );
      if (hasUserContent) return current;
      return {
        ...current,
        description: journalDescriptionFromRecap(handoff),
      };
    });
  }, []);

  const ensureJournal = useCallback(async () => {
    if (journal.id) return journal;
    if (!createPromiseRef.current) {
      const snapshot = journal;
      createPromiseRef.current = createTravelJournal({
        description: snapshot.description,
        targetWords: snapshot.targetWords,
      }).then((created) => {
        const merged = {
          ...created,
          title: snapshot.title,
          opening: snapshot.opening,
          textSections: snapshot.textSections,
          conclusion: snapshot.conclusion,
        };
        lastSavedSignature.current = journalSignature(created);
        setJournal((current) => ({ ...merged, description: current.description }));
        return merged;
      }).finally(() => {
        createPromiseRef.current = null;
      });
    }
    return createPromiseRef.current;
  }, [journal]);

  const queueSave = useCallback((snapshot: TravelJournal) => {
    const run = async () => {
      const persisted = snapshot.id ? snapshot : await ensureJournal();
      return updateTravelJournal(persisted.id, {
        description: snapshot.description,
        targetWords: snapshot.targetWords,
        title: snapshot.title,
        opening: snapshot.opening,
        textSections: snapshot.textSections,
        images: snapshot.images.map(({ id, title, body }) => ({ id, title, body })),
        conclusion: snapshot.conclusion,
      });
    };
    const queued = saveQueueRef.current.catch(() => undefined).then(run);
    saveQueueRef.current = queued.catch(() => undefined);
    return queued;
  }, [ensureJournal]);

  const persistCurrent = useCallback(async (snapshot = journal) => {
    const saved = await queueSave(snapshot);
    lastSavedSignature.current = journalSignature(saved);
    setJournal(saved);
    setSaveState('saved');
    return saved;
  }, [journal, queueSave]);

  useEffect(() => {
    if (!editable || signature === lastSavedSignature.current) return undefined;
    const hasLocalContent = Boolean(
      journal.id
      || journal.description.trim()
      || hasArticle(journal)
      || journal.images.length,
    );
    if (!hasLocalContent) return undefined;

    const timer = window.setTimeout(async () => {
      const snapshot = journal;
      setSaveState('saving');
      try {
        const saved = await queueSave(snapshot);
        lastSavedSignature.current = journalSignature(saved);
        setJournal((current) => (
          current.id === saved.id && journalSignature(current) === signature ? saved : current
        ));
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [editable, journal, queueSave, saveRetryKey, signature]);

  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    if (journal.images.length >= 9) {
      message.warning('每篇手账最多上传 9 张图片。');
      return;
    }
    setUploading(true);
    try {
      const persisted = await ensureJournal();
      const result = await uploadTravelJournalImages(
        persisted.id,
        files.slice(0, 9 - journal.images.length),
      );
      setJournal(result.journal);
      lastSavedSignature.current = journalSignature(result.journal);
      if (files.length > 9 - journal.images.length) {
        message.warning('超出 9 张上限的图片未上传。');
      }
      result.errors.forEach((error) => message.warning(`${error.filename}：${error.message}`));
      if (result.journal.images.length > journal.images.length) {
        message.success('旅行照片已加入手账。');
      }
    } catch (error) {
      message.error(toApiError(error, '图片上传失败，请重试。').message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    if (!journal.id) return;
    try {
      const updated = await deleteTravelJournalImage(journal.id, imageId);
      setJournal(updated);
      lastSavedSignature.current = journalSignature(updated);
      message.success('图片及对应讲述已删除。');
    } catch (error) {
      message.error(toApiError(error, '图片删除失败。').message);
    }
  };

  const handleDropOrder = async (targetId: string) => {
    if (!journal.id || !draggedImageId || draggedImageId === targetId) return;
    const images = [...journal.images];
    const from = images.findIndex((item) => item.id === draggedImageId);
    const to = images.findIndex((item) => item.id === targetId);
    const [moved] = images.splice(from, 1);
    images.splice(to, 0, moved);
    const ordered = images.map((item, index) => ({ ...item, sortOrder: index }));
    setJournal((current) => ({ ...current, images: ordered }));
    setDraggedImageId('');
    try {
      const updated = await reorderTravelJournalImages(
        journal.id,
        ordered.map((item) => item.id),
      );
      setJournal(updated);
      lastSavedSignature.current = journalSignature(updated);
    } catch (error) {
      message.error(toApiError(error, '图片排序失败。').message);
      const reloaded = await listTravelJournals(1, PAGE_SIZE);
      const current = reloaded.items.find((item) => item.id === journal.id);
      if (current) setJournal(current);
    }
  };

  const doGenerate = async () => {
    if (generatingRef.current) return;
    if (!journal.description.trim() && !journal.images.length) {
      message.warning('请至少填写旅途描述或上传一张图片。');
      return;
    }
    if (!Number.isInteger(journal.targetWords)
      || journal.targetWords < 200
      || journal.targetWords > 3000) {
      message.warning('自定义字数请输入 200–3000 的整数。');
      return;
    }
    generatingRef.current = true;
    setGenerating(true);
    try {
      const persisted = await ensureJournal();
      const generated = await generateTravelJournal(persisted.id, {
        description: journal.description,
        targetWords: journal.targetWords,
      });
      setJournal(generated);
      lastSavedSignature.current = journalSignature(generated);
      setSaveState('saved');
      message.success('旅行手账已生成，你仍可继续编辑。');
    } catch (error) {
      message.error(toApiError(error, '生成失败，素材和草稿已保留。').message);
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  const handleGenerate = () => {
    if (!articleExists) {
      void doGenerate();
      return;
    }
    Modal.confirm({
      title: '将覆盖当前内容，是否继续？',
      content: '灵诗音将根据当前素材重新创作手账，现有文章文字不会保留。',
      okText: '继续创作',
      cancelText: '取消',
      onOk: doGenerate,
    });
  };

  const handlePublish = () => {
    if (!journal.id) return;
    Modal.confirm({
      title: '确认发布到评论社区？',
      content: '手账标题、正文和全部图片将立即公开；发布后当前版本不可直接覆盖编辑。',
      okText: '确认发布',
      cancelText: '继续编辑',
      onOk: async () => {
        if (publishingRef.current) return;
        publishingRef.current = true;
        setPublishing(true);
        try {
          const saved = await persistCurrent();
          const result = await publishTravelJournal(saved.id);
          setJournal(result.journal);
          message.success('旅行手账已发布。');
          navigate(`/community?highlight=${result.postId}`);
        } catch (error) {
          message.error(toApiError(error, '发布失败，草稿已保留。').message);
        } finally {
          publishingRef.current = false;
          setPublishing(false);
        }
      },
    });
  };

  const handleExport = async (item = journal) => {
    if (!item.id) {
      message.warning('请先保存手账后再导出。');
      return;
    }
    const actionKey = `export:${item.id}`;
    if (pendingActionKeysRef.current.has(actionKey)) return;
    pendingActionKeysRef.current.add(actionKey);
    setPendingActions((current) => new Set(current).add(actionKey));
    try {
      const exportItem = item.id === journal.id && item.status === 'draft'
        ? await persistCurrent(item)
        : item;
      await downloadTravelJournalPdf(exportItem.id, exportItem.title || '旅行手账');
    } catch (error) {
      message.error(toApiError(error, 'PDF 导出失败，请重试。').message);
    } finally {
      pendingActionKeysRef.current.delete(actionKey);
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(actionKey);
        return next;
      });
    }
  };

  const openJournal = (item: TravelJournal) => {
    setJournal(item);
    setWordMode(WORD_PRESETS.includes(item.targetWords as never) ? String(item.targetWords) : 'custom');
    lastSavedSignature.current = journalSignature(item);
    setSaveState('saved');
    setActiveTab('create');
  };

  const handleCopy = async (item: TravelJournal) => {
    const actionKey = `copy:${item.id}`;
    if (pendingActionKeysRef.current.has(actionKey)) return;
    pendingActionKeysRef.current.add(actionKey);
    setPendingActions((current) => new Set(current).add(actionKey));
    try {
      const copied = await copyTravelJournal(item.id, crypto.randomUUID());
      openJournal(copied);
      message.success('已复制为新的可编辑草稿。');
    } catch (error) {
      message.error(toApiError(error, '复制失败，请重试。').message);
    } finally {
      pendingActionKeysRef.current.delete(actionKey);
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(actionKey);
        return next;
      });
    }
  };

  const handleDelete = async (item: TravelJournal) => {
    const actionKey = `delete:${item.id}`;
    if (pendingActionKeysRef.current.has(actionKey)) return;
    pendingActionKeysRef.current.add(actionKey);
    setPendingActions((current) => new Set(current).add(actionKey));
    try {
      await deleteTravelJournal(item.id);
      if (journal.id === item.id) startNewJournal();
      await loadMyJournals(page);
      message.success(item.status === 'published' ? '手账和对应社区帖子已删除。' : '草稿已删除。');
    } catch (error) {
      message.error(toApiError(error, '删除失败，请重试。').message);
    } finally {
      pendingActionKeysRef.current.delete(actionKey);
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(actionKey);
        return next;
      });
    }
  };

  const startNewJournal = () => {
    const empty = emptyJournal();
    setJournal(empty);
    setWordMode('600');
    setSaveState('idle');
    lastSavedSignature.current = journalSignature(empty);
    setActiveTab('create');
  };

  const updateTextSection = (id: string, patch: Partial<TravelJournalTextSection>) => {
    setJournal((current) => ({
      ...current,
      textSections: current.textSections.map((section) => (
        section.id === id ? { ...section, ...patch } : section
      )),
    }));
  };

  const updateImageSection = (id: string, patch: Partial<TravelJournalImage>) => {
    setJournal((current) => ({
      ...current,
      images: current.images.map((image) => (
        image.id === id ? { ...image, ...patch } : image
      )),
    }));
  };

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <Typography.Text className={styles.eyebrow}>TRAVEL JOURNAL</Typography.Text>
          <Typography.Title level={1}>旅行手账共创</Typography.Title>
          <Typography.Paragraph className={styles.readableText}>
            把旅途照片与此刻心情交给灵诗音，共创一篇属于你的旅行记录。
          </Typography.Paragraph>
        </div>
        <Button
          className={styles.primaryActionButton}
          icon={<PlusOutlined />}
          onClick={startNewJournal}
        >
          新建手账
        </Button>
      </header>

      <Segmented
        block
        className={styles.pageTabs}
        value={activeTab}
        options={[
          { label: '共创手账', value: 'create', icon: <HighlightOutlined /> },
          { label: '我的手账', value: 'mine', icon: <BookOutlined /> },
        ]}
        onChange={(value) => setActiveTab(value as 'create' | 'mine')}
      />

      {activeTab === 'create' ? (
        <div className={styles.creation}>
          <section className={styles.materialPanel}>
            <div className={styles.sectionHeading}>
              <div>
                <span>01</span>
                <div>
                  <Typography.Title level={3}>准备今天的旅行素材</Typography.Title>
                </div>
              </div>
              <SaveIndicator
                state={saveState}
                onRetry={() => setSaveRetryKey((current) => current + 1)}
              />
            </div>

            <div
              className={styles.uploadZone}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (editable) void handleFiles(event.dataTransfer.files);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                multiple
                hidden
                onChange={(event) => event.target.files && void handleFiles(event.target.files)}
              />
              <CloudUploadOutlined />
              <div>
                <Typography.Text strong className={styles.readableText}>拖入旅行照片，或点击选择</Typography.Text>
              </div>
              <Button
                className={styles.accentActionButton}
                disabled={!editable}
                loading={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                选择图片
              </Button>
            </div>

            {journal.images.length ? (
              <div className={styles.imageStrip}>
                {journal.images.map((image, index) => (
                  <div
                    key={image.id}
                    className={styles.imageThumb}
                    draggable={editable}
                    onDragStart={() => setDraggedImageId(image.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => void handleDropOrder(image.id)}
                  >
                    <AuthenticatedJournalImage image={image} alt={`旅行素材 ${index + 1}`} />
                    <span className={styles.imageOrder}>{index + 1}</span>
                    {editable ? (
                      <Popconfirm
                        title="删除这张图片和对应讲述？"
                        okText="删除"
                        cancelText="取消"
                        onConfirm={() => handleDeleteImage(image.id)}
                      >
                        <Button
                          danger
                          type="text"
                          size="small"
                          icon={<DeleteOutlined />}
                          aria-label={`删除第 ${index + 1} 张图片`}
                        />
                      </Popconfirm>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <Input.TextArea
              value={journal.description}
              disabled={!editable}
              maxLength={2000}
              showCount
              autoSize={{ minRows: 4, maxRows: 8 }}
              placeholder="写下今天的心情、印象深刻的片段或想保留的旅途感受……"
              onChange={(event) => setJournal((current) => ({
                ...current,
                description: event.target.value,
              }))}
            />

            <div className={styles.wordControl}>
              <div>
                <Typography.Text strong className={styles.readableText}>目标字数</Typography.Text>
              </div>
              <Radio.Group
                value={wordMode}
                disabled={!editable}
                onChange={(event) => {
                  const value = String(event.target.value);
                  setWordMode(value);
                  if (value !== 'custom') {
                    setJournal((current) => ({ ...current, targetWords: Number(value) }));
                  }
                }}
              >
                {WORD_PRESETS.map((words) => (
                  <Radio.Button key={words} value={String(words)}>{words} 字</Radio.Button>
                ))}
                <Radio.Button value="custom">自定义</Radio.Button>
              </Radio.Group>
              {wordMode === 'custom' ? (
                <InputNumber
                  min={200}
                  max={3000}
                  precision={0}
                  value={journal.targetWords}
                  disabled={!editable}
                  addonAfter="字"
                  onChange={(value) => setJournal((current) => ({
                    ...current,
                    targetWords: Number(value ?? 600),
                  }))}
                />
              ) : null}
            </div>

            <div className={styles.generateBar}>
              <Button
                type="primary"
                size="large"
                icon={<HighlightOutlined />}
                loading={generating}
                disabled={!editable || (!journal.description.trim() && !journal.images.length)}
                onClick={handleGenerate}
              >
                AI共创
              </Button>
            </div>
          </section>

          <div className={styles.workspace}>
            <section className={styles.editorPanel}>
              <div className={styles.panelTitle}>
                <EditOutlined />
                <div>
                  <Typography.Title level={3}>分段编辑</Typography.Title>
                  <Typography.Text className={styles.readableText}>{editable ? '所有修改会自动保存' : '已发布版本只读，可复制后继续创作'}</Typography.Text>
                </div>
              </div>
              {articleExists ? (
                <div className={styles.editorFields}>
                  <EditorField label="手账标题">
                    <Input
                      value={journal.title}
                      disabled={!editable}
                      maxLength={200}
                      onChange={(event) => setJournal((current) => ({
                        ...current,
                        title: event.target.value,
                      }))}
                    />
                  </EditorField>
                  <EditorField label="开场">
                    <Input.TextArea
                      value={journal.opening}
                      disabled={!editable}
                      autoSize={{ minRows: 3, maxRows: 8 }}
                      onChange={(event) => setJournal((current) => ({
                        ...current,
                        opening: event.target.value,
                      }))}
                    />
                  </EditorField>
                  {journal.textSections.map((section, index) => (
                    <div className={styles.sectionEditor} key={section.id}>
                      <Typography.Text className={styles.sectionIndex}>文字段落 {index + 1}</Typography.Text>
                      <Input
                        value={section.title}
                        disabled={!editable}
                        maxLength={200}
                        placeholder="段落小标题"
                        onChange={(event) => updateTextSection(section.id, { title: event.target.value })}
                      />
                      <Input.TextArea
                        value={section.body}
                        disabled={!editable}
                        autoSize={{ minRows: 4, maxRows: 12 }}
                        placeholder="段落正文"
                        onChange={(event) => updateTextSection(section.id, { body: event.target.value })}
                      />
                    </div>
                  ))}
                  {journal.images.map((image, index) => (
                    <div className={styles.sectionEditor} key={image.id}>
                      <div className={styles.imageEditorHeading}>
                        <AuthenticatedJournalImage image={image} alt={`第 ${index + 1} 个图文段落`} />
                        <div>
                          <Typography.Text className={styles.sectionIndex}>图文段落 {index + 1}</Typography.Text>
                        </div>
                      </div>
                      <Input
                        value={image.title}
                        disabled={!editable}
                        maxLength={200}
                        placeholder="图片小标题"
                        onChange={(event) => updateImageSection(image.id, { title: event.target.value })}
                      />
                      <Input.TextArea
                        value={image.body}
                        disabled={!editable}
                        autoSize={{ minRows: 4, maxRows: 12 }}
                        placeholder="写下这张照片背后的旅途故事"
                        onChange={(event) => updateImageSection(image.id, { body: event.target.value })}
                      />
                    </div>
                  ))}
                  <EditorField label="结尾">
                    <Input.TextArea
                      value={journal.conclusion}
                      disabled={!editable}
                      autoSize={{ minRows: 3, maxRows: 8 }}
                      onChange={(event) => setJournal((current) => ({
                        ...current,
                        conclusion: event.target.value,
                      }))}
                    />
                  </EditorField>
                </div>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="生成后可在这里逐段编辑"
                />
              )}
            </section>

            <section className={styles.previewPanel}>
              <div className={styles.panelTitle}>
                <FileTextOutlined />
                <div>
                  <Typography.Title level={3}>公众号式预览</Typography.Title>
                  <Typography.Text className={styles.readableText}>最终发布与 PDF 将沿用这份图文顺序</Typography.Text>
                </div>
              </div>
              <JournalPreview journal={journal} authorName={user?.username ?? '游客'} />
            </section>
          </div>

          <div className={styles.finalActions}>
            {journal.status === 'published' ? (
              <Button
                className={styles.primaryActionButton}
                icon={<CopyOutlined />}
                loading={pendingActions.has(`copy:${journal.id}`)}
                onClick={() => void handleCopy(journal)}
              >
                复制为新草稿
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={publishing}
                disabled={!journal.id || !articleExists}
                onClick={handlePublish}
              >
                发布到评论社区
              </Button>
            )}
            <Button
              className={styles.accentActionButton}
              icon={<CloudDownloadOutlined />}
              loading={pendingActions.has(`export:${journal.id}`)}
              disabled={!journal.id || !articleExists}
              onClick={() => void handleExport()}
            >
              导出 PDF
            </Button>
          </div>
        </div>
      ) : (
        <section className={styles.library}>
          <div className={styles.libraryHeader}>
            <div>
              <Typography.Title level={2}>我的手账</Typography.Title>
              <Typography.Text className={styles.readableText}>草稿可继续编辑，已发布手账可复制后再创作。</Typography.Text>
            </div>
          </div>
          {listError ? (
            <Alert
              type="warning"
              showIcon
              message="手账加载失败"
              description={listError}
              action={<Button onClick={() => void loadMyJournals(page)}>重试</Button>}
            />
          ) : null}
          {listLoading ? (
            <div className={styles.libraryGrid}>
              {[0, 1, 2].map((item) => <Card key={item}><Skeleton active /></Card>)}
            </div>
          ) : journals.length ? (
            <>
              <List
                grid={{ gutter: 18, column: 3 }}
                dataSource={journals}
                renderItem={(item) => (
                  <List.Item>
                    <Card className={styles.journalCard}>
                      <div className={styles.cardCover}>
                        {item.images[0] ? (
                          <AuthenticatedJournalImage image={item.images[0]} alt={item.title || '旅行手账封面'} />
                        ) : (
                          <BookOutlined />
                        )}
                        <Tag color={item.status === 'published' ? 'green' : 'gold'}>
                          {item.status === 'published' ? '已发布' : '草稿'}
                        </Tag>
                      </div>
                      <Typography.Title level={4} ellipsis={{ rows: 2 }}>
                        {item.title || '未命名旅行手账'}
                      </Typography.Title>
                      <Typography.Paragraph ellipsis={{ rows: 2 }}>
                        {item.opening || item.description || '还没有填写内容'}
                      </Typography.Paragraph>
                      <Typography.Text type="secondary">
                        更新于 {formatDate(item.updatedAt)}
                      </Typography.Text>
                      <div className={styles.cardActions}>
                        <Button
                          className={styles.primaryActionButton}
                          icon={item.status === 'draft' ? <EditOutlined /> : <BookOutlined />}
                          onClick={() => openJournal(item)}
                        >
                          {item.status === 'draft' ? '继续编辑' : '查看'}
                        </Button>
                        <Button
                          icon={<CopyOutlined />}
                          loading={pendingActions.has(`copy:${item.id}`)}
                          onClick={() => void handleCopy(item)}
                        >
                          复制
                        </Button>
                        <Button
                          className={styles.accentActionButton}
                          icon={<CloudDownloadOutlined />}
                          loading={pendingActions.has(`export:${item.id}`)}
                          onClick={() => void handleExport(item)}
                        >
                          PDF
                        </Button>
                        <Popconfirm
                          title={item.status === 'published' ? '删除手账和社区帖子？' : '删除这个草稿？'}
                          description={item.status === 'published' ? '删除后，评论社区中的对应帖子也会移除。' : '仅由此草稿使用的图片也会清理。'}
                          okText="删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => handleDelete(item)}
                        >
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            loading={pendingActions.has(`delete:${item.id}`)}
                            aria-label="删除手账"
                          />
                        </Popconfirm>
                      </div>
                    </Card>
                  </List.Item>
                )}
              />
              {total > PAGE_SIZE ? (
                <Pagination
                  current={page}
                  pageSize={PAGE_SIZE}
                  total={total}
                  showSizeChanger={false}
                  onChange={(nextPage) => setPage(nextPage)}
                />
              ) : null}
            </>
          ) : (
            <Empty description="还没有旅行手账">
              <Button type="primary" onClick={startNewJournal}>创作第一篇手账</Button>
            </Empty>
          )}
        </section>
      )}

      {generating ? (
        <div className={styles.generatingNotice}>
          <Spin indicator={<LoadingOutlined spin />} />
          <span>灵诗音正在梳理你的旅行素材，请稍候…</span>
        </div>
      ) : null}
    </div>
  );
}

function EditorField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.editorField}>
      <Typography.Text strong className={styles.readableText}>{label}</Typography.Text>
      {children}
    </label>
  );
}

function SaveIndicator({
  state,
  onRetry,
}: {
  state: SaveState;
  onRetry: () => void;
}) {
  if (state === 'idle') return null;

  const copy = {
    saving: '保存中…',
    saved: '已自动保存',
    error: '自动保存失败，将继续重试',
  }[state];
  return (
    <span className={`${styles.saveState} ${styles[`save_${state}`]}`}>
      {state === 'saving' ? <LoadingOutlined spin /> : <CheckCircleOutlined />}
      {copy}
      {state === 'error' ? (
        <button type="button" onClick={onRetry}>重试</button>
      ) : null}
    </span>
  );
}

export function AuthenticatedJournalImage({
  image,
  alt,
}: {
  image: Pick<TravelJournalImage, 'displayUrl'>;
  alt: string;
}) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    loadTravelJournalImage(image.displayUrl)
      .then((url) => {
        objectUrl = url;
        if (active) setSrc(url);
      })
      .catch(() => {
        if (active) setSrc('');
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.displayUrl]);
  return src ? <img src={src} alt={alt} /> : <Skeleton.Image active />;
}

export function JournalPreview({
  journal,
  authorName,
}: {
  journal: TravelJournal;
  authorName: string;
}) {
  if (!hasArticle(journal)) {
    return (
      <div className={styles.emptyPreview}>
        <BookOutlined />
        <Typography.Text>你的旅行故事将在这里展开</Typography.Text>
      </div>
    );
  }
  return (
    <article className={styles.article}>
      <Typography.Title level={1}>{journal.title || '未命名旅行手账'}</Typography.Title>
      <div className={styles.articleMeta}>
        <span>{authorName}</span>
        <time>{formatDate(journal.createdAt)}</time>
      </div>
      {journal.opening ? <p className={styles.lead}>{journal.opening}</p> : null}
      {journal.textSections.map((section) => (
        <section key={section.id}>
          {section.title ? <h2>{section.title}</h2> : null}
          <p>{section.body}</p>
        </section>
      ))}
      {journal.images.map((image, index) => (
        <section key={image.id}>
          {image.title ? <h2>{image.title}</h2> : null}
          <figure>
            <AuthenticatedJournalImage image={image} alt={`旅行手账配图 ${index + 1}`} />
          </figure>
          <p>{image.body || '这张照片的旅途故事，等待你来补充。'}</p>
        </section>
      ))}
      {journal.conclusion ? (
        <section className={styles.conclusion}>
          <h2>写在最后</h2>
          <p>{journal.conclusion}</p>
        </section>
      ) : null}
    </article>
  );
}

function emptyJournal(): TravelJournal {
  const now = new Date().toISOString();
  return {
    id: '',
    status: 'draft',
    description: '',
    targetWords: 600,
    title: '',
    opening: '',
    textSections: [],
    conclusion: '',
    images: [],
    createdAt: now,
    updatedAt: now,
  };
}

function hasArticle(journal: TravelJournal) {
  return Boolean(
    journal.title.trim()
    || journal.opening.trim()
    || journal.conclusion.trim()
    || journal.textSections.some((section) => section.title.trim() || section.body.trim())
    || journal.images.some((image) => image.title.trim() || image.body.trim()),
  );
}

function journalSignature(journal: TravelJournal) {
  return JSON.stringify({
    id: journal.id,
    description: journal.description,
    targetWords: journal.targetWords,
    title: journal.title,
    opening: journal.opening,
    textSections: journal.textSections,
    conclusion: journal.conclusion,
    images: journal.images.map(({ id, sortOrder, title, body }) => ({
      id,
      sortOrder,
      title,
      body,
    })),
  });
}

function journalDescriptionFromRecap(
  handoff: TourRecapJournalHandoff,
): string {
  const parts = [
    `我刚刚完成了「${handoff.routeName}」的场景导览。`,
  ];
  if (handoff.completedSpotNames.length) {
    parts.push(`本次到访：${handoff.completedSpotNames.join('、')}。`);
  }
  if (handoff.interestTags.length) {
    parts.push(`旅行印象：${handoff.interestTags.join('、')}。`);
  }
  if (handoff.recapSummary.trim()) {
    parts.push(handoff.recapSummary.trim());
  }
  return parts.join('\n');
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}
