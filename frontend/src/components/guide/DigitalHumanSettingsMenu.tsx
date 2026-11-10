import { RightOutlined, SettingOutlined } from '@ant-design/icons';
import { Link, useLocation } from 'react-router-dom';
import styles from './DigitalHumanSettingsMenu.module.css';

export default function DigitalHumanSettingsMenu() {
  const location = useLocation();
  const active = location.pathname === '/digital-human-settings';

  return (
    <div className={styles.root}>
      <Link
        className={`${styles.link} ${active ? styles.linkActive : ''}`}
        to="/digital-human-settings"
        aria-current={active ? 'page' : undefined}
      >
        <span className={styles.label}>
          <SettingOutlined aria-hidden="true" />
          <span>数字人设置</span>
        </span>
        <RightOutlined className={styles.arrow} aria-hidden="true" />
      </Link>
    </div>
  );
}
