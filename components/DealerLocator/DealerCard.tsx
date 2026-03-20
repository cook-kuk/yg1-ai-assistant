'use client';

interface DealerCardProps {
  id: string;
  name: string;
  flag: string;
  address: string;
  phone: string;
  email?: string;
  distance: number;
  distanceLabel: string;
  locationSource: 'gps' | 'ip' | 'none';
  rank: number;
}

const rankStyles: Record<number, { border: string; badge: string; badgeText: string }> = {
  1: { border: 'border-amber-400 shadow-amber-100', badge: 'bg-amber-50 text-amber-700', badgeText: '⭐ 가장 가까운 영업소' },
  2: { border: 'border-gray-300', badge: 'bg-gray-50 text-gray-500', badgeText: '2위' },
  3: { border: 'border-orange-200', badge: 'bg-orange-50 text-orange-600', badgeText: '3위' },
};

export function DealerCard({ name, flag, address, phone, email, distanceLabel, locationSource, rank }: DealerCardProps) {
  const style = rankStyles[rank] || rankStyles[3];
  const isGps = locationSource === 'gps';

  return (
    <div className={`rounded-xl border-2 ${style.border} bg-white p-4 transition-shadow duration-200 hover:shadow-lg`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{flag}</span>
          <h3 className="font-semibold text-gray-900 text-sm">{name}</h3>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${style.badge}`}>
          {style.badgeText}
        </span>
      </div>

      <div className="mb-3">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
          isGps ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
        }`}>
          📍 {isGps ? distanceLabel : `약 ${distanceLabel}`}
        </span>
      </div>

      <a
        href={`https://maps.google.com/?q=${encodeURIComponent(address)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-xs text-gray-500 hover:text-[#C8102E] hover:underline mb-2 transition-colors"
      >
        {address}
      </a>

      <div className="flex items-center gap-3 text-xs">
        <a href={`tel:${phone}`} className="text-[#C8102E] hover:underline font-medium">
          📞 {phone}
        </a>
        {email && (
          <a href={`mailto:${email}`} className="text-blue-600 hover:underline">
            ✉️ {email}
          </a>
        )}
      </div>
    </div>
  );
}
