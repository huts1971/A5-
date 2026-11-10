import {
  CheckOutlined,
  CustomerServiceOutlined,
  ReloadOutlined,
  SoundOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Button, Tooltip, message } from 'antd';
import { useMemo, useState } from 'react';
import styles from './DigitalHumanSettingsPage.module.css';

type AppearanceId = 'ling-shiyin' | 'ling-xiaoyu' | 'qingyin';
type VoiceId = 'gentle-female' | 'clear-female';

interface AppearanceOption {
  id: AppearanceId;
  name: string;
  image: string;
  imageClassName?: string;
}

const appearanceOptions: AppearanceOption[] = [
  {
    id: 'ling-shiyin',
    name: '灵诗音',
    image: '/avatar/ling-shiyin-anime-full-v3.png',
    imageClassName: styles.framelessPortrait,
  },
  {
    id: 'ling-xiaoyu',
    name: '灵小语',
    image: '/avatar/ling-xiaoyu-anime-v2.png',
    imageClassName: styles.framelessPortrait,
  },
  {
    id: 'qingyin',
    name: '晴音',
    image: '/avatar/qingyin-full-v2.png',
    imageClassName: styles.framelessPortrait,
  },
];

const voiceOptions: Array<{ id: VoiceId; label: string }> = [
  { id: 'gentle-female', label: '温柔女声' },
  { id: 'clear-female', label: '清朗女声' },
];

const defaults = {
  appearance: 'ling-shiyin' as AppearanceId,
  voice: 'gentle-female' as VoiceId,
};

export default function DigitalHumanSettingsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [appearance, setAppearance] = useState<AppearanceId>(defaults.appearance);
  const [voice, setVoice] = useState<VoiceId>(defaults.voice);

  const activeAppearance = useMemo(
    () => appearanceOptions.find((item) => item.id === appearance) ?? appearanceOptions[0],
    [appearance],
  );

  const resetSettings = () => {
    setAppearance(defaults.appearance);
    setVoice(defaults.voice);
  };

  const applySettings = () => {
    messageApi.success('数字人设置已应用（演示）');
  };

  return (
    <main className={styles.page}>
      {contextHolder}
      <header className={styles.header}>
        <div>
          <h1>数字人设置</h1>
        </div>
        <Tooltip title="恢复默认设置">
          <Button
            className={styles.resetButton}
            type="text"
            icon={<ReloadOutlined />}
            aria-label="恢复默认设置"
            onClick={resetSettings}
          />
        </Tooltip>
      </header>

      <div className={styles.workspace}>
        <section className={styles.preview} aria-label="数字人预览">
          <div className={styles.figure}>
            <img
              key={activeAppearance.id}
              className={`${styles.previewImage} ${activeAppearance.imageClassName ?? ''}`}
              src={activeAppearance.image}
              alt={activeAppearance.name}
            />
          </div>

          <div className={styles.previewSummary}>
            <div>
              <strong>{activeAppearance.name}</strong>
            </div>
          </div>
        </section>

        <section className={styles.settings} aria-label="数字人选项">
          <div className={styles.settingSection}>
            <div className={styles.sectionHeading}>
              <UserOutlined aria-hidden="true" />
              <div>
                <h2>形象选择</h2>
              </div>
            </div>
            <div className={styles.appearanceGrid}>
              {appearanceOptions.map((item) => {
                const selected = item.id === appearance;
                return (
                  <button
                    key={item.id}
                    className={`${styles.appearanceOption} ${selected ? styles.optionSelected : ''}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setAppearance(item.id)}
                  >
                    <span className={styles.appearanceThumb}>
                      <img className={item.imageClassName ?? ''} src={item.image} alt="" />
                    </span>
                    <span className={styles.optionText}>
                      <strong>{item.name}</strong>
                    </span>
                    {selected ? <CheckOutlined className={styles.checkIcon} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.settingSection}>
            <div className={styles.sectionHeading}>
              <SoundOutlined aria-hidden="true" />
              <div>
                <h2>语音选择</h2>
              </div>
            </div>
            <div className={`${styles.choiceGrid} ${styles.voiceGrid}`}>
              {voiceOptions.map((item) => {
                const selected = item.id === voice;
                return (
                  <button
                    key={item.id}
                    className={`${styles.choiceOption} ${selected ? styles.optionSelected : ''}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setVoice(item.id)}
                  >
                    <CustomerServiceOutlined aria-hidden="true" />
                    <span className={styles.optionText}>
                      <strong>{item.label}</strong>
                    </span>
                    {selected ? <CheckOutlined className={styles.checkIcon} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <footer className={styles.actions}>
            <Button type="primary" icon={<CheckOutlined />} onClick={applySettings}>
              应用设置
            </Button>
          </footer>
        </section>
      </div>
    </main>
  );
}
