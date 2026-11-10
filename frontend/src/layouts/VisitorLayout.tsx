import {
  CompassOutlined,
  CommentOutlined,
  DownOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  HistoryOutlined,
  HomeOutlined,
  NodeIndexOutlined,
  PictureOutlined,
  ReadOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Layout, Menu, Space, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clearVisitorToken, getCurrentVisitor, readVisitorToken } from '../api/auth';
import LingShanLoadingOverlay from '../components/common/LingShanLoadingOverlay';
import DigitalHumanSettingsMenu from '../components/guide/DigitalHumanSettingsMenu';
import FloatingLingShiYinChat from '../components/guide/FloatingLingShiYinChat';
import GuideServiceMenu from '../components/guide/GuideServiceMenu';
import { isGuideServiceCategory } from '../components/guide/guideService';
import { productCopy } from '../config/product';
import type { AuthUser } from '../types/api';
import { VisitorAuthContext } from '../utils/visitorAuthContext';
import {
  clearVisitorSessionState,
  loadRouteEntrySession,
  prepareVisitorSessionStateForPageOpen,
} from '../utils/visitorSessionState';

const guestNavItems: MenuProps['items'] = [{ key: '/', label: <Link to="/">[ 首页 ]</Link> }];

const visitorLanguageItems: MenuProps['items'] = [
  { key: 'zh-CN', label: '简体中文' },
  { key: 'en', label: 'English' },
  { key: 'ja', label: '日本語' },
  { key: 'ko', label: '한국어' },
  { key: 'fr', label: 'Français' },
  { key: 'de', label: 'Deutsch' },
  { key: 'es', label: 'Español' },
  { key: 'ru', label: 'Русский' },
];

prepareVisitorSessionStateForPageOpen();

function hasLoginEntryLoaderState(state: unknown) {
  return Boolean((state as { showLingShanLoader?: boolean } | null)?.showLingShanLoader);
}

function isProtectedVisitorPath(pathname: string) {
  return (
    pathname === '/spots' ||
    pathname.startsWith('/spots/') ||
    pathname === '/routes' ||
    pathname.startsWith('/route-drafts/') ||
    pathname.startsWith('/tour/') ||
    pathname === '/tour-recaps' ||
    pathname === '/community' ||
    pathname === '/travel-journal' ||
    pathname === '/photo-workshop' ||
    pathname === '/services' ||
    pathname.startsWith('/services/') ||
    pathname === '/panorama' ||
    pathname === '/guide' ||
    pathname === '/scene-guide' ||
    pathname === '/digital-human-settings'
  );
}

function shouldShowFloatingLingShiYinChat(pathname: string) {
  const isTourRecap = /^\/tour\/[^/]+\/recap\/?$/.test(pathname);
  return (
    pathname === '/spots' ||
    pathname.startsWith('/spots/') ||
    pathname === '/routes' ||
    pathname.startsWith('/route-drafts/') ||
    (pathname.startsWith('/tour/') && !isTourRecap)
  );
}

function resolveSelectedVisitorNavKey(pathname: string, isSignedIn: boolean) {
  if (pathname.startsWith('/spots')) return '/spots';
  if (pathname === '/tour-recaps' || /^\/tour\/[^/]+\/recap\/?$/.test(pathname)) {
    return '/tour-recaps';
  }
  if (
    pathname === '/routes' ||
    pathname.startsWith('/route-drafts/') ||
    pathname.startsWith('/tour/')
  ) {
    return '/routes';
  }
  if (pathname === '/guide') return '/guide';
  if (pathname === '/scene-guide') return '/scene-guide';
  if (pathname === '/community') return '/community';
  if (pathname === '/travel-journal') return '/travel-journal';
  if (pathname === '/photo-workshop') return '/photo-workshop';
  if (pathname === '/panorama') return '/panorama';
  if (pathname === '/digital-human-settings') return '';
  return isSignedIn ? '' : '/';
}

export default function VisitorLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginEntryLoader, setShowLoginEntryLoader] = useState(
    () => location.pathname === '/' && hasLoginEntryLoaderState(location.state),
  );
  const isHome = location.pathname === '/';
  const isSpots = location.pathname === '/spots';
  const isSpotDetail = /^\/spots\/[^/]+$/.test(location.pathname);
  const isSceneGuide = location.pathname === '/scene-guide';
  const usesFixedVisitorHeader = isHome || isSpots;
  const isSignedIn = Boolean(user);
  const showFloatingLingShiYinChat = isSignedIn && shouldShowFloatingLingShiYinChat(location.pathname);
  const servicePathKey = location.pathname.startsWith('/services/')
    ? location.pathname.split('/')[2]
    : '';
  const activeServiceCategory = isGuideServiceCategory(servicePathKey) ? servicePathKey : undefined;
  const heatmapActive = servicePathKey === 'heatmap';
  const routeEntry = loadRouteEntrySession();
  const routeNavPath =
    routeEntry?.mode === 'recommendation' && routeEntry.path.startsWith('/routes')
      ? routeEntry.path
      : '/routes';
  const routeNavState = location.pathname === '/guide' && routeEntry?.skipHydraLoader && routeNavPath.startsWith('/routes')
    ? { skipHydraLoader: true }
    : undefined;
  const visitorNavItems = useMemo<MenuProps['items']>(() => [
    {
      key: '/guide',
      icon: <RobotOutlined />,
      label: <Link to="/guide">数字人导游</Link>,
    },
    {
      key: '/spots',
      icon: <HomeOutlined />,
      label: <Link to="/spots">景点总览</Link>,
    },
    {
      key: '/panorama',
      icon: <GlobalOutlined />,
      label: <Link to="/panorama">全景地图</Link>,
    },
    {
      key: '/routes',
      icon: <NodeIndexOutlined />,
      label: <Link to={routeNavPath} state={routeNavState}>个性化推荐</Link>,
    },
    {
      key: '/scene-guide',
      icon: <EnvironmentOutlined />,
      label: <Link to="/scene-guide">场景式导览</Link>,
    },
    {
      key: '/tour-recaps',
      icon: <HistoryOutlined />,
      label: <Link to="/tour-recaps">游览回顾</Link>,
    },
    {
      key: '/community',
      icon: <CommentOutlined />,
      label: <Link to="/community">评论社区</Link>,
    },
    {
      key: '/travel-journal',
      icon: <ReadOutlined />,
      label: <Link to="/travel-journal">旅行手账共创</Link>,
    },
    {
      key: '/photo-workshop',
      icon: <PictureOutlined />,
      label: <Link to="/photo-workshop">相册创意工坊</Link>,
    },
  ], [routeNavPath, routeNavState]);
  const selectedKey = resolveSelectedVisitorNavKey(location.pathname, isSignedIn);

  useEffect(() => {
    let cancelled = false;
    const token = readVisitorToken();
    if (!token) {
      clearVisitorSessionState();
      setUser(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    getCurrentVisitor(token)
      .then((currentUser) => {
        if (!cancelled) {
          setUser(currentUser.role === 'visitor' ? currentUser : null);
        }
      })
      .catch(() => {
        clearVisitorToken();
        clearVisitorSessionState();
        if (!cancelled) {
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loading && !user && isProtectedVisitorPath(location.pathname)) {
      navigate('/', { replace: true });
    }
  }, [loading, location.pathname, navigate, user]);

  useEffect(() => {
    if (location.pathname !== '/' || !hasLoginEntryLoaderState(location.state)) return;
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
      { replace: true, state: null },
    );
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  const finishHomeLoader = useCallback(() => {
    setShowLoginEntryLoader(false);
  }, []);

  const authState = useMemo(
    () => ({
      user,
      loading,
      logout: () => {
        clearVisitorToken();
        clearVisitorSessionState();
        setUser(null);
        navigate('/', { replace: true });
      },
    }),
    [loading, navigate, user],
  );

  return (
    <VisitorAuthContext.Provider value={authState}>
      <Layout
        className={`visitor-layout ${isHome ? 'visitor-layout-home' : ''} ${isSpots ? 'visitor-layout-spots' : ''} ${
          isSpotDetail ? 'visitor-layout-immersive' : ''
        } ${isSceneGuide ? 'visitor-layout-scene-guide' : ''} ${
          !isSignedIn && usesFixedVisitorHeader ? 'visitor-layout-fixed-header' : ''
        } ${
          isSignedIn ? 'visitor-layout-sidebar' : ''
        }`}
      >
        {isSignedIn ? (
          <>
            <Layout.Sider className="visitor-sider" width={232} breakpoint="lg" collapsedWidth={0}>
              <Link to="/guide" className="visitor-sider-brand">
                <span className="brand-symbol visitor-sider-brand-symbol" aria-hidden="true">
                  <CompassOutlined />
                </span>
                <span>{productCopy.visitorBrandName}</span>
              </Link>
              <Menu
                className="visitor-sider-menu visitor-primary-menu"
                mode="inline"
                selectedKeys={selectedKey ? [selectedKey] : []}
                items={visitorNavItems}
              />
              <div
                id="visitor-guide-service-menu-slot"
                className="visitor-guide-service-menu-slot"
                aria-live="polite"
              />
              <DigitalHumanSettingsMenu />
            </Layout.Sider>
            <GuideServiceMenu
              activeCategory={activeServiceCategory}
              heatmapActive={heatmapActive}
            />
            <Layout className="visitor-main-layout">
              <Layout.Header className="visitor-sidebar-header">
                <span aria-hidden />
                <Space>
                  <Dropdown
                    menu={{
                      items: visitorLanguageItems,
                      selectable: true,
                      defaultSelectedKeys: ['zh-CN'],
                    }}
                    placement="bottomRight"
                    trigger={['click']}
                    overlayClassName="visitor-language-dropdown"
                  >
                    <Button className="visitor-language-button" icon={<GlobalOutlined />}>
                      <span className="visitor-language-button-label">语言</span>
                      <DownOutlined className="visitor-language-button-arrow" />
                    </Button>
                  </Dropdown>
                  <Typography.Text className="visitor-sidebar-user-label">
                    游客 {user?.username}
                  </Typography.Text>
                  <Button onClick={authState.logout}>退出登录</Button>
                </Space>
              </Layout.Header>
              <Layout.Content className="visitor-content">
                <Outlet />
              </Layout.Content>
            </Layout>
          </>
        ) : (
          <>
            <Layout.Header className="visitor-header">
            <Link to="/" className="brand-mark" data-cue={isSignedIn ? undefined : '[ 首页 ]'}>
              <span className="brand-symbol" aria-hidden="true">
                L
              </span>
              <span className="brand-text">{productCopy.visitorBrandName}</span>
            </Link>
            <Menu
              className="visitor-menu"
              mode="horizontal"
              selectedKeys={selectedKey ? [selectedKey] : []}
              items={guestNavItems}
            />
            <div className="visitor-auth-actions">
              <Link to="/login">
                <Button>[ 登录 ]</Button>
              </Link>
              <Link to="/register">
                <Button type="primary">[ 注册 ]</Button>
              </Link>
            </div>
          </Layout.Header>
            <Layout.Content className="visitor-content">
              <Outlet />
            </Layout.Content>
          </>
        )}
        {showFloatingLingShiYinChat ? <FloatingLingShiYinChat /> : null}
        {showLoginEntryLoader ? <LingShanLoadingOverlay preserveHeader onComplete={finishHomeLoader} /> : null}
      </Layout>
    </VisitorAuthContext.Provider>
  );
}
