'use client';
import { useState } from 'react';
import { useLocation } from '@/context/LocationContext';

export function LocationPermissionBanner() {
  const { permissionStatus, requestGPS, skipLocation } = useLocation();
  const [showToast, setShowToast] = useState(false);
  const [hiding, setHiding] = useState(false);

  if (showToast) {
    return (
      <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-emerald-50 border-b border-emerald-200 px-4 py-2.5 text-sm text-emerald-700 animate-in fade-in duration-300">
        <span>✅ 위치 확인됨 (GPS 정확)</span>
      </div>
    );
  }

  if (permissionStatus !== 'not_asked' || hiding) return null;

  const handleAllow = async () => {
    await requestGPS();
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  const handleSkip = () => {
    setHiding(true);
    skipLocation();
  };

  return (
    <div className="sticky top-0 z-50 flex items-center gap-3 bg-white/95 backdrop-blur border-b border-gray-200 px-4 py-3 shadow-sm">
      <span className="text-lg animate-pulse">📍</span>
      <p className="flex-1 text-sm text-gray-700">
        더 정확한 서비스를 위해 현재 위치를 사용해도 될까요? 가까운 YG-1 영업소를 바로 안내해드립니다.
      </p>
      <button
        onClick={handleAllow}
        className="shrink-0 rounded-lg bg-[#C8102E] px-4 py-2 text-sm font-medium text-white hover:bg-[#a00d24] transition-colors"
      >
        📍 위치 허용
      </button>
      <button
        onClick={handleSkip}
        className="shrink-0 text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        나중에
      </button>
    </div>
  );
}
