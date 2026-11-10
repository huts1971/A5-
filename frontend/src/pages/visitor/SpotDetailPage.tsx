import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import EmptyState from '../../components/common/EmptyState';
import ErrorState from '../../components/common/ErrorState';
import PageLoading from '../../components/common/PageLoading';
import SpotDetailSlider from '../../components/scenic/SpotDetailSlider';
import { fallbackSpotImage, resolveSpotPhotos } from '../../api/spotImages';
import { getCachedSpotDetail, getSpotDetail } from '../../api/spots';
import type { ScenicSpot } from '../../types/scenic';

export default function SpotDetailPage() {
  const { spotId } = useParams();
  const location = useLocation();
  const routeStateSpot = (location.state as { spot?: ScenicSpot } | null)?.spot;
  const initialSpot = useMemo(
    () => (spotId && routeStateSpot?.id === spotId ? routeStateSpot : spotId ? getCachedSpotDetail(spotId) : undefined),
    [routeStateSpot, spotId],
  );
  const [spot, setSpot] = useState<ScenicSpot | undefined>(initialSpot);
  const [loading, setLoading] = useState(!initialSpot);
  const [error, setError] = useState('');
  const currentSpot = spot?.id === spotId ? spot : initialSpot;

  const loadSpot = useCallback(() => {
    if (!spotId) {
      setError('缺少景点 ID。');
      setLoading(false);
      return;
    }

    const cachedSpot = routeStateSpot?.id === spotId ? routeStateSpot : getCachedSpotDetail(spotId);
    if (cachedSpot) {
      setSpot(cachedSpot);
    }
    setLoading(!cachedSpot);
    setError('');
    getSpotDetail(spotId)
      .then((nextSpot) => {
        if (nextSpot) {
          setSpot(nextSpot);
        } else if (!cachedSpot) {
          setSpot(undefined);
        }
      })
      .catch(() => {
        if (!cachedSpot) setError('景点详情加载失败。');
      })
      .finally(() => setLoading(false));
  }, [routeStateSpot, spotId]);

  useEffect(() => {
    loadSpot();
  }, [loadSpot]);

  if (loading && !currentSpot) {
    return <PageLoading label="正在加载景点详情..." />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadSpot} />;
  }

  if (!currentSpot) {
    return <EmptyState title="未找到景点" description="请回到景点列表重新选择。" />;
  }

  const buildGuideHref = (question: string) =>
    `/guide?spotId=${encodeURIComponent(currentSpot.id)}&spotName=${encodeURIComponent(currentSpot.name)}&question=${encodeURIComponent(question)}`;
  const guideQuestions = [
    `请介绍一下${currentSpot.name}的主要看点、适合人群和游览建议。`,
    `${currentSpot.name}适合带小朋友看吗？`,
    `${currentSpot.name}附近路线怎么安排？`,
  ];

  return (
    <SpotDetailSlider
      spot={currentSpot}
      photos={resolveSpotPhotos(currentSpot.id, currentSpot.imageUrl ?? fallbackSpotImage)}
      questions={guideQuestions.map((question) => ({ label: question, to: buildGuideHref(question) }))}
    />
  );
}
