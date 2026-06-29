import { Button, Layout, Menu } from 'antd';
import type { MenuProps } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clearVisitorToken, getCurrentVisitor, readVisitorToken } from '../api/auth';
import { productCopy } from '../config/product';
import type { AuthUser } from '../types/api';
import { VisitorAuthContext } from '../utils/visitorAuthContext';

const visitorNavItems: MenuProps['items'] = [
  { key: '/', label: <Link to="/">[ HOME ]</Link> },
  { key: '/spots', label: <Link to="/spots">[ SPOTS ]</Link> },
  { key: '/routes', label: <Link to="/routes">[ ROUTES ]</Link> },
  { key: '/guide', label: <Link to="/guide">[ GUIDE ]</Link> },
];

const guestNavItems: MenuProps['items'] = [{ key: '/', label: <Link to="/">[ HOME ]</Link> }];

function isProtectedVisitorPath(pathname: string) {
  return (
    pathname === '/spots' ||
    pathname.startsWith('/spots/') ||
    pathname === '/routes' ||
    pathname.startsWith('/route-drafts/') ||
    pathname.startsWith('/tour/') ||
    pathname === '/guide'
  );
}

export default function VisitorLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const isHome = location.pathname === '/';
  const isGuide = location.pathname === '/guide';
  const isSpots = location.pathname === '/spots';
  const isSpotDetail = /^\/spots\/[^/]+$/.test(location.pathname);
  const isSignedIn = Boolean(user);
  const navItems = isSignedIn ? visitorNavItems : guestNavItems;
  const selectedKey =
    navItems?.find((item) => typeof item?.key === 'string' && location.pathname === item.key)?.key?.toString() ||
    (location.pathname.startsWith('/spots') ? '/spots' : '/');

  useEffect(() => {
    let cancelled = false;
    const token = readVisitorToken();
    if (!token) {
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

  const authState = useMemo(
    () => ({
      user,
      loading,
      logout: () => {
        clearVisitorToken();
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
        } ${isGuide ? 'visitor-layout-guide' : ''
        }`}
      >
        {!isSpotDetail ? (
          <Layout.Header className="visitor-header">
            <Link to="/" className="brand-mark" data-cue="[ HOME ]">
              <span className="brand-symbol" aria-hidden="true">
                L
              </span>
              <span className="brand-text">{productCopy.visitorBrandName}</span>
            </Link>
            <Menu className="visitor-menu" mode="horizontal" selectedKeys={[selectedKey]} items={navItems} />
            <div className="visitor-auth-actions">
              {isSignedIn ? (
                <>
                  <span className="visitor-user-label">[ {user?.username} ]</span>
                  <Button onClick={authState.logout}>[ LOG OUT ]</Button>
                </>
              ) : (
                <>
                  <Link to="/login">
                    <Button>[ LOGIN ]</Button>
                  </Link>
                  <Link to="/register">
                    <Button type="primary">[ REGISTER ]</Button>
                  </Link>
                </>
              )}
            </div>
          </Layout.Header>
        ) : null}
        <Layout.Content className="visitor-content">
          <Outlet />
        </Layout.Content>
      </Layout>
    </VisitorAuthContext.Provider>
  );
}
