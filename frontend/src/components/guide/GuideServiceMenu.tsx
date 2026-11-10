import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  AppstoreOutlined,
  CarOutlined,
  CoffeeOutlined,
  HeatMapOutlined,
  HomeOutlined,
  RestOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { Menu } from 'antd';
import type { MenuProps } from 'antd';
import type { GuideServiceCategory } from './guideService';
import { GUIDE_SERVICE_CATEGORIES } from './guideService';

interface GuideServiceMenuProps {
  activeCategory?: GuideServiceCategory;
  disabled?: boolean;
  heatmapActive?: boolean;
}

function categoryIcon(category: GuideServiceCategory) {
  switch (category) {
    case 'restroom':
      return <RestOutlined aria-hidden="true" />;
    case 'dining':
      return <CoffeeOutlined aria-hidden="true" />;
    case 'lodging':
      return <HomeOutlined aria-hidden="true" />;
    case 'shop':
      return <ShopOutlined aria-hidden="true" />;
    case 'shuttle':
      return <CarOutlined aria-hidden="true" />;
  }
}

export default function GuideServiceMenu({
  activeCategory,
  disabled = false,
  heatmapActive = false,
}: GuideServiceMenuProps) {
  const [sidebarTarget, setSidebarTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let animationFrame = 0;
    const findSidebarTarget = () => {
      const target = document.getElementById('visitor-guide-service-menu-slot');
      if (target) {
        setSidebarTarget(target);
        return;
      }
      animationFrame = window.requestAnimationFrame(findSidebarTarget);
    };
    findSidebarTarget();
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  if (!sidebarTarget) return null;

  const serviceItems: MenuProps['items'] = [
    {
      key: '/visitor-services',
      icon: <AppstoreOutlined />,
      label: '景区服务',
      children: [
        {
          key: 'heatmap',
          icon: <HeatMapOutlined />,
          label: <Link to="/services/heatmap" data-testid="guide-heatmap-prompt">景区热力图</Link>,
          disabled,
        },
        ...GUIDE_SERVICE_CATEGORIES.map((category) => ({
          key: category.id,
          icon: categoryIcon(category.id),
          label: <Link to={`/services/${category.id}`} data-testid={`guide-service-${category.id}`}>{category.label}</Link>,
          disabled,
        })),
      ],
    },
  ];

  return createPortal(
    <aside
      className="visitor-guide-service-menu-root"
      aria-label="景区服务"
      data-testid="guide-service-menu"
    >
      <Menu
        className="visitor-sider-menu visitor-guide-service-menu"
        mode="inline"
        selectedKeys={heatmapActive ? ['heatmap'] : activeCategory ? [activeCategory] : []}
        items={serviceItems}
      />
    </aside>,
    sidebarTarget,
  );
}
