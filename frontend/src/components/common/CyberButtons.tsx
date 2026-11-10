import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './CyberButtons.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

type CyberButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  children: ReactNode;
  htmlType?: ButtonHTMLAttributes<HTMLButtonElement>['type'];
  icon?: ReactNode;
  loading?: boolean;
  tag?: string;
  variant?: ButtonVariant;
  block?: boolean;
  compact?: boolean;
};

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function ButtonContent({ children, icon }: Pick<CyberButtonProps, 'children' | 'icon'>) {
  return (
    <span className={styles.content}>
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span className={styles.label}>{children}</span>
    </span>
  );
}

export function CyberGlitchButton({
  children,
  className,
  disabled,
  htmlType = 'button',
  icon,
  loading = false,
  tag = 'R25',
  variant = 'primary',
  block = false,
  compact = false,
  ...buttonProps
}: CyberButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...buttonProps}
      type={htmlType}
      className={cx(
        styles.glitchButton,
        styles[`glitch_${variant}`],
        block && styles.block,
        compact && styles.compact,
        className,
      )}
      disabled={isDisabled}
      aria-busy={loading || undefined}
    >
      <ButtonContent icon={icon}>{loading ? '处理中...' : children}</ButtonContent>
      <span aria-hidden="true" className={styles.glitchLayer}>
        <ButtonContent icon={icon}>{loading ? '处理中...' : children}</ButtonContent>
      </span>
      <span aria-hidden="true" className={styles.glitchTag}>
        {tag}
      </span>
    </button>
  );
}

export function CyberCornerButton({
  children,
  className,
  disabled,
  htmlType = 'button',
  icon,
  loading = false,
  variant = 'secondary',
  block = false,
  compact = false,
  ...buttonProps
}: CyberButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...buttonProps}
      type={htmlType}
      className={cx(
        styles.cornerButton,
        styles[`corner_${variant}`],
        block && styles.block,
        compact && styles.compact,
        className,
      )}
      disabled={isDisabled}
      aria-busy={loading || undefined}
    >
      <ButtonContent icon={icon}>{loading ? '处理中...' : children}</ButtonContent>
    </button>
  );
}
