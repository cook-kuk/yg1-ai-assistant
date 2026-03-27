'use client';
import { useState } from 'react';
import { DealerPopup } from './DealerPopup';

interface DealerPopupTriggerButtonProps {
  region: string;
  topDealer: string;
}

export function DealerPopupTriggerButton({ region, topDealer }: DealerPopupTriggerButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-2 flex items-center justify-between w-full rounded-lg border border-[#C8102E]/20 bg-white hover:bg-red-50 px-3 py-2.5 transition-colors group"
      >
        <span className="flex items-center gap-2 text-sm text-gray-700">
          <span>📍</span>
          <span className="font-medium">{topDealer}</span>
        </span>
        <span className="text-xs font-medium text-[#C8102E] group-hover:underline">
          영업소 정보 보기 →
        </span>
      </button>
      <DealerPopup isOpen={open} onClose={() => setOpen(false)} initialRegion={region} />
    </>
  );
}
