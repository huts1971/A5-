import {
  CheckOutlined,
  EditOutlined,
  HighlightOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { Button, Input, InputNumber, Modal, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import {
  generateDigitalHumanPersona,
  getDigitalHumanPersona,
  polishDigitalHumanPersona,
  saveDigitalHumanPersona,
} from '../../api/digitalHumanPersona';
import Strands from './Strands';
import { toApiError } from '../../api/client';
import {
  DEFAULT_DIGITAL_HUMAN_PERSONA,
  type DigitalHumanAgeGroup,
  type DigitalHumanExpressionStyle,
  type DigitalHumanGender,
  type DigitalHumanIdentity,
  type DigitalHumanPersona,
  type DigitalHumanPersonaConfig,
  type DigitalHumanPersonality,
} from '../../types/digitalHumanPersona';
import styles from './DigitalHumanPersonaControl.module.css';


const immersiveIdentities: Array<{ value: DigitalHumanIdentity; label: string }> = [
  { value: 'ancient_scholar', label: '古代书生' },
  { value: 'republican_reporter', label: '民国记者' },
  { value: 'future_explorer', label: '未来探险家' },
  { value: 'scenic_resident', label: '景区原住民' },
];

const companionIdentities: Array<{ value: DigitalHumanIdentity; label: string }> = [
  { value: 'professional_guide', label: '专业导游' },
  { value: 'local_friend', label: '当地朋友' },
  { value: 'culture_interpreter', label: '历史文化讲解员' },
  { value: 'food_expert', label: '美食达人' },
  { value: 'photography_guide', label: '摄影向导' },
  { value: 'travel_butler', label: '旅行管家' },
  { value: 'unspecified', label: '不设定' },
];

const ageGroups: Array<{ value: DigitalHumanAgeGroup; label: string }> = [
  { value: 'teen', label: '少年' },
  { value: 'young', label: '青年' },
  { value: 'middle', label: '中年' },
  { value: 'senior', label: '年长' },
  { value: 'unspecified', label: '不设定' },
];

const genders: Array<{ value: DigitalHumanGender; label: string }> = [
  { value: 'male', label: '男性' },
  { value: 'female', label: '女性' },
  { value: 'neutral', label: '中性' },
  { value: 'unspecified', label: '不设定' },
];

const personalities: Array<{ value: DigitalHumanPersonality; label: string }> = [
  { value: 'gentle', label: '温柔耐心' },
  { value: 'cheerful', label: '开朗活泼' },
  { value: 'professional', label: '沉稳专业' },
  { value: 'humorous', label: '幽默风趣' },
  { value: 'talkative', label: '热情健谈' },
  { value: 'considerate', label: '细致体贴' },
  { value: 'curious', label: '好奇博学' },
  { value: 'calm', label: '冷静克制' },
];

const expressionStyles: Array<{ value: DigitalHumanExpressionStyle; label: string }> = [
  { value: 'direct', label: '简洁直接' },
  { value: 'detailed', label: '详细讲解' },
  { value: 'storytelling', label: '故事化' },
  { value: 'casual', label: '轻松口语' },
  { value: 'formal', label: '正式专业' },
  { value: 'poetic', label: '诗意文雅' },
  { value: 'interactive', label: '互动提问式' },
  { value: 'unspecified', label: '不设定' },
];

interface DigitalHumanPersonaControlProps {
  disabled?: boolean;
}

function cloneConfig(config: DigitalHumanPersonaConfig): DigitalHumanPersonaConfig {
  return {
    ...config,
    personalities: [...config.personalities],
  };
}

function configFromPersona(persona: DigitalHumanPersona): DigitalHumanPersonaConfig {
  const {
    isCustomized: _isCustomized,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...config
  } = persona;
  return cloneConfig(config);
}

function defaultPersona(): DigitalHumanPersona {
  return {
    ...cloneConfig(DEFAULT_DIGITAL_HUMAN_PERSONA),
    isCustomized: false,
  };
}

function ageGroupFor(age: number): DigitalHumanAgeGroup {
  if (age <= 17) return 'teen';
  if (age <= 35) return 'young';
  if (age <= 59) return 'middle';
  return 'senior';
}

export default function DigitalHumanPersonaControl({
  disabled = false,
}: DigitalHumanPersonaControlProps) {
  const [messageApi, messageContextHolder] = message.useMessage();
  const [modalApi, modalContextHolder] = Modal.useModal();
  const [persona, setPersona] = useState<DigitalHumanPersona>(() => defaultPersona());
  const [baseline, setBaseline] = useState<DigitalHumanPersonaConfig>(() =>
    cloneConfig(DEFAULT_DIGITAL_HUMAN_PERSONA),
  );
  const [draft, setDraft] = useState<DigitalHumanPersonaConfig>(() =>
    cloneConfig(DEFAULT_DIGITAL_HUMAN_PERSONA),
  );
  const [open, setOpen] = useState(false);
  const [loadingPersona, setLoadingPersona] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiAction, setAiAction] = useState<'generate' | 'polish'>();

  useEffect(() => {
    let active = true;
    getDigitalHumanPersona()
      .then((loaded) => {
        if (!active) return;
        const config = configFromPersona(loaded);
        setPersona(loaded);
        setBaseline(config);
        setDraft(config);
      })
      .catch((error) => {
        if (!active) return;
        messageApi.error(toApiError(error, '个性化配置加载失败，请稍后重试。').message);
      })
      .finally(() => {
        if (active) setLoadingPersona(false);
      });
    return () => {
      active = false;
    };
  }, [messageApi]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [baseline, draft],
  );

  const openEditor = () => {
    const current = configFromPersona(persona);
    setBaseline(current);
    setDraft(current);
    setOpen(true);
  };

  const closeEditor = () => {
    setDraft(cloneConfig(baseline));
    setOpen(false);
  };

  const requestClose = () => {
    if (!dirty) {
      closeEditor();
      return;
    }
    modalApi.confirm({
      className: styles.unsavedConfirm,
      title: '放弃未保存修改？',
      content: '关闭后，本次调整不会保存到你的数字人。',
      okText: '放弃修改',
      cancelText: '继续编辑',
      centered: true,
      onOk: closeEditor,
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveDigitalHumanPersona(draft);
      const config = configFromPersona(saved);
      setPersona(saved);
      setBaseline(config);
      setDraft(config);
      setOpen(false);
      messageApi.success('个性化数字人已保存并应用');
    } catch (error) {
      messageApi.error(toApiError(error, '保存失败，请稍后重试。').message);
    } finally {
      setSaving(false);
    }
  };

  const updateAgeGroup = (ageGroup: DigitalHumanAgeGroup) => {
    setDraft((current) => ({
      ...current,
      ageMode: 'group',
      ageGroup,
      exactAge: undefined,
    }));
  };

  const updateExactAge = (value: number | null) => {
    setDraft((current) => {
      if (value === null) {
        return {
          ...current,
          ageMode: 'group',
          exactAge: undefined,
        };
      }
      return {
        ...current,
        ageMode: 'exact',
        exactAge: value,
        ageGroup: ageGroupFor(value),
      };
    });
  };

  const togglePersonality = (value: DigitalHumanPersonality) => {
    setDraft((current) => {
      const selected = current.personalities.includes(value);
      if (selected && current.personalities.length === 1) return current;
      if (!selected && current.personalities.length === 3) return current;
      return {
        ...current,
        personalities: selected
          ? current.personalities.filter((item) => item !== value)
          : [...current.personalities, value],
      };
    });
  };

  const runGenerate = async () => {
    setAiAction('generate');
    try {
      const text = await generateDigitalHumanPersona({
        ...draft,
        creativePrompt: '',
      });
      setDraft((current) => ({ ...current, creativePrompt: text }));
    } catch {
      messageApi.error('AI服务暂时不可用，请稍后重试');
    } finally {
      setAiAction(undefined);
    }
  };

  const generate = () => {
    if (!draft.creativePrompt.trim()) {
      void runGenerate();
      return;
    }
    modalApi.confirm({
      className: styles.overwriteConfirm,
      title: '将覆盖当前内容，是否继续？',
      content: 'AI 将根据上方选择重新创作人设，当前文本不会保留。',
      okText: '继续创作',
      cancelText: '取消',
      centered: true,
      onOk: () => {
        void runGenerate();
      },
    });
  };

  const polish = async () => {
    if (!draft.creativePrompt.trim()) return;
    setAiAction('polish');
    try {
      const text = await polishDigitalHumanPersona(draft);
      setDraft((current) => ({ ...current, creativePrompt: text }));
    } catch {
      messageApi.error('AI服务暂时不可用，请稍后重试');
    } finally {
      setAiAction(undefined);
    }
  };

  const restoreDefaults = () => {
    setDraft(cloneConfig(DEFAULT_DIGITAL_HUMAN_PERSONA));
  };

  const renderIdentityGroup = (
    title: string,
    options: Array<{ value: DigitalHumanIdentity; label: string }>,
  ) => (
    <div className={styles.identityGroup}>
      <div className={styles.groupLabel}>{title}</div>
      <div className={styles.identityGrid}>
        {options.map((option) => {
          const selected = draft.identity === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`${styles.identityCard} ${selected ? styles.selected : ''}`}
              aria-pressed={selected}
              data-value={option.value}
              onClick={() => setDraft((current) => ({ ...current, identity: option.value }))}
            >
              <span>{option.label}</span>
              {selected ? <CheckOutlined aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {messageContextHolder}
      {modalContextHolder}
      <Button
        className={styles.trigger}
        icon={<HighlightOutlined />}
        disabled={disabled || loadingPersona}
        loading={loadingPersona}
        data-testid="digital-human-persona-trigger"
        onClick={openEditor}
      >
        {persona.isCustomized ? (
          <span className={styles.customizedLabel}>
            <i aria-hidden="true" />
            已个性化
          </span>
        ) : (
          '个性化数字人'
        )}
      </Button>

      <Modal
        open={open}
        width={920}
        centered
        title={(
          <div className={styles.modalTitle}>
            <span className={styles.titleIcon}><HighlightOutlined /></span>
            <span>
              <strong>个性化数字人</strong>
            </span>
          </div>
        )}
        className={styles.modal}
        rootClassName={styles.modalRoot}
        destroyOnHidden
        onCancel={requestClose}
        maskClosable
        keyboard
        footer={(
          <div className={styles.footer}>
            <Button
              icon={<UndoOutlined />}
              disabled={saving || Boolean(aiAction)}
              onClick={restoreDefaults}
            >
              恢复默认
            </Button>
            <span className={styles.footerSpacer} />
            <Button disabled={saving || Boolean(aiAction)} onClick={requestClose}>
              取消
            </Button>
            <Button
              type="primary"
              loading={saving}
              disabled={Boolean(aiAction)}
              data-testid="digital-human-persona-save"
              onClick={() => void save()}
            >
              确认创建
            </Button>
          </div>
        )}
      >
        <div className={styles.form} data-testid="digital-human-persona-form">
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <span>01</span>
              <div>
                <h3>身份与角色</h3>
              </div>
            </div>
            {renderIdentityGroup('沉浸式角色', immersiveIdentities)}
            {renderIdentityGroup('旅行陪伴角色', companionIdentities)}
          </section>

          <section className={`${styles.section} ${styles.twoColumns}`}>
            <div className={styles.fieldBlock}>
              <div className={styles.fieldHeading}>
                <h3>年龄</h3>
              </div>
              <div className={styles.chipRow}>
                {ageGroups.map((option) => {
                  const selected = draft.ageMode === 'group' && draft.ageGroup === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`${styles.chip} ${selected ? styles.selected : ''}`}
                      aria-pressed={selected}
                      onClick={() => updateAgeGroup(option.value)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <label className={styles.exactAge}>
                <span>具体年龄</span>
                <InputNumber
                  min={1}
                  max={120}
                  precision={0}
                  value={draft.ageMode === 'exact' ? draft.exactAge : null}
                  placeholder="1–120"
                  aria-label="具体年龄"
                  onChange={updateExactAge}
                />
                <small>岁</small>
              </label>
            </div>

            <div className={styles.fieldBlock}>
              <div className={styles.fieldHeading}>
                <h3>性别</h3>
              </div>
              <div className={styles.chipRow}>
                {genders.map((option) => {
                  const selected = draft.gender === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`${styles.chip} ${selected ? styles.selected : ''}`}
                      aria-pressed={selected}
                      onClick={() => setDraft((current) => ({ ...current, gender: option.value }))}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <span>02</span>
              <div>
                <h3>性格与表达</h3>
              </div>
            </div>
            <div className={styles.fieldBlock}>
              <div className={styles.groupLabel}>性格特征</div>
              <div className={styles.chipRow}>
                {personalities.map((option) => {
                  const selected = draft.personalities.includes(option.value);
                  const disabledOption = !selected && draft.personalities.length >= 3;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`${styles.chip} ${selected ? styles.selected : ''}`}
                      aria-pressed={selected}
                      disabled={disabledOption}
                      onClick={() => togglePersonality(option.value)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className={styles.fieldBlock}>
              <div className={styles.groupLabel}>表达风格</div>
              <div className={styles.chipRow}>
                {expressionStyles.map((option) => {
                  const selected = draft.expressionStyle === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`${styles.chip} ${selected ? styles.selected : ''}`}
                      aria-pressed={selected}
                      onClick={() => setDraft((current) => ({
                        ...current,
                        expressionStyle: option.value,
                      }))}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className={`${styles.section} ${styles.creativeSection}`}>
            <div className={styles.sectionHeading}>
              <span>03</span>
              <div>
                <h3>创想时刻 <em>选填</em></h3>
              </div>
            </div>
            <div className={styles.textareaStage} aria-busy={Boolean(aiAction)}>
              <Input.TextArea
                className={styles.textarea}
                value={draft.creativePrompt}
                maxLength={1000}
                showCount
                autoSize={{ minRows: 10, maxRows: 13 }}
                placeholder="自由发挥您的创意，详细描述您的奇思妙想"
                aria-label="创想时刻"
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  creativePrompt: event.target.value,
                }))}
              />
              {aiAction ? (
                <div
                  className={styles.aiThinking}
                  role="status"
                  aria-label={aiAction === 'generate' ? 'AI 正在创作' : 'AI 正在润色'}
                  data-testid="digital-human-persona-ai-thinking"
                >
                  <Strands className={styles.strands} />
                </div>
              ) : null}
            </div>
            <div className={styles.aiActions}>
              <Button
                icon={<HighlightOutlined />}
                loading={aiAction === 'generate'}
                disabled={saving || Boolean(aiAction)}
                data-testid="digital-human-persona-generate"
                onClick={generate}
              >
                AI帮我创作
              </Button>
              <Button
                icon={<EditOutlined />}
                loading={aiAction === 'polish'}
                disabled={saving || Boolean(aiAction) || !draft.creativePrompt.trim()}
                data-testid="digital-human-persona-polish"
                onClick={() => void polish()}
              >
                AI润色
              </Button>
            </div>
          </section>
        </div>
      </Modal>
    </>
  );
}
