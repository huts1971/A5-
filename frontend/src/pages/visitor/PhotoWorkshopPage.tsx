import {
  ArrowUpOutlined,
  CloseOutlined,
  DownloadOutlined,
  EditOutlined,
  ExpandOutlined,
  PictureOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Alert, Modal, Popover, Spin, Tooltip } from 'antd';
import type { ChangeEvent, DragEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  downloadPhotoWorkshopImage,
  generatePhotoWorkshopImage,
  polishPhotoWorkshopPrompt,
} from '../../api/photoWorkshop';
import { CyberCornerButton } from '../../components/common/CyberButtons';
import Lightfall from '../../components/photoWorkshop/Lightfall';
import { PHOTO_WORKSHOP_TEMPLATES } from '../../components/photoWorkshop/templates';
import type {
  PhotoWorkshopAspectRatio,
  PhotoWorkshopHistoryEntry,
  PhotoWorkshopImageResult,
  PhotoWorkshopResolution,
  PhotoWorkshopSnapshot,
} from '../../types/photoWorkshop';
import { consumeTourRecapPhotoHandoff } from '../../utils/tourRecapHandoff';
import styles from './PhotoWorkshopPage.module.css';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const ASPECT_RATIOS: Array<{ value: PhotoWorkshopAspectRatio; label: string }> = [
  { value: 'smart', label: '智能' },
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
  { value: '4:3', label: '4:3' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '2:3', label: '2:3' },
  { value: '3:2', label: '3:2' },
  { value: '21:9', label: '21:9' },
];

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '').trim();
    if (message) return message;
  }
  return fallback;
}

function createEntryId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function detectImageType(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return '';
}

async function validateImageFile(file: File): Promise<{ error: string; file: File | null }> {
  const extensionIndex = file.name.lastIndexOf('.');
  const extension = extensionIndex >= 0 ? file.name.slice(extensionIndex).toLowerCase() : '';
  if (ACCEPTED_IMAGE_TYPES[extension] !== file.type) {
    return { error: '仅支持扩展名和内容一致的 JPEG、PNG 或 WebP 图片。', file: null };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: '图片不能超过 10 MB。', file: null };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const valid = bitmap.width > 0 && bitmap.height > 0;
    bitmap.close();
    if (!valid) return { error: '图片文件无法读取，请重新选择。', file: null };
  } catch {
    return { error: '图片文件无法读取，请重新选择。', file: null };
  }
  const actualType = detectImageType(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!actualType) {
    return { error: '仅支持 JPEG、PNG 或 WebP 图片。', file: null };
  }
  if (actualType === file.type) return { error: '', file };

  const baseName = extensionIndex > 0 ? file.name.slice(0, extensionIndex) : 'image';
  return {
    error: '',
    file: new File([file], `${baseName}${IMAGE_EXTENSIONS[actualType]}`, {
      type: actualType,
      lastModified: file.lastModified,
    }),
  };
}

export default function PhotoWorkshopPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const objectUrlsRef = useRef(new Set<string>());
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<PhotoWorkshopAspectRatio>('smart');
  const [resolution, setResolution] = useState<PhotoWorkshopResolution>('1K');
  const [history, setHistory] = useState<PhotoWorkshopHistoryEntry[]>([]);
  const [pending, setPending] = useState<{ id: string; snapshot: PhotoWorkshopSnapshot } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [error, setError] = useState('');
  const [handoffNotice, setHandoffNotice] = useState('');
  const [preview, setPreview] = useState<PhotoWorkshopImageResult | null>(null);

  const hasHistory = history.length > 0 || pending !== null;
  const promptLength = prompt.length;
  const canGenerate = Boolean(sourceFile && prompt.trim()) && !isGenerating;

  useEffect(() => {
    document.body.classList.add('photo-workshop-active');
    return () => document.body.classList.remove('photo-workshop-active');
  }, []);

  useEffect(() => {
    const handoff = consumeTourRecapPhotoHandoff();
    if (!handoff) return;
    setPrompt((current) => (
      current.trim() ? current : handoff.prompt.trim().slice(0, 2000)
    ));
    setHandoffNotice(
      handoff.spotName
        ? `已带入「${handoff.spotName}」纪念图创意，请选择一张本次旅行照片作为参考图。`
        : '已带入本次旅行的纪念图创意，请选择一张照片作为参考图。',
    );
  }, []);

  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  useEffect(() => {
    if (!hasHistory) return;
    window.requestAnimationFrame(() => {
      const target = historyScrollRef.current;
      if (target) target.scrollTo({ top: target.scrollHeight, behavior: 'smooth' });
    });
  }, [hasHistory, history.length, pending]);

  const activeRatioLabel = useMemo(
    () => ASPECT_RATIOS.find((item) => item.value === aspectRatio)?.label ?? '智能',
    [aspectRatio],
  );

  const applyImage = (file: File) => {
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.add(url);
    setSourceFile(file);
    setSourceUrl(url);
    setError('');
  };

  const selectImage = async (file: File) => {
    const validation = await validateImageFile(file);
    if (validation.error || !validation.file) {
      setError(validation.error);
      return;
    }
    const validatedFile = validation.file;
    if (sourceFile) {
      Modal.confirm({
        title: '替换当前参考图？',
        content: '新图片会替换当前创作区中的参考图，已有创作历史不会改变。',
        okText: '确认替换',
        cancelText: '取消',
        onOk: () => applyImage(validatedFile),
      });
      return;
    }
    applyImage(validatedFile);
  };

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void selectImage(file);
  };

  const handleImageDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingImage(false);
    if (isGenerating) return;
    if (event.dataTransfer.files.length !== 1) {
      setError('每次只能上传一张参考图片。');
      return;
    }
    const file = event.dataTransfer.files[0];
    if (file) void selectImage(file);
  };

  const handleRemoveImage = () => {
    if (isGenerating) return;
    setSourceFile(null);
    setSourceUrl('');
    setError('');
  };

  const handlePolish = async () => {
    const original = prompt;
    if (!original.trim() || isGenerating || isPolishing) return;
    setIsPolishing(true);
    setError('');
    try {
      const polished = await polishPhotoWorkshopPrompt(original);
      setPrompt(polished);
    } catch (requestError) {
      setPrompt(original);
      setError(errorMessage(requestError, 'AI 润色暂时不可用，请稍后重试。'));
    } finally {
      setIsPolishing(false);
    }
  };

  const generateFromSnapshot = async (snapshot: PhotoWorkshopSnapshot) => {
    if (isGenerating) return;
    const pendingId = createEntryId();
    setIsGenerating(true);
    setTemplateOpen(false);
    setError('');
    setPending({ id: pendingId, snapshot });
    try {
      const result = await generatePhotoWorkshopImage({
        image: snapshot.sourceFile,
        prompt: snapshot.prompt,
        aspectRatio: snapshot.aspectRatio,
        resolution: snapshot.resolution,
      });
      setHistory((current) => [
        ...current,
        {
          ...snapshot,
          id: pendingId,
          createdAt: new Date(),
          result,
        },
      ]);
      setPending(null);
    } catch (requestError) {
      setPending(null);
      setError(errorMessage(requestError, '图片生成失败，请稍后主动重试。'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerate = () => {
    if (!sourceFile || !sourceUrl) {
      setError('请先上传一张参考图片。');
      return;
    }
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      setError('请先输入创意想法。');
      return;
    }
    if (cleanPrompt.length > 2000) {
      setError('创意想法不能超过 2000 个字符。');
      return;
    }
    const snapshot: PhotoWorkshopSnapshot = {
      sourceFile,
      sourceUrl,
      prompt: cleanPrompt,
      aspectRatio,
      resolution,
    };
    void generateFromSnapshot(snapshot);
    setSourceFile(null);
    setSourceUrl('');
    setPrompt('');
    setAspectRatio('smart');
    setResolution('1K');
    setSettingsOpen(false);
  };

  const handleReEdit = (entry: PhotoWorkshopHistoryEntry) => {
    setSourceFile(entry.sourceFile);
    setSourceUrl(entry.sourceUrl);
    setPrompt(entry.prompt);
    setAspectRatio(entry.aspectRatio);
    setResolution(entry.resolution);
    setError('');
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };

  const applyTemplate = (templatePrompt: string) => {
    setPrompt(templatePrompt);
    setTemplateOpen(false);
    setError('');
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const settingsPanel = (
    <div className={styles.settingsPanel}>
      <div>
        <strong>图片比例</strong>
        <div className={styles.ratioGrid}>
          {ASPECT_RATIOS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={aspectRatio === item.value ? styles.ratioActive : ''}
              onClick={() => setAspectRatio(item.value)}
            >
              <span className={styles.ratioIcon} data-ratio={item.value} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <strong>清晰度</strong>
        <div className={styles.resolutionGrid}>
          {(['1K', '2K'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={resolution === value ? styles.resolutionActive : ''}
              onClick={() => setResolution(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <p>每次生成 1 张图片</p>
    </div>
  );

  const composer = (
    <section
      ref={composerRef}
      className={`${styles.composer} ${sourceUrl ? styles.composerWithImage : styles.composerWithoutImage}`}
      aria-label="图片创作区"
    >
      <div
        className={`${styles.composerTop} ${isDraggingImage ? styles.composerTopDragging : ''}`}
        aria-label="图片拖拽上传区"
        onDragEnter={(event) => {
          event.preventDefault();
          if (!isGenerating) setIsDraggingImage(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsDraggingImage(false)}
        onDrop={handleImageDrop}
      >
        <div className={styles.uploadArea}>
          <button
            className={styles.uploadBox}
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isGenerating}
            aria-label={sourceFile ? '替换参考图片' : '上传参考图片'}
          >
            <PictureOutlined />
            <span>图片</span>
          </button>
          {sourceUrl ? (
            <div className={styles.uploadPreview}>
              <img src={sourceUrl} alt="当前参考图" />
              <button
                type="button"
                className={styles.removeImageButton}
                onClick={handleRemoveImage}
                disabled={isGenerating}
                aria-label="删除参考图片"
              >
                <CloseOutlined />
              </button>
            </div>
          ) : null}
        </div>
        <div className={styles.promptArea}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value.slice(0, 2000))}
            placeholder="结合图片，输入你的创意想法"
            maxLength={2000}
            disabled={isGenerating}
            aria-label="创意想法"
          />
          <span className={styles.counter}>{promptLength} / 2000</span>
        </div>
        {hasHistory ? (
          <button
            type="button"
            className={`${styles.templateToggle} ${templateOpen ? styles.templateToggleActive : ''}`}
            onClick={() => setTemplateOpen((open) => !open)}
            disabled={isGenerating}
          >
            <ExpandOutlined />
            模板
          </button>
        ) : null}
      </div>

      <div className={styles.composerFooter}>
        <div className={styles.composerTools}>
          <Popover
            content={settingsPanel}
            trigger="click"
            placement="topLeft"
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            overlayClassName={styles.settingsPopover}
          >
            <button
              type="button"
              className={styles.parameterButton}
              disabled={isGenerating}
              aria-label="图片参数"
            >
              <SettingOutlined />
              {activeRatioLabel} · {resolution} · 1 张
            </button>
          </Popover>
          <CyberCornerButton
            variant="ghost"
            icon={isPolishing ? <Spin size="small" /> : <EditOutlined />}
            loading={false}
            disabled={!prompt.trim() || isPolishing || isGenerating}
            onClick={() => void handlePolish()}
          >
            {isPolishing ? '润色中' : 'AI 提示词润色'}
          </CyberCornerButton>
        </div>
        <Tooltip title={!sourceFile ? '请先上传图片' : !prompt.trim() ? '请输入创意想法' : '开始生成'}>
          <span>
            <CyberCornerButton
              variant="primary"
              icon={<ArrowUpOutlined />}
              disabled={!canGenerate}
              onClick={handleGenerate}
              aria-label="开始生成"
            >
              生成图片
            </CyberCornerButton>
          </span>
        </Tooltip>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        hidden
        onChange={handleImageChange}
      />
    </section>
  );

  const templateGallery = (
    <section className={styles.templates} aria-label="创意模板">
      <div className={styles.templateHeading}>
        <div>
          <span className={styles.eyebrow}>INSPIRATION</span>
          <h2>精选创意模板</h2>
        </div>
      </div>
      <div className={styles.templateGrid}>
        {PHOTO_WORKSHOP_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className={styles.templateCard}
            onClick={() => applyTemplate(template.prompt)}
            disabled={isGenerating}
          >
            <img src={template.image} alt="" />
            <span className={styles.templateLabel}>{template.title}</span>
            <span className={styles.templateOverlay}>
              <strong>{template.title}</strong>
              <span>{template.subtitle}</span>
              <small>{template.prompt}</small>
              <em>使用此模板</em>
            </span>
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <main className={`${styles.page} ${hasHistory ? styles.pageWithHistory : styles.pageInitial}`}>
      <header className={styles.pageHeader}>
        <span className={styles.eyebrow}>PHOTO CREATIVE STUDIO</span>
        <h1>相册创意工坊</h1>
        <p>让旅途照片换一种表达，把你的想象变成看得见的作品。</p>
      </header>

      {error ? (
        <Alert
          className={styles.errorAlert}
          type="error"
          showIcon
          closable
          message={error}
          onClose={() => setError('')}
        />
      ) : null}

      {handoffNotice ? (
        <Alert
          className={styles.errorAlert}
          type="info"
          showIcon
          closable
          message={handoffNotice}
          onClose={() => setHandoffNotice('')}
        />
      ) : null}

      {hasHistory ? (
        <>
          <section
            ref={historyScrollRef}
            className={styles.historyViewport}
            aria-label="本次创作历史"
          >
            <div className={styles.historyHeading}>
              <div>
                <span className={styles.eyebrow}>THIS SESSION</span>
                <h2>本次创作</h2>
              </div>
              <span>{history.length} 张作品</span>
            </div>
            {history.map((entry) => (
              <article key={entry.id} className={styles.historyCard}>
                <time>{formatTime(entry.createdAt)}</time>
                <p className={styles.historyPrompt}>{entry.prompt}</p>
                <HistoryMeta snapshot={entry} />
                <button
                  type="button"
                  className={styles.resultFrame}
                  onClick={() => setPreview(entry.result)}
                  aria-label="预览生成图片"
                >
                  <img src={entry.result.dataUrl} alt="AI 创作结果" />
                  <span>点击预览</span>
                </button>
                <div className={styles.historyActions}>
                  <CyberCornerButton
                    variant="ghost"
                    icon={<EditOutlined />}
                    disabled={isGenerating}
                    onClick={() => handleReEdit(entry)}
                  >
                    重新编辑
                  </CyberCornerButton>
                  <CyberCornerButton
                    variant="secondary"
                    icon={<ReloadOutlined />}
                    disabled={isGenerating}
                    onClick={() => void generateFromSnapshot(entry)}
                  >
                    重新生成
                  </CyberCornerButton>
                </div>
              </article>
            ))}
            {pending ? (
              <article className={`${styles.historyCard} ${styles.pendingCard}`} aria-live="polite">
                <span className={styles.generatingLabel}>正在生成你的创意作品…</span>
                <p className={styles.historyPrompt}>{pending.snapshot.prompt}</p>
                <HistoryMeta snapshot={pending.snapshot} />
                <div className={`${styles.resultFrame} ${styles.loadingFrame}`}>
                  <Lightfall />
                  <span className={styles.loadingText}>灵感正在成形</span>
                </div>
              </article>
            ) : null}
          </section>
          <div className={styles.composerDock}>
            {templateOpen ? templateGallery : null}
            {composer}
          </div>
        </>
      ) : (
        <div className={styles.initialStage}>
          {composer}
          {templateGallery}
        </div>
      )}

      <Modal
        open={Boolean(preview)}
        footer={null}
        closable={false}
        width="min(94vw, 1480px)"
        centered
        zIndex={2200}
        className={styles.previewModal}
        onCancel={() => setPreview(null)}
        destroyOnHidden
      >
        {preview ? (
          <div className={styles.previewBody}>
            <div className={styles.previewToolbar}>
              <button type="button" onClick={() => setPreview(null)} aria-label="关闭预览">
                <CloseOutlined />
                返回
              </button>
              <button
                type="button"
                onClick={() => downloadPhotoWorkshopImage(preview)}
                aria-label="下载图片"
              >
                <DownloadOutlined />
                下载
              </button>
            </div>
            <img src={preview.dataUrl} alt="生成图片预览" />
          </div>
        ) : null}
      </Modal>
    </main>
  );
}

function HistoryMeta({ snapshot }: { snapshot: PhotoWorkshopSnapshot }) {
  return (
    <div className={styles.historyMeta}>
      <Popover
        trigger="hover"
        placement="bottomLeft"
        content={<img className={styles.referencePopoverImage} src={snapshot.sourceUrl} alt="参考图预览" />}
      >
        <span className={styles.referenceBadge}>
          <img src={snapshot.sourceUrl} alt="" />
          参考图
        </span>
      </Popover>
      <span>{snapshot.resolution}</span>
      <span>{snapshot.aspectRatio === 'smart' ? '智能比例' : snapshot.aspectRatio}</span>
      <span>1 张</span>
    </div>
  );
}
