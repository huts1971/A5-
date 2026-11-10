import {
  ArrowRightOutlined,
  BookOutlined,
  CameraOutlined,
  EnvironmentOutlined,
  HistoryOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import { Alert, Button, Spin, Tag } from 'antd';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  getMapIdForSpotIds,
} from '../../api/maps';
import {
  fallbackSpotImage,
  resolveSpotImage,
} from '../../api/spotImages';
import { getSpots } from '../../api/spots';
import { getTourRecap } from '../../api/tours';
import type {
  ScenicSpot,
  TourRecap,
  TourRecapMovement,
  TourSession,
} from '../../types/scenic';
import {
  writeTourRecapJournalHandoff,
  writeTourRecapPhotoHandoff,
} from '../../utils/tourRecapHandoff';
import { loadTourRecovery } from '../../utils/tourRecovery';
import styles from './TourRecapPage.module.css';

const entranceSpotIds = new Set(['spot_ls_entrance', 'spot_nh_entrance']);

function isEntranceSpot(spotId: string, name?: string) {
  return entranceSpotIds.has(spotId) || name?.trim() === '景区入口';
}

function roundTo(value: number, unit: number) {
  return Math.round(value / unit) * unit;
}

function localMovement(tour: TourSession): TourRecapMovement {
  const progressed = tour.spots.filter(
    (spot) =>
      !isEntranceSpot(spot.spotId, spot.name) &&
      (spot.status === 'completed' || spot.status === 'skipped'),
  );
  const knownSegments = progressed.filter(
    (spot) =>
      typeof spot.transitionMinutes === 'number' &&
      Number.isFinite(spot.transitionMinutes),
  );
  const coverageRatio = progressed.length
    ? knownSegments.length / progressed.length
    : 0;
  const confidence =
    progressed.length > 0 && coverageRatio >= 0.999
      ? 'medium'
      : coverageRatio >= 0.6
        ? 'low'
        : 'unavailable';
  const estimatedWalkingMinutes = knownSegments.reduce(
    (total, spot) => total + Math.max(0, spot.transitionMinutes ?? 0),
    0,
  );
  const available = confidence !== 'unavailable';
  const estimatedDistanceMeters = estimatedWalkingMinutes * 70;

  return {
    estimatedWalkingMinutes: available
      ? estimatedWalkingMinutes
      : undefined,
    plannedScenicMinutes: available
      ? progressed
          .filter((spot) => spot.status === 'completed')
          .reduce((total, spot) => total + spot.stayMinutes, 0)
      : undefined,
    estimatedDistanceMeters: available
      ? estimatedDistanceMeters
      : undefined,
    estimatedSteps: available
      ? roundTo(estimatedDistanceMeters / 0.7, 100)
      : undefined,
    estimatedCaloriesKcal: available
      ? roundTo(
          (3.3 * 3.5 * 60 * estimatedWalkingMinutes) / 200,
          5,
        )
      : undefined,
    coverageRatio,
    confidence,
    formulaVersion: 'demo-v1',
  };
}

function buildLocalRecap(tour: TourSession): TourRecap {
  const visibleSpots = tour.spots.filter(
    (spot) => !isEntranceSpot(spot.spotId, spot.name),
  );
  const actualOrder = visibleSpots
    .filter(
      (spot) => spot.status === 'completed' || spot.status === 'skipped',
    )
    .map((spot) => ({
      spotId: spot.spotId,
      name: spot.name,
      result: spot.status as 'completed' | 'skipped',
      occurredAt: spot.completedAt ?? tour.updatedAt,
      plannedStayMinutes: spot.stayMinutes,
      transitionMinutes: spot.transitionMinutes,
    }));
  const end = new Date(tour.finishedAt ?? tour.updatedAt).getTime();
  const start = new Date(tour.startedAt).getTime();
  const mapId = getMapIdForSpotIds(
    visibleSpots.map((spot) => spot.spotId),
  );

  return {
    id: tour.id,
    name: tour.name,
    status: tour.status,
    mapId,
    startedAt: tour.startedAt,
    finishedAt: tour.finishedAt,
    elapsedMinutes: Math.max(0, Math.ceil((end - start) / 60000)),
    completedCount: actualOrder.filter(
      (spot) => spot.result === 'completed',
    ).length,
    skippedCount: actualOrder.filter((spot) => spot.result === 'skipped')
      .length,
    adjustmentCount: 0,
    deviationCount: 0,
    recommendedOrder: visibleSpots.map((spot) => spot.name),
    preferenceProfile: { mapId },
    actualOrder,
    aiTopics: [],
    movement: localMovement(tour),
  };
}

function buildDemoRecap(): TourRecap {
  const startedAt = '2026-07-30T09:12:00+08:00';
  const actualOrder: TourRecap['actualOrder'] = [
    ['spot_ls_003', '佛足坛', 'completed', '2026-07-30T09:24:00+08:00', 10, 12],
    ['spot_ls_004', '五智门', 'completed', '2026-07-30T09:43:00+08:00', 10, 9],
    ['spot_five_mudra_mandala', '五印坛城', 'completed', '2026-07-30T10:14:00+08:00', 20, 11],
    ['spot_ls_015', '曼飞龙塔', 'skipped', '2026-07-30T10:26:00+08:00', 15, 6],
    ['spot_ls_008', '阿育王柱', 'completed', '2026-07-30T10:51:00+08:00', 10, 5],
    ['spot_xiangfu_temple', '祥符禅寺', 'completed', '2026-07-30T11:18:00+08:00', 20, 0],
  ].map(
    ([
      spotId,
      name,
      result,
      occurredAt,
      plannedStayMinutes,
      transitionMinutes,
    ]) => ({
      spotId: String(spotId),
      name: String(name),
      result: result as 'completed' | 'skipped',
      occurredAt: String(occurredAt),
      plannedStayMinutes: Number(plannedStayMinutes),
      transitionMinutes: Number(transitionMinutes),
    }),
  );

  return {
    id: 'demo-v1',
    name: '灵山文化漫游路线',
    status: 'finished',
    mapId: 'ling-shan',
    startedAt,
    finishedAt: '2026-07-30T11:28:00+08:00',
    elapsedMinutes: 136,
    completedCount: 5,
    skippedCount: 1,
    adjustmentCount: 1,
    deviationCount: 1,
    recommendedOrder: actualOrder.map((spot) => spot.name),
    preferenceProfile: {
      mapId: 'ling-shan',
      durationMinutes: 180,
      physicalLevel: 'medium',
      interestTags: ['建筑艺术', '佛教文化', '摄影'],
    },
    actualOrder,
    aiTopics: ['五印坛城建筑', '祥符禅寺历史'],
    movement: {
      estimatedWalkingMinutes: 43,
      plannedScenicMinutes: 70,
      estimatedDistanceMeters: 3010,
      estimatedSteps: 4300,
      estimatedCaloriesKcal: 150,
      coverageRatio: 1,
      confidence: 'medium',
      formulaVersion: 'demo-v1',
    },
  };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '本次旅程';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function scenicNameFromMapId(mapId?: string) {
  return mapId === 'nianhua-bay' ? '拈花湾' : '灵山胜境';
}

function buildInterestTags(
  recap: TourRecap,
  spotsById: Map<string, ScenicSpot>,
) {
  const completedTags = recap.actualOrder
    .filter((spot) => spot.result === 'completed')
    .flatMap((spot) => spotsById.get(spot.spotId)?.tags ?? []);
  const corpus = [
    ...completedTags,
    ...(recap.preferenceProfile.interestTags ?? []),
    ...recap.aiTopics,
  ].join(' ');
  const tags: string[] = [];
  if (/建筑|宫|塔|坛城|雕塑|艺术/u.test(corpus)) {
    tags.push('建筑文化观察者');
  }
  if (/佛|禅|宗教|经|文化/u.test(corpus)) {
    tags.push('佛教文化探索者');
  }
  if (/自然|山水|摄影|影像|花|湖/u.test(corpus)) {
    tags.push('山水影像漫游者');
  }
  return tags.length ? tags.slice(0, 3) : ['灵山漫游者'];
}

export default function TourRecapPage() {
  const { tourId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isDemo = searchParams.get('demo') === '1';
  const [recap, setRecap] = useState<TourRecap>();
  const [localTour, setLocalTour] = useState<TourSession>();
  const [localMode, setLocalMode] = useState(false);
  const [error, setError] = useState('');
  const [spots, setSpots] = useState<ScenicSpot[]>([]);
  const [coverImageAttempt, setCoverImageAttempt] = useState(0);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    let active = true;
    setRecap(undefined);
    setError('');
    setLocalMode(false);
    const recovered = isDemo ? undefined : loadTourRecovery(tourId);
    setLocalTour(recovered);

    if (isDemo) {
      setRecap(buildDemoRecap());
    } else {
      void getTourRecap(tourId)
        .then((value) => {
          if (active) setRecap(value);
        })
        .catch(() => {
          if (!active) return;
          if (recovered) {
            setRecap(buildLocalRecap(recovered));
            setLocalMode(true);
          } else {
            setError('这条游览记录已失效，暂时无法恢复回顾内容。');
          }
        });
    }

    void getSpots()
      .then((items) => {
        if (active) setSpots(items);
      })
      .catch(() => {
        if (active) setSpots([]);
      });

    return () => {
      active = false;
    };
  }, [isDemo, tourId]);

  const actualOrder = useMemo(
    () =>
      recap?.actualOrder.filter(
        (spot) => !isEntranceSpot(spot.spotId, spot.name),
      ) ?? [],
    [recap?.actualOrder],
  );
  const spotsById = useMemo(
    () => new Map(spots.map((spot) => [spot.id, spot])),
    [spots],
  );
  const routeCoverSpot =
    localTour?.spots.find(
      (spot) =>
        !isEntranceSpot(spot.spotId, spot.name) &&
        spot.status === 'current',
    ) ??
    localTour?.spots.find(
      (spot) =>
        !isEntranceSpot(spot.spotId, spot.name) &&
        spot.status === 'completed',
    ) ??
    localTour?.spots.find(
      (spot) => !isEntranceSpot(spot.spotId, spot.name),
    );
  const recommendedCoverSpot = recap?.recommendedOrder
    .map((name) => spots.find((spot) => spot.name === name))
    .find((spot): spot is ScenicSpot => Boolean(spot));
  const representativeSpot =
    actualOrder.find((spot) => spot.result === 'completed') ??
    actualOrder[0] ??
    (routeCoverSpot
      ? { spotId: routeCoverSpot.spotId, name: routeCoverSpot.name }
      : undefined) ??
    (recommendedCoverSpot
      ? { spotId: recommendedCoverSpot.id, name: recommendedCoverSpot.name }
      : undefined);
  const representativeScenicSpot = representativeSpot
    ? spotsById.get(representativeSpot.spotId)
    : undefined;
  const coverImageCandidates = Array.from(
    new Set(
      representativeSpot
        ? [
            resolveSpotImage(
              representativeSpot.spotId,
              representativeScenicSpot?.imageUrl,
            ),
            resolveSpotImage(representativeSpot.spotId),
            fallbackSpotImage,
          ]
        : [fallbackSpotImage],
    ),
  );
  const coverImage =
    coverImageCandidates[
      Math.min(coverImageAttempt, coverImageCandidates.length - 1)
    ];

  useEffect(() => {
    setCoverImageAttempt(0);
  }, [representativeScenicSpot?.imageUrl, representativeSpot?.spotId]);

  const interestTags = useMemo(
    () => (recap ? buildInterestTags(recap, spotsById) : []),
    [recap, spotsById],
  );
  const unfinishedSpots = useMemo(() => {
    const candidates = [
      ...(localTour?.spots ?? [])
        .filter(
          (spot) =>
            !isEntranceSpot(spot.spotId, spot.name) &&
            spot.status !== 'completed',
        )
        .map((spot) => ({ spotId: spot.spotId, name: spot.name })),
      ...actualOrder
        .filter((spot) => spot.result === 'skipped')
        .map((spot) => ({ spotId: spot.spotId, name: spot.name })),
    ];
    return Array.from(
      new Map(candidates.map((spot) => [spot.spotId, spot])).values(),
    );
  }, [actualOrder, localTour?.spots]);
  const closingSentences = useMemo(() => {
    if (!recap) return [];
    const sentences = [
      `这次你完成了 ${recap.completedCount} 个景点，把${representativeSpot?.name ?? '沿途风景'}留成了旅程封面。`,
      `从游览选择来看，你是一位${interestTags.join('、')}。`,
    ];
    sentences.push(
      unfinishedSpots.length
        ? `还有 ${unfinishedSpots.length} 处风景留待下次，我们可以从这里继续。`
        : '这条路线已经圆满走完，愿今天看到的细节一直留在记忆里。',
    );
    return sentences;
  }, [
    interestTags,
    recap,
    representativeSpot?.name,
    unfinishedSpots.length,
  ]);
  const closingText = closingSentences.join('');
  const canSpeak =
    typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(
    () => () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    },
    [],
  );

  const toggleClosingSpeech = useCallback(() => {
    if (!canSpeak) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(closingText);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.94;
    utterance.pitch = 1.02;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [canSpeak, closingText, speaking]);

  if (error) {
    return (
      <main className={styles.statePage}>
        <Alert
          type="warning"
          showIcon
          message="记录已失效"
          description={error}
          action={
            <Button
              icon={<HistoryOutlined />}
              onClick={() => navigate('/tour-recaps')}
            >
              返回回顾首页
            </Button>
          }
        />
      </main>
    );
  }

  if (!recap) {
    return (
      <main className={styles.statePage} aria-live="polite">
        <Spin size="large" tip="正在整理本次旅程" />
      </main>
    );
  }

  const completedSpotNames = actualOrder
    .filter((spot) => spot.result === 'completed')
    .map((spot) => spot.name);
  const routeName = recap.name;

  function openJournal() {
    writeTourRecapJournalHandoff({
      routeName,
      completedSpotNames,
      interestTags,
      recapSummary: closingText,
    });
    navigate('/travel-journal');
  }

  function openPhotoWorkshop() {
    writeTourRecapPhotoHandoff({
      coverImageUrl: coverImage,
      spotName: representativeSpot?.name,
      prompt:
        `以${representativeSpot?.name ?? '本次灵山旅程'}为主体，制作一张禅意旅行纪念图。` +
        `保留景点原貌，融入${interestTags.join('、')}的旅行气质，并留出日期与旅签文字空间。`,
    });
    navigate('/photo-workshop');
  }

  return (
    <main
      className={styles.page}
      data-testid="tour-recap-page"
      data-demo={isDemo || undefined}
    >
      <section className={styles.hero} aria-labelledby="recap-title">
        <img
          data-testid="tour-recap-cover"
          className={styles.heroImage}
          src={coverImage}
          alt={`${representativeSpot?.name ?? recap.name}旅程封面`}
          onError={() =>
            setCoverImageAttempt((attempt) =>
              Math.min(attempt + 1, coverImageCandidates.length - 1),
            )
          }
        />
        <div className={styles.heroContent}>
          <div className={styles.heroText}>
            <div className={styles.eyebrow}>
              <span>TOUR RECAP</span>
              {isDemo ? <Tag color="gold">示例数据</Tag> : null}
              {recap.status === 'active' ? <Tag>行程进行中</Tag> : null}
            </div>
            <p>
              {formatDate(recap.startedAt)} · {scenicNameFromMapId(recap.mapId)}
            </p>
            <h1 id="recap-title">{recap.name}</h1>
            <p className={styles.heroSummary}>
              {completedSpotNames.length
                ? `你沿着 ${completedSpotNames.slice(0, 3).join('、')}${completedSpotNames.length > 3 ? '等景点' : ''}，完成了一次有迹可循的文化漫游。`
                : `这段旅程刚刚启程，先从${representativeSpot?.name ?? '眼前的风景'}慢慢开始。`}
            </p>
          </div>
        </div>
      </section>

      {localMode ? (
        <Alert
          className={styles.inlineAlert}
          type="warning"
          showIcon
          message="服务暂时不可用，当前内容由本浏览器保存的行程记录恢复。"
        />
      ) : null}
      {recap.status === 'active' ? (
        <Alert
          className={styles.inlineAlert}
          type="info"
          showIcon
          message="行程仍在进行中，以下内容是当前阶段的回顾快照。"
          action={
            <Button
              size="small"
              type="primary"
              onClick={() =>
                navigate(`/scene-guide?tourId=${encodeURIComponent(recap.id)}`)
              }
            >
              继续场景导览
            </Button>
          }
        />
      ) : null}

      <section className={styles.storyGrid}>
        <article className={styles.interestPanel}>
          <span className={styles.sectionIndex}>TRAVEL INTEREST</span>
          <h2>你的旅行兴趣</h2>
          <div className={styles.interestTags}>
            {interestTags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          {recap.aiTopics.length ? (
            <div className={styles.topicLine}>
              <SoundOutlined />
              本次关注：{recap.aiTopics.slice(0, 3).join(' · ')}
            </div>
          ) : null}
        </article>

        <article className={styles.unfinishedPanel}>
          <span className={styles.sectionIndex}>NEXT CHAPTER</span>
          <h2>未完待续</h2>
          {unfinishedSpots.length ? (
            <>
              <p>这些风景没有缺席，只是被留给了下一次。</p>
              <ul>
                {unfinishedSpots.slice(0, 5).map((spot) => (
                  <li key={spot.spotId}>{spot.name}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>本次计划内景点已经全部完成，可以从新的兴趣主题出发。</p>
          )}
          <Button
            type="link"
            icon={<ArrowRightOutlined />}
            onClick={() => navigate('/routes')}
          >
            生成下次续游路线
          </Button>
        </article>
      </section>

      <section className={styles.guideMessage}>
        <div className={styles.guideAvatar}>
          <img
            src="/avatar/ling-shiyin-pet.png"
            alt="灵诗音"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        </div>
        <div className={styles.guideCopy}>
          <span>灵诗音寄语</span>
          <h2>把今天看见的，留在下一次出发之前。</h2>
          {closingSentences.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </div>
        {canSpeak ? (
          <Button
            className={styles.speechButton}
            icon={
              speaking ? <PauseCircleOutlined /> : <PlayCircleOutlined />
            }
            onClick={toggleClosingSpeech}
          >
            {speaking ? '停止' : '听寄语'}
          </Button>
        ) : null}
      </section>

      <footer className={styles.actions}>
        <div>
          <span className={styles.sectionIndex}>CONTINUE CREATING</span>
          <h2>让这次旅程继续生长</h2>
        </div>
        <div className={styles.actionButtons}>
          <Button
            type="primary"
            icon={<BookOutlined />}
            onClick={openJournal}
          >
            生成旅行手账
          </Button>
          <Button icon={<CameraOutlined />} onClick={openPhotoWorkshop}>
            进入相册创意工坊
          </Button>
          <Button
            icon={<EnvironmentOutlined />}
            onClick={() => navigate('/routes')}
          >
            重新规划路线
          </Button>
        </div>
      </footer>
    </main>
  );
}
