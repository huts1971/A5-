import { useCallback, useEffect, useMemo, useState } from 'react';
import EmptyState from '../../components/common/EmptyState';
import ErrorState from '../../components/common/ErrorState';
import PageLoading from '../../components/common/PageLoading';
import ImageTrail from '../../components/scenic/ImageTrail';
import SpotReel from '../../components/scenic/SpotReel';
import { resolveSpotPhotos } from '../../api/spotImages';
import { getSpots } from '../../api/spots';
import type { ScenicSpot } from '../../types/scenic';

const routeOnlySpotIds = new Set(['spot_ls_entrance', 'spot_nh_entrance']);

export default function SpotListPage() {
  const [spots, setSpots] = useState<ScenicSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const trailImages = useMemo(
    () => spots.flatMap((spot) => resolveSpotPhotos(spot.id, spot.imageUrl).slice(0, 1)).slice(0, 12),
    [spots],
  );

  const loadSpots = useCallback(() => {
    setLoading(true);
    setError('');
    getSpots()
      .then((items) => setSpots(items.filter((spot) => !routeOnlySpotIds.has(spot.id))))
      .catch(() => setError('景点数据加载失败，请稍后重试。'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadSpots();
  }, [loadSpots]);

  let content = <PageLoading label="正在加载景点列表..." />;
  if (error) {
    content = <ErrorState message={error} onRetry={loadSpots} />;
  } else if (!loading) {
    content = (
      <div className="spot-reel-page">
        {spots.length === 0 ? (
          <EmptyState title="暂无景点" description="请先准备景区种子数据。" />
        ) : (
          <>
            <SpotReel spots={spots} />
            <ImageTrail items={trailImages} />
          </>
        )}
      </div>
    );
  }

  return content;
}
