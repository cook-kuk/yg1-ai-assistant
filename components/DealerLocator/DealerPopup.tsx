'use client';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from '@/context/LocationContext';
import { useNearestDealers } from '@/hooks/useNearestDealers';
import { DealerCard } from './DealerCard';

interface DealerPopupProps {
  isOpen: boolean;
  onClose: () => void;
  initialRegion?: string;
}

const REGION_TABS = [
  { key: 'all',      label: '전체' },
  { key: 'korea',    label: '🇰🇷 국내' },
  { key: 'china',    label: '🇨🇳 중국' },
  { key: 'asia',     label: '🌏 아시아' },
  { key: 'europe',   label: '🇪🇺 유럽' },
  { key: 'americas', label: '🌎 미주' },
  { key: 'africa',   label: '🌍 아프리카' },
];

export function DealerPopup({ isOpen, onClose, initialRegion }: DealerPopupProps) {
  const [region, setRegion] = useState(initialRegion || 'all');
  const [showAll, setShowAll] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { lat, lng, source, permissionStatus, requestGPS } = useLocation();
  const dealers = useNearestDealers(lat, lng, { topK: showAll ? 5 : 3, region });

  useEffect(() => {
    if (initialRegion) setRegion(initialRegion);
  }, [initialRegion]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-end md:items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Popup */}
          <motion.div
            className={`relative z-10 w-full bg-white overflow-hidden ${
              isMobile
                ? 'rounded-t-2xl max-h-[85vh]'
                : 'rounded-2xl max-w-[480px] max-h-[80vh] mx-4'
            }`}
            initial={isMobile ? { y: '100%' } : { opacity: 0, scale: 0.95 }}
            animate={isMobile ? { y: 0 } : { opacity: 1, scale: 1 }}
            exit={isMobile ? { y: '100%' } : { opacity: 0, scale: 0.95 }}
            transition={{ duration: isMobile ? 0.3 : 0.25, ease: 'easeOut' }}
          >
            {/* Header */}
            <div className="bg-[#1A1A2E] px-5 py-4 flex items-center justify-between">
              <h2 className="text-white font-semibold text-base">📍 가까운 YG-1 영업소</h2>
              <button onClick={onClose} className="text-white/70 hover:text-white text-xl leading-none transition-colors">
                ✕
              </button>
            </div>

            {/* Region tabs */}
            <div className="flex gap-1 px-4 py-3 overflow-x-auto border-b border-gray-100 no-scrollbar">
              {REGION_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => { setRegion(tab.key); setShowAll(false); }}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    region === tab.key
                      ? 'bg-[#C8102E] text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="overflow-y-auto p-4 space-y-3" style={{ maxHeight: isMobile ? '60vh' : '50vh' }}>
              {permissionStatus === 'not_asked' || permissionStatus === 'pending' ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  <p className="mb-3">위치 정보를 허용하면 가까운 영업소를 찾아드립니다.</p>
                  <button
                    onClick={requestGPS}
                    className="rounded-lg bg-[#C8102E] px-4 py-2 text-sm font-medium text-white hover:bg-[#a00d24] transition-colors"
                  >
                    📍 위치 허용하기
                  </button>
                </div>
              ) : dealers.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  해당 지역에 등록된 영업소가 없습니다.
                </div>
              ) : (
                <>
                  {source === 'ip' && (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                      정확한 거리를 보려면 위치 허용을 클릭해주세요.
                    </div>
                  )}
                  {dealers.map((dealer, i) => (
                    <motion.div
                      key={dealer.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05, duration: 0.2 }}
                    >
                      <DealerCard
                        {...dealer}
                        email={dealer.email || undefined}
                        locationSource={source}
                        rank={i + 1}
                      />
                    </motion.div>
                  ))}
                  {!showAll && dealers.length === 3 && (
                    <button
                      onClick={() => setShowAll(true)}
                      className="w-full text-center text-sm text-[#C8102E] hover:underline py-2"
                    >
                      더 보기
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
