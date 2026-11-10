import { useEffect, useRef, useState } from 'react';
import {
  AimOutlined,
  EnvironmentFilled,
  GlobalOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { Alert, Button, Modal, Spin, Tag } from 'antd';
import { getAmapRuntimeConfig, type AmapRuntimeConfig } from '../../api/mapsConfig';
import type { GuideLocationAssistStatus } from '../../types/scenic';

export interface BrowserLocation {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  timestamp: number;
}

interface GpsLocationModalProps {
  open: boolean;
  status: GuideLocationAssistStatus;
  location?: BrowserLocation;
  scenicName?: string;
  currentSpotName?: string;
  onClose: () => void;
}

type AMapInstance = {
  add: (items: unknown[]) => void;
  destroy: () => void;
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

export default function GpsLocationModal({
  open,
  status,
  location,
  scenicName,
  currentSpotName,
  onClose,
}: GpsLocationModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mapStatus, setMapStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [configStatus, setConfigStatus] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'error'>('idle');
  const [amapConfig, setAmapConfig] = useState<AmapRuntimeConfig>();

  useEffect(() => {
    if (!open || status !== 'ready' || !location) {
      return undefined;
    }
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
  }, [location, open, status]);

  useEffect(() => {
    if (!open || !location || status !== 'ready' || configStatus !== 'ready' || !amapConfig?.key) {
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
          offset: AMap.Pixel ? new AMap.Pixel(-10, -28) : undefined,
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
        setMapStatus('ready');
      })
      .catch(() => {
        if (!disposed) setMapStatus('error');
      });

    return () => {
      disposed = true;
      mapInstance?.destroy();
    };
  }, [amapConfig?.key, amapConfig?.securityCode, configStatus, location, open, status]);

  const readyLocation = status === 'ready' ? location : undefined;
  const locationReady = Boolean(readyLocation);
  const useAmapMap = Boolean(readyLocation && configStatus === 'ready' && amapConfig?.enabled);
  const mapUrl = location
    ? `https://uri.amap.com/marker?position=${location.longitude},${location.latitude}&name=${encodeURIComponent('当前位置辅助')}`
    : undefined;

  return (
    <Modal
      className="guide-gps-modal"
      title={
        <span className="guide-gps-modal__title">
          <GlobalOutlined />
          GPS 定位辅助
        </span>
      }
      open={open}
      footer={null}
      width={760}
      centered
      zIndex={1400}
      destroyOnClose
      onCancel={onClose}
    >
      <div className="guide-gps-modal__body">
        <Alert
          type="info"
          showIcon
          message="定位辅助只用于对照路线，当前导览站仍以路线面板状态为准。"
        />

        <div className="guide-gps-modal__meta">
          <div>
            <span>景区</span>
            <strong>{scenicName ?? '当前景区'}</strong>
          </div>
          <div>
            <span>当前导览站</span>
            <strong>{currentSpotName ?? '路线状态待同步'}</strong>
          </div>
          <Tag color={locationReady ? 'success' : statusToTagColor(status)}>
            {getStatusLabel(status)}
          </Tag>
        </div>

        {status === 'locating' ? (
          <div className="guide-gps-modal__loading">
            <Spin />
            <span>正在请求浏览器定位权限...</span>
          </div>
        ) : null}

        {readyLocation ? (
          useAmapMap ? (
            <div className="guide-gps-modal__map-shell">
              <div ref={containerRef} className="guide-gps-modal__map" />
              {mapStatus === 'loading' || configStatus === 'loading' ? (
                <div className="guide-gps-modal__map-state">
                  <Spin />
                  <span>{configStatus === 'loading' ? '正在读取地图配置' : '正在加载高德地图'}</span>
                </div>
              ) : null}
              {mapStatus === 'error' ? (
                <div className="guide-gps-modal__map-state guide-gps-modal__map-state--error">
                  <InfoCircleOutlined />
                  <span>高德地图加载失败，下面仍保留浏览器返回的位置数据。</span>
                </div>
              ) : null}
            </div>
          ) : (
            <FallbackMapPreview location={readyLocation} configStatus={configStatus} />
          )
        ) : null}

        {readyLocation ? (
          <div className="guide-gps-modal__details">
            <div>
              <span>经度</span>
              <strong>{readyLocation.longitude.toFixed(6)}</strong>
            </div>
            <div>
              <span>纬度</span>
              <strong>{readyLocation.latitude.toFixed(6)}</strong>
            </div>
            <div>
              <span>浏览器精度</span>
              <strong>
                {readyLocation.accuracyMeters ? `约 ${Math.round(readyLocation.accuracyMeters)} 米` : '未返回'}
              </strong>
            </div>
            <div>
              <span>获取时间</span>
              <strong>{new Date(readyLocation.timestamp).toLocaleTimeString('zh-CN')}</strong>
            </div>
          </div>
        ) : null}

        {status !== 'locating' && !locationReady ? (
          <div className="guide-gps-modal__empty">
            <AimOutlined />
            <strong>{getStatusLabel(status)}</strong>
            <span>{getStatusDescription(status)}</span>
          </div>
        ) : null}

        <div className="guide-gps-modal__footer">
          <span>
            {useAmapMap
              ? '已从后端配置加载高德地图，定位点来自浏览器授权返回。'
              : '在 backend/.env 配好高德 Key 和安全密钥后，这里会显示真实地图底图。'}
          </span>
          {mapUrl && !useAmapMap ? (
            <Button href={mapUrl} target="_blank" rel="noreferrer">
              打开高德坐标
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function FallbackMapPreview({
  location,
  configStatus,
}: {
  location: BrowserLocation;
  configStatus: 'idle' | 'loading' | 'ready' | 'missing' | 'error';
}) {
  const note =
    configStatus === 'loading'
      ? '正在读取后端地图配置，先展示浏览器返回坐标。'
      : configStatus === 'error'
        ? '地图配置接口暂不可用，当前仅展示浏览器返回坐标。'
        : '未检测到完整高德地图配置，当前仅展示浏览器返回坐标。';
  return (
    <div className="guide-gps-modal__fallback-map" aria-label="浏览器定位数据预览">
      <div className="guide-gps-modal__fallback-grid" />
      <div className="guide-gps-modal__fallback-roads">
        <span />
        <span />
        <span />
      </div>
      <div className="guide-gps-modal__fallback-point">
        <span />
        <EnvironmentFilled />
        <strong>当前位置</strong>
      </div>
      <small>
        {note}
        {' '}
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

function getStatusLabel(status: GuideLocationAssistStatus): string {
  if (status === 'locating') return '正在定位';
  if (status === 'ready') return '定位已获取';
  if (status === 'denied') return '定位权限未开启';
  if (status === 'timeout') return '定位请求超时';
  if (status === 'unsupported') return '浏览器不支持定位';
  if (status === 'error') return '定位暂不可用';
  return '定位未开启';
}

function getStatusDescription(status: GuideLocationAssistStatus): string {
  if (status === 'denied') return '请在浏览器地址栏权限设置中允许定位后重试。';
  if (status === 'timeout') return '当前定位请求超时，可以换到网络更稳定的位置再试一次。';
  if (status === 'unsupported') return '当前浏览器不支持地理定位能力，路线导览仍可正常使用。';
  if (status === 'error') return '浏览器未能返回定位结果，路线导览仍可正常使用。';
  return '点击路线面板右侧的获取定位后，这里会显示定位地图。';
}

function statusToTagColor(status: GuideLocationAssistStatus): string {
  if (status === 'denied' || status === 'timeout' || status === 'unsupported' || status === 'error') {
    return 'warning';
  }
  if (status === 'locating') return 'processing';
  return 'default';
}
