import {
  CheckCircleOutlined,
  CloudSyncOutlined,
  CommentOutlined,
  DatabaseOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  BarChartOutlined,
  HomeOutlined,
  MessageOutlined,
  NodeIndexOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { Button, Layout, Menu, Space, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clearAdminToken, getCurrentUser, readAdminToken } from '../api/auth';
import { productCopy } from '../config/product';
import type { AuthUser } from '../types/api';

const adminItems: MenuProps['items'] = [
  {
    key: '/dashboard',
    icon: <DashboardOutlined />,
    label: '数据看板',
    children: [
      {
        key: '/dashboard/charts',
        icon: <BarChartOutlined />,
        label: <Link to="/dashboard/charts">数据分析图</Link>,
      },
      {
        key: '/dashboard/hot-questions',
        icon: <QuestionCircleOutlined />,
        label: <Link to="/dashboard/hot-questions">热门问题</Link>,
      },
      {
        key: '/dashboard/visitor-insights',
        icon: <FileSearchOutlined />,
        label: <Link to="/dashboard/visitor-insights">游客问答分析</Link>,
      },
    ],
  },
  {
    key: '/knowledge',
    icon: <DatabaseOutlined />,
    label: '知识库管理',
    children: [
      {
        key: '/knowledge/docs',
        icon: <FileTextOutlined />,
        label: <Link to="/knowledge/docs">后端知识文档</Link>,
      },
      {
        key: '/knowledge/facts',
        icon: <CheckCircleOutlined />,
        label: <Link to="/knowledge/facts">已入库联网事实</Link>,
      },
      {
        key: '/knowledge/candidates',
        icon: <CloudSyncOutlined />,
        label: <Link to="/knowledge/candidates">联网事实候选</Link>,
      },
    ],
  },
  { key: '/spots', icon: <HomeOutlined />, label: <Link to="/spots">景点管理</Link> },
  { key: '/routes', icon: <NodeIndexOutlined />, label: <Link to="/routes">路线管理</Link> },
  { key: '/logs', icon: <MessageOutlined />, label: <Link to="/logs">问答日志</Link> },
  { key: '/community', icon: <CommentOutlined />, label: <Link to="/community">社区管理</Link> },
  { key: '/feedback', icon: <StarOutlined />, label: <Link to="/feedback">用户反馈</Link> },
  { key: '/avatars', icon: <RobotOutlined />, label: <Link to="/avatars">数字人形象管理</Link> },
];

const adminNavItems = adminItems ?? [];

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [openKeys, setOpenKeys] = useState<string[]>(getOpenAdminKeys(location.pathname));
  const selectedKey = getSelectedAdminKey(location.pathname);

  useEffect(() => {
    setOpenKeys(getOpenAdminKeys(location.pathname));
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    const token = readAdminToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      navigate('/login', { replace: true });
      return undefined;
    }

    setLoading(true);
    getCurrentUser(token)
      .then((currentUser) => {
        if (cancelled) {
          return;
        }
        if (currentUser.role !== 'admin') {
          clearAdminToken();
          setUser(null);
          navigate('/login', { replace: true });
          return;
        }
        setUser(currentUser);
      })
      .catch(() => {
        clearAdminToken();
        if (!cancelled) {
          setUser(null);
          navigate('/login', { replace: true });
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
  }, [navigate]);

  function logout() {
    clearAdminToken();
    setUser(null);
    navigate('/login', { replace: true });
  }

  if (loading || !user) {
    return <div className="admin-auth-loading">[ OPS ]</div>;
  }

  return (
    <Layout className="admin-layout">
      <Layout.Sider className="admin-sider" width={232} breakpoint="lg" collapsedWidth={0}>
        <Link to="/dashboard/charts" className="admin-brand">
          <span className="brand-symbol admin-brand-symbol">
            <FileSearchOutlined />
          </span>
          <span>{productCopy.adminBrandName}</span>
        </Link>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          openKeys={openKeys}
          onOpenChange={(keys) => setOpenKeys(keys.map(String))}
          items={adminNavItems}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header className="admin-header">
          <span aria-hidden />
          <Space>
            <Typography.Text className="admin-user-label">管理员</Typography.Text>
            <Button onClick={logout}>退出登录</Button>
          </Space>
        </Layout.Header>
        <Layout.Content className="admin-content">
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

function getSelectedAdminKey(pathname: string) {
  if (pathname.startsWith('/dashboard/hot-questions')) {
    return '/dashboard/hot-questions';
  }
  if (pathname.startsWith('/dashboard/visitor-insights')) {
    return '/dashboard/visitor-insights';
  }
  if (pathname.startsWith('/dashboard')) {
    return '/dashboard/charts';
  }
  if (pathname.startsWith('/knowledge/candidates')) {
    return '/knowledge/candidates';
  }
  if (pathname.startsWith('/knowledge/facts')) {
    return '/knowledge/facts';
  }
  if (pathname.startsWith('/knowledge')) {
    return '/knowledge/docs';
  }
  return (
    adminNavItems.find(
      (item) => typeof item?.key === 'string' && pathname.startsWith(item.key),
    )?.key?.toString() ?? '/dashboard/charts'
  );
}

function getOpenAdminKeys(pathname: string) {
  if (pathname.startsWith('/dashboard')) {
    return ['/dashboard'];
  }
  if (pathname.startsWith('/knowledge')) {
    return ['/knowledge'];
  }
  return [];
}
