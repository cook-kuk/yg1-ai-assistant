'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from '@/context/LocationContext';
import { useNearestDealers } from '@/hooks/useNearestDealers';
import { DealerPopup } from './DealerPopup';

export function DealerLocator() {
  const [popupOpen, setPopupOpen] = useState(false);
  const { lat, lng, source, permissionStatus, requestGPS } = useLocation();
  const nearest = useNearestDealers(lat, lng, { topK: 1 });
  const top = nearest[0];

  const handleClick = async () => {
    if (permissionStatus === 'not_asked') {
      await requestGPS();
    }
    setPopupOpen(true);
  };

  const isGps = source === 'gps';

  return (
    <>
      <AnimatePresence mode="wait">
        <motion.button
          key={permissionStatus}
          onClick={handleClick}
          className="fixed bottom-20 right-4 z-50 flex items-center gap-2 rounded-full bg-[#1A1A2E] text-white shadow-lg hover:shadow-xl px-4 py-2.5 text-sm font-medium transition-shadow"
          initial={{ width: 'auto', opacity: 0, scale: 0.9 }}
          animate={{ width: 'auto', opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {permissionStatus === 'pending' ? (
            <>
              <span className="animate-spin">⏳</span>
              <span>위치 확인 중...</span>
            </>
          ) : permissionStatus === 'granted' && top ? (
            <>
              <span>📍</span>
              <span>{top.name}</span>
              <span className="text-emerald-400 text-xs">· {top.distanceLabel}</span>
              <span>▶</span>
            </>
          ) : permissionStatus === 'denied' && top ? (
            <>
              <span>📍</span>
              <span>영업소 찾기</span>
              <span className="text-amber-400 text-xs">· 약 {top.distanceLabel}</span>
              <span>▶</span>
            </>
          ) : (
            <>
              <span className="animate-pulse">📍</span>
              <span>영업소 찾기</span>
            </>
          )}
        </motion.button>
      </AnimatePresence>

      <DealerPopup isOpen={popupOpen} onClose={() => setPopupOpen(false)} />
    </>
  );
}
