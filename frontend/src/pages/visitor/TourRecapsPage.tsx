import {
  ArrowRightOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import { Button, Tag } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { isApiError } from '../../api/client';
import { fallbackSpotImage, resolveSpotImage } from '../../api/spotImages';
import { getSpots } from '../../api/spots';
import { getTour } from '../../api/tours';
import type { ScenicSpot, TourHistoryEntry, TourSession } from '../../types/scenic';
import {
  loadTourHistory,
  loadTourRecovery,
  removeTourHistoryEntry,
} from '../../utils/tourRecovery';
import styles from './TourRecapsPage.module.css';

type RecordAvailability = 'ready' | 'checking' | 'expired' | 'unavailable';

interface TourHistoryRecord {
  entry: TourHistoryEntry;
  tour?: TourSession;
  availability: RecordAvailability;
}

const isEntranceSpot = (spotId: string) => spotId.endsWith('_entrance');

function toLocalRecord(entry: TourHistoryEntry): TourHistoryRecord {
  const tour = loadTourRecovery(entry.tourId);
  return {
    entry,
    tour,
    availability: tour ? 'ready' : 'checking',
  };
}

function formatDateTime(value?: string) {
  if (!value) return '时间待补充';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间待补充';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatElapsedMinutes(entry: TourHistoryEntry, tour?: TourSession) {
  const startedAt = new Date(tour?.startedAt ?? entry.startedAt).getTime();
  const endedAt = new Date(
    tour?.finishedAt ?? entry.finishedAt ?? tour?.updatedAt ?? entry.updatedAt,
  ).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
    return undefined;
  }
  return Math.max(1, Math.ceil((endedAt - startedAt) / 60_000));
}

function formalSpots(tour?: TourSession) {
  return tour?.spots.filter((spot) => !isEntranceSpot(spot.spotId)) ?? [];
}

function resolveCoverSpotId(record: TourHistoryRecord) {
  if (record.entry.coverSpotId && !isEntranceSpot(record.entry.coverSpotId)) {
    return record.entry.coverSpotId;
  }
  const spots = formalSpots(record.tour);
  return (
    spots.find((spot) => spot.status === 'completed')?.spotId ??
    spots.find((spot) => spot.status === 'current')?.spotId ??
    spots[0]?.spotId
  );
}

function coverImageFor(
  record: TourHistoryRecord,
  spotsById: ReadonlyMap<string, ScenicSpot>,
) {
  const coverSpotId = resolveCoverSpotId(record);
  if (!coverSpotId) return fallbackSpotImage;
  return spotsById.get(coverSpotId)?.imageUrl ?? resolveSpotImage(coverSpotId);
}

function HistoryStatus({ record }: { record: TourHistoryRecord }) {
  if (record.availability === 'checking') {
    return <Tag className={styles.statusTag}>正在核验</Tag>;
  }
  if (record.availability === 'expired') {
    return <Tag className={styles.expiredTag}>记录已失效</Tag>;
  }
  if (record.availability === 'unavailable') {
    return <Tag className={styles.statusTag}>暂时无法读取</Tag>;
  }
  return record.entry.status === 'finished' ? (
    <Tag className={styles.finishedTag}>已完成</Tag>
  ) : (
    <Tag className={styles.activeTag}>进行中</Tag>
  );
}

export default function TourRecapsPage() {
  const [records, setRecords] = useState<TourHistoryRecord[]>(() =>
    loadTourHistory().map(toLocalRecord),
  );
  const [spots, setSpots] = useState<ScenicSpot[]>([]);

  useEffect(() => {
    let cancelled = false;

    getSpots()
      .then((items) => {
        if (!cancelled) setSpots(items);
      })
      .catch(() => {
        if (!cancelled) setSpots([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const missingTourIds = records
      .filter((record) => record.availability === 'checking')
      .map((record) => record.entry.tourId);
    if (missingTourIds.length === 0) return undefined;

    let cancelled = false;
    Promise.all(
      missingTourIds.map(async (tourId) => {
        try {
          return { tourId, tour: await getTour(tourId), availability: 'ready' as const };
        } catch (error) {
          return {
            tourId,
            tour: undefined,
            availability: isApiError(error) && error.status === 404
              ? ('expired' as const)
              : ('unavailable' as const),
          };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const resultByTourId = new Map(results.map((result) => [result.tourId, result]));
      setRecords((current) =>
        current.map((record) => {
          const result = resultByTourId.get(record.entry.tourId);
          return result
            ? {
                ...record,
                tour: result.tour,
                availability: result.availability,
              }
            : record;
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [records]);

  const spotsById = useMemo(
    () => new Map(spots.map((spot) => [spot.id, spot])),
    [spots],
  );
  const latestCompleted = records.find(
    (record) => record.entry.status === 'finished' && record.availability === 'ready',
  );
  const activeRecords = records.filter((record) => record.entry.status === 'active');
  const compactRecords = records.filter(
    (record) =>
      record.entry.status === 'finished' &&
      record.entry.tourId !== latestCompleted?.entry.tourId,
  );

  const handleRemove = (tourId: string) => {
    removeTourHistoryEntry(tourId);
    setRecords(loadTourHistory().map(toLocalRecord));
  };

  const handleImageError = (event: SyntheticEvent<HTMLImageElement>) => {
    if (!event.currentTarget.src.endsWith(fallbackSpotImage)) {
      event.currentTarget.src = fallbackSpotImage;
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>
            <HistoryOutlined aria-hidden />
            个人旅迹
          </span>
          <h1>你的游览回顾</h1>
        </div>
      </header>

      {activeRecords.length > 0 ? (
        <section className={styles.activeSection} aria-labelledby="active-tour-heading">
          <div className={styles.sectionHeading}>
            <div>
              <span>仍在路上</span>
              <h2 id="active-tour-heading">继续未完成的场景导览</h2>
            </div>
          </div>
          <div className={styles.activeList}>
            {activeRecords.map((record) => {
              const spotsInTour = formalSpots(record.tour);
              const completedCount = spotsInTour.filter(
                (spot) => spot.status === 'completed',
              ).length;
              return (
                <article className={styles.activeRecord} key={record.entry.tourId}>
                  <img
                    src={coverImageFor(record, spotsById)}
                    alt=""
                    onError={handleImageError}
                  />
                  <div className={styles.activeCopy}>
                    <HistoryStatus record={record} />
                    <h3>{record.entry.name}</h3>
                    <p>
                      已走过 {completedCount} / {spotsInTour.length || '—'} 个景点
                      <span aria-hidden> · </span>
                      {formatDateTime(record.entry.updatedAt)}
                    </p>
                  </div>
                  {record.availability === 'expired' ? (
                    <Button
                      icon={<DeleteOutlined />}
                      onClick={() => handleRemove(record.entry.tourId)}
                    >
                      移除记录
                    </Button>
                  ) : record.availability === 'ready' ? (
                    <Link to={`/scene-guide?tourId=${encodeURIComponent(record.entry.tourId)}`}>
                      <Button type="primary" icon={<PlayCircleOutlined />}>
                        继续场景导览
                      </Button>
                    </Link>
                  ) : (
                    <Button disabled>暂不可用</Button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {latestCompleted ? (
        <section aria-labelledby="latest-recap-heading">
          <div className={styles.sectionHeading}>
            <div>
              <span>最近完成</span>
              <h2 id="latest-recap-heading">刚刚走过的这一程</h2>
            </div>
            <time dateTime={latestCompleted.entry.finishedAt ?? latestCompleted.entry.updatedAt}>
              {formatDateTime(
                latestCompleted.entry.finishedAt ?? latestCompleted.entry.updatedAt,
              )}
            </time>
          </div>
          <article className={styles.latestHero}>
            <img
              src={coverImageFor(latestCompleted, spotsById)}
              alt={`${latestCompleted.entry.name}代表景点`}
              onError={handleImageError}
            />
            <div className={styles.latestContent}>
              <HistoryStatus record={latestCompleted} />
              <h3>{latestCompleted.entry.name}</h3>
              <div className={styles.latestMeta}>
                <span>
                  <EnvironmentOutlined aria-hidden />
                  {formalSpots(latestCompleted.tour).filter(
                    (spot) => spot.status === 'completed',
                  ).length}{' '}
                  个景点
                </span>
                <span>
                  <ClockCircleOutlined aria-hidden />
                  {formatElapsedMinutes(latestCompleted.entry, latestCompleted.tour) ?? '—'} 分钟
                </span>
              </div>
              <Link
                to={`/tour/${encodeURIComponent(latestCompleted.entry.tourId)}/recap`}
              >
                <Button type="primary" className={styles.latestAction}>
                  打开这份旅行纪录
                  <ArrowRightOutlined />
                </Button>
              </Link>
            </div>
          </article>
        </section>
      ) : null}

      {compactRecords.length > 0 ? (
        <section aria-labelledby="history-heading">
          <div className={styles.sectionHeading}>
            <div>
              <span>过往旅迹</span>
              <h2 id="history-heading">最近的游览记录</h2>
            </div>
          </div>
          <div className={styles.historyList}>
            {compactRecords.map((record) => (
              <article className={styles.historyRecord} key={record.entry.tourId}>
                <img
                  src={coverImageFor(record, spotsById)}
                  alt=""
                  onError={handleImageError}
                />
                <div className={styles.historyCopy}>
                  <div>
                    <HistoryStatus record={record} />
                    <time dateTime={record.entry.finishedAt ?? record.entry.updatedAt}>
                      {formatDateTime(record.entry.finishedAt ?? record.entry.updatedAt)}
                    </time>
                  </div>
                  <h3>{record.entry.name}</h3>
                  <p>
                    {formalSpots(record.tour).filter(
                      (spot) => spot.status === 'completed',
                    ).length || '—'}{' '}
                    个景点
                    <span aria-hidden> · </span>
                    {formatElapsedMinutes(record.entry, record.tour) ?? '—'} 分钟
                  </p>
                </div>
                {record.availability === 'expired' ? (
                  <Button
                    danger
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={() => handleRemove(record.entry.tourId)}
                  >
                    移除
                  </Button>
                ) : record.availability === 'ready' ? (
                  <Link to={`/tour/${encodeURIComponent(record.entry.tourId)}/recap`}>
                    <Button type="text">
                      查看回顾
                      <ArrowRightOutlined />
                    </Button>
                  </Link>
                ) : (
                  <Button type="text" disabled>
                    暂不可用
                  </Button>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {records.length === 0 ? (
        <section className={styles.emptyState} aria-labelledby="empty-recap-heading">
          <div className={styles.emptyVisual} aria-hidden>
            <HistoryOutlined />
            <span>01</span>
          </div>
          <div className={styles.emptyCopy}>
            <span>第一段旅迹，还在等你出发</span>
            <h2 id="empty-recap-heading">完成一次场景导览，这里就会生成你的个人旅行纪录。</h2>
            <p>
              Demo 会依据路线与游览事件整理景点、时长和运动估算，不使用 GPS，也不会声称是实测数据。
            </p>
            <div className={styles.emptyActions}>
              <Link to="/routes">
                <Button type="primary" icon={<PlayCircleOutlined />}>
                  开始一次场景导览
                </Button>
              </Link>
              <div className={styles.demoEntry}>
                <Tag>示例数据</Tag>
                <Link to="/tour/demo-v1/recap?demo=1">
                  <Button>
                    查看示例回顾 · 示例数据
                    <ArrowRightOutlined />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
