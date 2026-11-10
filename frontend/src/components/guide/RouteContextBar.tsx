import {
  EditOutlined,
  CompassOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { Button } from 'antd';
import { createPortal } from 'react-dom';
import type { GuideRouteContext } from '../../types/scenic';

interface RouteContextBarProps {
  context?: GuideRouteContext;
  disabled?: boolean;
  placement?: 'floating' | 'panel';
  routeOpen?: boolean;
  onGenerateRoute: () => void;
  onOpenRoute: () => void;
  onReturnToDraft?: () => void;
}

export default function RouteContextBar({
  context,
  disabled = false,
  placement = 'floating',
  routeOpen = false,
  onGenerateRoute,
  onOpenRoute,
  onReturnToDraft,
}: RouteContextBarProps) {
  const currentSpot = context?.currentSpot;
  const nextSpot = context?.nextSpot;
  const isLastSpot = Boolean(
    context?.orderedSpots.length &&
      context.currentIndex >= context.orderedSpots.length - 1 &&
      !nextSpot,
  );
  const canReturnToDraft = Boolean(context?.status === 'draft' && context.draftId && onReturnToDraft);
  const placementClass =
    placement === 'panel' ? 'route-context-bar--panel' : 'route-context-bar--floating';

  if (!context || context.status === 'expired' || !currentSpot) {
    const expired = context?.status === 'expired';
    const actionLabel = routeOpen ? '关闭路线以与导游交流' : '去生成路线';
    const bar = (
      <section
        className={`route-context-bar ${placementClass} route-context-bar--empty ${expired ? 'route-context-bar--expired' : ''}`}
        data-testid="guide-route-context-bar"
        aria-label="路线状态"
      >
        <div className="route-context-bar__empty">
          <strong>{expired ? '路线状态已失效，请重新生成路线' : '还没有选择路线'}</strong>
        </div>
        <Button
          type="primary"
          icon={routeOpen ? <CompassOutlined /> : <RocketOutlined />}
          aria-pressed={routeOpen || undefined}
          onClick={routeOpen ? onOpenRoute : onGenerateRoute}
        >
          {actionLabel}
        </Button>
      </section>
    );
    return createPortal(bar, document.body);
  }

  const activeSpot = currentSpot;
  const actionIcon = routeOpen ? <CompassOutlined /> : isLastSpot ? <RocketOutlined /> : <CompassOutlined />;
  const actionLabel = routeOpen ? '关闭路线以与导游交流' : isLastSpot ? '去生成路线' : '打开路线';
  const handleAction = routeOpen ? onOpenRoute : isLastSpot ? onGenerateRoute : onOpenRoute;

  const bar = (
    <section
      className={`route-context-bar ${placementClass} route-context-bar--compact`}
      data-testid="guide-route-context-bar"
      aria-label="路线感知导览状态"
    >
      <div className="route-context-bar__body">
        <div className="route-context-bar__station">
          <span>当前站</span>
          <strong>{activeSpot.name}</strong>
        </div>

        <div className="route-context-bar__station route-context-bar__station--next">
          <span>下一站</span>
          <strong>{nextSpot?.name ?? '已到最后一站'}</strong>
        </div>

        <div className="route-context-bar__actions">
          {canReturnToDraft ? (
            <Button icon={<EditOutlined />} disabled={disabled} onClick={onReturnToDraft}>
              返回编辑路线
            </Button>
          ) : null}
          <Button
            type="primary"
            icon={actionIcon}
            disabled={disabled}
            aria-pressed={routeOpen || undefined}
            onClick={handleAction}
          >
            {actionLabel}
          </Button>
        </div>
      </div>
    </section>
  );
  return createPortal(bar, document.body);
}
