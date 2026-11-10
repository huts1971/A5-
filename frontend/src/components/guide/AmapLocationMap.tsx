import { useEffect, useRef, useState } from 'react';
import { AimOutlined, EnvironmentFilled, InfoCircleOutlined } from '@ant-design/icons';
import { Spin } from 'antd';
import { getAmapRuntimeConfig, type AmapRuntimeConfig } from '../../api/mapsConfig';

export interface BrowserLocation {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  timestamp: number;
}

interface AmapLocationMapProps {
  location: BrowserLocation;
  scenicName?: string;
  currentSpotName?: string;
  className?: string;
}

type AMapInstance = {
  add: (items: unknown[]) => void;
  destroy: () => void;
  resize?: () => void;
  setFitView?: (overlays?: unknown[]) => void;
};

type AMapRuntime = {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapInstance;
  Marker: new (options: Record<string, unknown>) => unknown;
  Circle: new (options: Record<string, unknown>) => unknown;
  Pixel?: new (x: number, y: number) => unknown;
};

type AMapWindow = Window & {
  AMap?: AMapRuntime;
  __guideAmapLoading?: Promise<AMapRuntime>;
  _AMapSecurityConfig?: {
    securityJsCode?: string;
  };
};

export default function AmapLocationMap({
  location,
  className = '',
}: AmapLocationMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mapStatus, setMapStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [configStatus, setConfigStatus] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'error'>('idle');
  const [amapConfig, setAmapConfig] = useState<AmapRuntimeConfig>();

  useEffect(() => {
    let disposed = false;
    setConfigStatus('loading');
    getAmapRuntimeConfig()
      .then((config) => {
        if (disposed) return;
        setAmapConfig(config);
        setConfigStatus(config.enabled ? 'ready' : 'missing');
      })
      .catch(() => {
        if (!disposed) setConfigStatus('error');
      });
    return () => {
      disposed = true;
    };
  }, [location.latitude, location.longitude]);

  useEffect(() => {
    if (configStatus !== 'ready' || !amapConfig?.key) {
      setMapStatus('idle');
      return undefined;
    }

    let disposed = false;
    let mapInstance: AMapInstance | undefined;
    setMapStatus('loading');

    loadAmapSdk(amapConfig.key, amapConfig.securityCode)
      .then((AMap) => {
        if (disposed || !containerRef.current) return;
        const position = [location.longitude, location.latitude];
        mapInstance = new AMap.Map(containerRef.current, {
          center: position,
          zoom: 17,
          resizeEnable: true,
          viewMode: '2D',
        });
        const marker = new AMap.Marker({
          position,
          title: '当前位置辅助',
          anchor: 'bottom-center',
          offset: AMap.Pixel ? new AMap.Pixel(0, 0) : undefined,
        });
        const circle = new AMap.Circle({
          center: position,
          radius: Math.max(location.accuracyMeters ?? 35, 20),
          strokeColor: '#16776f',
          strokeOpacity: 0.82,
          strokeWeight: 2,
          fillColor: '#2bb6a8',
          fillOpacity: 0.16,
        });
        mapInstance.add([circle, marker]);
        mapInstance.setFitView?.([circle, marker]);
        window.setTimeout(() => mapInstance?.resize?.(), 80);
        setMapStatus('ready');
      })
      .catch(() => {
        if (!disposed) setMapStatus('error');
      });

    return () => {
      disposed = true;
      mapInstance?.destroy();
    };
  }, [
    amapConfig?.key,
    amapConfig?.securityCode,
    configStatus,
    location.accuracyMeters,
    location.latitude,
    location.longitude,
  ]);

  const useAmapMap = configStatus === 'ready' && Boolean(amapConfig?.enabled);
  const showLoading = configStatus === 'loading' || mapStatus === 'loading';
  const showError = configStatus === 'error' || mapStatus === 'error' || configStatus === 'missing';

  return (
    <div className={`guide-amap-location ${className}`}>
      {useAmapMap ? (
        <div ref={containerRef} className="guide-amap-location__map" />
      ) : (
        <FallbackLocationPreview location={location} />
      )}

      <div className="guide-amap-location__badge">
        <EnvironmentFilled />
        <div>
          <strong>定位辅助视图</strong>
        </div>
      </div>

      {showLoading ? (
        <div className="guide-amap-location__state">
          <Spin />
          <span>{configStatus === 'loading' ? '正在读取地图配置' : '正在加载高德地图'}</span>
        </div>
      ) : null}

      {showError ? (
        <div className="guide-amap-location__state guide-amap-location__state--error">
          <InfoCircleOutlined />
          <span>
            {configStatus === 'missing'
              ? '高德地图配置未完整启用，当前展示定位辅助预览。'
              : '高德地图暂时不可用，当前展示定位辅助预览。'}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function FallbackLocationPreview({ location }: { location: BrowserLocation }) {
  return (
    <div className="guide-amap-location__fallback" aria-label="定位辅助预览">
      <div className="guide-amap-location__fallback-grid" />
      <div className="guide-amap-location__fallback-point">
        <span />
        <AimOutlined />
        <strong>当前位置</strong>
      </div>
      <small>
        {location.longitude.toFixed(5)}, {location.latitude.toFixed(5)}
      </small>
    </div>
  );
}

function loadAmapSdk(amapKey: string, amapSecurityCode: string): Promise<AMapRuntime> {
  const amapWindow = window as AMapWindow;
  if (amapWindow.AMap) {
    return Promise.resolve(amapWindow.AMap);
  }
  if (amapWindow.__guideAmapLoading) {
    return amapWindow.__guideAmapLoading;
  }
  if (amapSecurityCode) {
    amapWindow._AMapSecurityConfig = {
      ...(amapWindow._AMapSecurityConfig ?? {}),
      securityJsCode: amapSecurityCode,
    };
  }
  amapWindow.__guideAmapLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(amapKey)}`;
    script.async = true;
    script.onload = () => {
      if (amapWindow.AMap) {
        resolve(amapWindow.AMap);
      } else {
        reject(new Error('amap_missing_runtime'));
      }
    };
    script.onerror = () => reject(new Error('amap_load_failed'));
    document.head.appendChild(script);
  });
  return amapWindow.__guideAmapLoading;
}
