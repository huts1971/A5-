import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
  RocketOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Select,
  Space,
  Spin,
  Typography,
  message,
} from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  addRouteDraftSpot,
  deleteRouteDraftSpot,
  getRouteDraft,
  reorderRouteDraftSpots,
  scopeRouteDraft,
  undoRouteDraft,
} from '../../api/routeDrafts';
import {
  getMapIdForSpotIds,
  getScenicMap,
  type ScenicMapId,
} from '../../api/maps';
import { getSpots } from '../../api/spots';
import { createTour } from '../../api/tours';
import { isApiError } from '../../api/client';
import ScenicPointMap from '../../components/scenic/ScenicPointMap';
import useScenicRoutePath from '../../hooks/useScenicRoutePath';
import type { RouteDraft, ScenicMap, ScenicSpot } from '../../types/scenic';
import styles from './RouteDraftPage.module.css';

const mapOptions: Array<{ id: ScenicMapId; label: string }> = [
  { id: 'ling-shan', label: '灵山胜境' },
  { id: 'nianhua-bay', label: '拈花湾' },
];

export default function RouteDraftPage() {
  const { draftId = '' } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<RouteDraft>();
  const [maps, setMaps] = useState<Partial<Record<ScenicMapId, ScenicMap>>>({});
  const [activeMapId, setActiveMapId] = useState<ScenicMapId>('ling-shan');
  const [spots, setSpots] = useState<ScenicSpot[]>([]);
  const [activeSpotId, setActiveSpotId] = useState('');
  const [selectedSpotId, setSelectedSpotId] = useState<string>();
  const [insertPosition, setInsertPosition] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([getRouteDraft(draftId), getSpots()])
      .then(([draftResult, spotResult]) => {
        if (!active) return;
        setDraft(draftResult);
        setSpots(spotResult);
        setActiveMapId(
          getMapIdForSpotIds(draftResult.spots.map((spot) => spot.spotId)),
        );
        setActiveSpotId(draftResult.spots[0]?.spotId ?? '');
        setInsertPosition(draftResult.spots.length);
      })
      .catch(() => active && setError('路线草稿加载失败。'));
    return () => {
      active = false;
    };
  }, [draftId]);

  useEffect(() => {
    let active = true;
    Promise.all([getScenicMap('ling-shan'), getScenicMap('nianhua-bay')]).then(
      ([lingShanMap, nianhuaBayMap]) => {
        if (!active) return;
        setMaps({
          'ling-shan': lingShanMap,
          'nianhua-bay': nianhuaBayMap,
        });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const map = maps[activeMapId];
  const currentMapSpotIds = useMemo(
    () => new Set(map?.points.map((point) => point.spotId) ?? []),
    [map],
  );

  const unusedSpots = useMemo(() => {
    const used = new Set(draft?.spots.map((spot) => spot.spotId) ?? []);
    return spots.filter(
      (spot) => currentMapSpotIds.has(spot.id) && !used.has(spot.id),
    );
  }, [currentMapSpotIds, draft?.spots, spots]);
  const currentMapDraftSpots = useMemo(
    () =>
      draft?.spots.filter((spot) => currentMapSpotIds.has(spot.spotId)) ?? [],
    [currentMapSpotIds, draft?.spots],
  );
  const currentMapTiming = useMemo(() => {
    const stayMinutes = currentMapDraftSpots.reduce(
      (total, spot) => total + spot.stayMinutes,
      0,
    );
    const estimatedWalkMinutes = currentMapDraftSpots.reduce(
      (total, spot, index) =>
        total + (index === 0 ? 0 : (spot.transitionMinutes ?? 0)),
      0,
    );
    const timeDataComplete = currentMapDraftSpots.every(
      (spot, index) => index === 0 || spot.transitionMinutes != null,
    );
    return {
      stayMinutes,
      estimatedWalkMinutes,
      totalMinutes: stayMinutes + estimatedWalkMinutes,
      timeDataComplete,
    };
  }, [currentMapDraftSpots]);
  const mappedSpotIds = useMemo(
    () =>
      new Set(
        Object.values(maps).flatMap((scenicMap) =>
          scenicMap ? scenicMap.points.map((point) => point.spotId) : [],
        ),
      ),
    [maps],
  );
  const currentMapRouteSpotIds = useMemo(
    () => currentMapDraftSpots.map((spot) => spot.spotId),
    [currentMapDraftSpots],
  );
  const routePath = useScenicRoutePath(
    activeMapId,
    currentMapRouteSpotIds,
    draft?.routingProfile ?? 'fastest',
  );

  useEffect(() => {
    setSelectedSpotId(undefined);
    setInsertPosition(currentMapDraftSpots.length);
  }, [activeMapId, currentMapDraftSpots.length]);

  useEffect(() => {
    if (!map) return;
    if (currentMapSpotIds.has(activeSpotId)) return;
    const firstRouteSpotOnMap = draft?.spots.find((spot) =>
      currentMapSpotIds.has(spot.spotId),
    );
    setActiveSpotId(firstRouteSpotOnMap?.spotId ?? map.points[0]?.spotId ?? '');
  }, [activeSpotId, currentMapSpotIds, draft?.spots, map]);

  const activateRouteSpot = (spotId: string) => {
    const destinationMapId: ScenicMapId = spotId.startsWith('spot_nh_')
      ? 'nianhua-bay'
      : 'ling-shan';
    setActiveMapId(destinationMapId);
    setActiveSpotId(spotId);
  };

  const applyDraft = (
    next: RouteDraft,
    scopedMapId: ScenicMapId = activeMapId,
  ) => {
    setDraft(next);
    const currentAreaSpotCount = next.spots.filter((spot) =>
      scopedMapId === 'nianhua-bay'
        ? spot.spotId.startsWith('spot_nh_')
        : !spot.spotId.startsWith('spot_nh_'),
    ).length;
    setInsertPosition(Math.min(insertPosition, currentAreaSpotCount));
    if (!next.spots.some((spot) => spot.spotId === activeSpotId)) {
      setActiveSpotId(next.spots[0]?.spotId ?? '');
    }
  };

  const switchMap = async (nextMapId: ScenicMapId) => {
    if (!draft || nextMapId === activeMapId) return;
    const previousMapId = activeMapId;
    const nextAreaSpots = draft.spots.filter((spot) =>
      nextMapId === 'nianhua-bay'
        ? spot.spotId.startsWith('spot_nh_')
        : !spot.spotId.startsWith('spot_nh_'),
    );
    setActiveMapId(nextMapId);
    if (nextAreaSpots.length === 0 || nextAreaSpots.length === draft.spots.length) {
      return;
    }
    setBusy(true);
    try {
      applyDraft(await scopeRouteDraft(draft.id, nextMapId), nextMapId);
      message.success(
        `已切换为${nextMapId === 'nianhua-bay' ? '拈花湾' : '灵山胜境'}独立路线`,
      );
    } catch {
      setActiveMapId(previousMapId);
      message.error('切换景区路线失败。');
    } finally {
      setBusy(false);
    }
  };

  const addSpot = async () => {
    if (!draft || !selectedSpotId) return;
    setBusy(true);
    try {
      applyDraft(
        await addRouteDraftSpot(draft.id, {
          spotId: selectedSpotId,
          position: insertPosition,
          allowBudgetExceeded: true,
          replaceOtherArea: true,
        }),
        activeMapId,
      );
      setSelectedSpotId(undefined);
    } catch {
      message.error('添加景点失败。');
    } finally {
      setBusy(false);
    }
  };

  const reorder = async (index: number, offset: number) => {
    if (!draft) return;
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= currentMapDraftSpots.length) return;
    const ids = draft.spots.map((spot) => spot.spotId);
    const currentSpotId = currentMapDraftSpots[index].spotId;
    const nextSpotId = currentMapDraftSpots[nextIndex].spotId;
    const currentGlobalIndex = ids.indexOf(currentSpotId);
    const nextGlobalIndex = ids.indexOf(nextSpotId);
    [ids[currentGlobalIndex], ids[nextGlobalIndex]] = [
      ids[nextGlobalIndex],
      ids[currentGlobalIndex],
    ];
    setBusy(true);
    try {
      applyDraft(await reorderRouteDraftSpots(draft.id, ids, true));
    } catch {
      message.error('路线排序失败。');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (spotId: string) => {
    if (!draft) return;
    setBusy(true);
    try {
      applyDraft(await deleteRouteDraftSpot(draft.id, spotId));
    } catch (requestError) {
      message.error(
        isApiError(requestError) && requestError.code === 'DRAFT_MINIMUM_SPOTS'
          ? '路线至少保留一个景点。'
          : '删除景点失败。',
      );
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      applyDraft(await undoRouteDraft(draft.id));
    } catch {
      message.info('没有可撤销的操作。');
    } finally {
      setBusy(false);
    }
  };

  const startTour = async () => {
    if (!draft) return;
    if (currentMapDraftSpots.length === 0) {
      message.info('请先为当前景区添加至少一个景点。');
      return;
    }
    setBusy(true);
    try {
      const scopedDraft =
        currentMapDraftSpots.length === draft.spots.length
          ? draft
          : await scopeRouteDraft(draft.id, activeMapId);
      applyDraft(scopedDraft, activeMapId);
      const tour = await createTour(scopedDraft.id, activeMapId);
      navigate(`/tour/${tour.id}`);
    } catch {
      message.error('开始游览失败，请稍后重试。');
      setBusy(false);
    }
  };

  if (error) {
    return <Alert type="error" showIcon message={error} />;
  }
  if (!draft || !map || !maps['ling-shan'] || !maps['nianhua-bay']) {
    return <Spin size="large" tip="正在加载路线草稿" />;
  }

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <Typography.Text className="mono-label">[ ROUTE DRAFT ]</Typography.Text>
          <Typography.Title level={1}>{draft.name}</Typography.Title>
        </div>
        <Space wrap>
          <Link to="/routes">
            <Button>返回推荐</Button>
          </Link>
          <Button
            icon={<UndoOutlined />}
            data-testid="undo-route-draft"
            disabled={draft.revisionCount === 0}
            loading={busy}
            onClick={undo}
          >
            撤销最近操作
          </Button>
          <Button
            type="primary"
            icon={<RocketOutlined />}
            data-testid="start-tour"
            loading={busy}
            onClick={startTour}
          >
            开始游览
          </Button>
        </Space>
      </header>

      {currentMapTiming.totalMinutes > draft.durationBudget ? (
        <Alert
          type="warning"
          showIcon
          message={`当前景区路线预计 ${currentMapTiming.totalMinutes} 分钟，超过 ${draft.durationBudget} 分钟预算`}
        />
      ) : null}
      {!currentMapTiming.timeDataComplete && currentMapDraftSpots.length > 1 ? (
        <Alert
          type="info"
          showIcon
          message="部分相邻景点的步行时间尚未维护"
          description="当前只显示已知时长，不会根据地图直线距离伪造步行时间。"
        />
      ) : null}

      <div className={styles.workspace}>
        <section className={styles.mapPanel}>
          <div className={styles.mapHeader}>
            <strong>{map.name}</strong>
            <div className={styles.mapSwitcher} role="tablist" aria-label="切换景区地图">
              {mapOptions.map((option) => {
                const selected = option.id === activeMapId;
                return (
                  <button
                    key={option.id}
                    className={[
                      styles.mapSwitch,
                      selected ? styles.mapSwitchActive : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    disabled={busy}
                    onClick={() => switchMap(option.id)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <ScenicPointMap
            map={map}
            routeSpotIds={currentMapRouteSpotIds}
            routePath={routePath}
            activeSpotId={activeSpotId}
            onSpotActivate={setActiveSpotId}
            onSpotPreview={setActiveSpotId}
          />
        </section>

        <section className={styles.editor}>
          <Card title="添加景点">
            <div className={styles.addRow}>
              <Select
                showSearch
                className={styles.darkSelect}
                popupClassName={styles.darkSelectPopup}
                value={selectedSpotId}
                placeholder={`选择${activeMapId === 'ling-shan' ? '灵山胜境' : '拈花湾'}景点`}
                optionFilterProp="label"
                options={unusedSpots.map((spot) => ({
                  value: spot.id,
                  label: `${spot.name} · 约 ${spot.durationMinutes} 分钟`,
                }))}
                onChange={setSelectedSpotId}
              />
              <Select
                className={styles.darkSelect}
                popupClassName={styles.darkSelectPopup}
                value={insertPosition}
                options={Array.from(
                  { length: currentMapDraftSpots.length + 1 },
                  (_, index) => ({
                  value: index,
                  label:
                    index === currentMapDraftSpots.length
                      ? '放在当前景区路线末尾'
                      : `插入到当前景区第 ${index + 1} 站`,
                  }),
                )}
                onChange={setInsertPosition}
              />
              <Button
                type="primary"
                icon={<PlusOutlined />}
                data-testid="add-draft-spot"
                disabled={!selectedSpotId}
                loading={busy}
                onClick={addSpot}
              >
                加入
              </Button>
            </div>
          </Card>

          <div className={styles.spotList}>
            {currentMapDraftSpots.length === 0 ? (
              <div className={styles.emptyRoute}>
                当前{activeMapId === 'ling-shan' ? '灵山胜境' : '拈花湾'}路线暂无景点，
                请从上方选择景点加入。
              </div>
            ) : null}
            {currentMapDraftSpots.map((spot, index) => (
              <article
                key={spot.spotId}
                className={[
                  styles.spotRow,
                  activeSpotId === spot.spotId ? styles.spotRowActive : '',
                ].filter(Boolean).join(' ')}
                onMouseEnter={() => {
                  if (currentMapSpotIds.has(spot.spotId)) {
                    setActiveSpotId(spot.spotId);
                  }
                }}
              >
                <button
                  className={styles.spotMain}
                  type="button"
                  onClick={() => activateRouteSpot(spot.spotId)}
                >
                  <span className={styles.sequence}>{String(index + 1).padStart(2, '0')}</span>
                  <span>
                    <strong>{spot.name}</strong>
                    <small>
                      {index === 0
                        ? '路线起点'
                        : spot.transitionMinutes == null
                          ? '上一站时间待补充'
                          : `上一站至此约 ${spot.transitionMinutes} 分钟`}
                      {' · '}停留 {spot.stayMinutes} 分钟
                    </small>
                    {!mappedSpotIds.has(spot.spotId) ? (
                      <small className={styles.missingPoint}>地图点位待补充</small>
                    ) : null}
                  </span>
                </button>
                <Space size={4}>
                  <Button
                    aria-label={`上移${spot.name}`}
                    icon={<ArrowUpOutlined />}
                    disabled={index === 0 || busy}
                    onClick={() => reorder(index, -1)}
                  />
                  <Button
                    aria-label={`下移${spot.name}`}
                    icon={<ArrowDownOutlined />}
                    disabled={index === currentMapDraftSpots.length - 1 || busy}
                    onClick={() => reorder(index, 1)}
                  />
                  <Button
                    danger
                    aria-label={`删除${spot.name}`}
                    icon={<DeleteOutlined />}
                    disabled={draft.spots.length <= 1 || busy}
                    onClick={() => remove(spot.spotId)}
                  />
                </Space>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
