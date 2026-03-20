'use client';
import { useMemo } from 'react';
import dealers from '@/data/dealers.json';
import { haversineDistance, formatDistance } from '@/lib/utils/haversine';

export function useNearestDealers(
  lat: number | null, lng: number | null,
  options: { topK?: number; region?: string } = {}
) {
  return useMemo(() => {
    if (!lat || !lng) return [];
    const { topK = 3, region = 'all' } = options;
    return dealers
      .filter(d => region === 'all' || d.region === region)
      .map(d => ({
        ...d,
        distance: haversineDistance(lat, lng, d.lat, d.lng),
        distanceLabel: formatDistance(haversineDistance(lat, lng, d.lat, d.lng))
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, topK);
  }, [lat, lng, options.topK, options.region]);
}
