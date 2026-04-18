# Claude Code Prompt — ARIA Dealer Locator (전체 구현 스펙)

---

## 🎯 한 줄 요약
ARIA 챗봇 초기화면에서 GPS 위치 동의 → 가까운 YG-1 영업소 탐색 →
"영업소 찾기" 버튼 클릭 시 팝업 표시 + AI 챗봇이 자연어로 영업소 안내하며 팝업 열기 제안.

---

## 📁 생성할 파일 구조

```
src/
├── data/
│   └── dealers.json                       ← 전체 영업소 데이터 (좌표 포함)
├── context/
│   └── LocationContext.tsx                ← GPS 위치 전역 상태
├── hooks/
│   └── useNearestDealers.ts               ← 거리 계산 + 정렬 훅
├── utils/
│   └── haversine.ts                       ← Haversine 거리 계산
├── components/
│   └── DealerLocator/
│       ├── index.tsx                      ← 플로팅 버튼 (메인 진입점)
│       ├── LocationPermissionBanner.tsx   ← 초기 위치 동의 배너
│       ├── DealerPopup.tsx                ← 영업소 팝업 모달
│       ├── DealerCard.tsx                 ← 개별 영업소 카드
│       └── DealerPopupTriggerButton.tsx   ← 챗봇 메시지 내 인라인 버튼
└── lib/
    └── dealerTool.ts                      ← LangGraph Agent tool
```

---

## 📦 STEP 1 — dealers.json

`/src/data/dealers.json` 으로 저장해줘.

```json
[
  { "id":"KR_SEOUL",    "name":"서울 지점",       "name_en":"Seoul Branch",
    "region":"korea",   "country":"KR", "flag":"🇰🇷",
    "address":"13-40, Songdogwahak-ro 16beon-gil, Yeonsu-gu, Incheon",
    "phone":"+82-2-681-3456", "fax":"+82-2-611-3451", "lat":37.3896, "lng":126.6520 },
  { "id":"KR_DAEGU",    "name":"대구 사무소",      "name_en":"Daegu Office",
    "region":"korea",   "country":"KR", "flag":"🇰🇷",
    "address":"559, Dalseo-daero, Dalseo-gu, Daegu (ENC InnoBiz Tower 710호)",
    "phone":"+82-53-600-8909", "fax":"+82-53-600-8911", "lat":35.8342, "lng":128.5325 },
  { "id":"KR_CHEONAN",  "name":"천안 사무소",      "name_en":"Cheonan Office",
    "region":"korea",   "country":"KR", "flag":"🇰🇷",
    "address":"23, Buldang 17-gil, Seobuk-gu, Cheonan-si (Crystal Plaza 305호)",
    "phone":"+82-41-417-0985", "fax":"+82-41-417-0986", "lat":36.8151, "lng":127.1139 },
  { "id":"KR_BUSAN",    "name":"부산 사무소",      "name_en":"Busan Office",
    "region":"korea",   "country":"KR", "flag":"🇰🇷",
    "address":"248, Gamjeoncheon-ro, Sasang-gu, Busan",
    "phone":"+82-51-314-0985", "fax":"+82-51-314-0976", "lat":35.1509, "lng":128.9875 },
  { "id":"KR_CHANGWON", "name":"창원 사무소",      "name_en":"Changwon Office",
    "region":"korea",   "country":"KR", "flag":"🇰🇷",
    "address":"161, Yongji-ro, Uichang-gu, Changwon-si (경남빌딩 705호)",
    "phone":"+82-55-275-0985", "fax":"+82-55-261-0986", "lat":35.2272, "lng":128.6811 },
  { "id":"CN_QD",       "name":"QINGDAO YG-1 CUTTING TOOL CO., LTD", "name_en":"Qingdao YG-1 Cutting Tool",
    "region":"china",   "country":"CN", "flag":"🇨🇳",
    "address":"NO. 3 New York Road, Qingdao Free Trade Zone, China",
    "phone":"+86-532-8676-9779", "email":"china-sales@yg1.kr", "lat":36.0671, "lng":120.3826 },
  { "id":"CN_SH",       "name":"YG-1 TOOL SOLUTIONS CO., LTD.", "name_en":"YG-1 Tool Solutions Shanghai",
    "region":"china",   "country":"CN", "flag":"🇨🇳",
    "address":"No.518 Fuquan North Road, Hongqiao Int'l Business Park, Changning, Shanghai",
    "phone":"+86-21-5283-6816", "email":"service@yg1-toolsolutions.cn", "lat":31.1941, "lng":121.3564 },
  { "id":"AS_IN",       "name":"YG-1 INDUSTRIES (India)", "name_en":"YG-1 Industries India",
    "region":"asia",    "country":"IN", "flag":"🇮🇳",
    "address":"KIADB Industrial Area Phase III, Doddaballapura, Bengaluru-561203",
    "phone":"+91-80-22044620", "email":"marketing@yg1india.com", "lat":13.2956, "lng":77.5371 },
  { "id":"AS_JP",       "name":"YG-1 JAPAN CO., LTD.", "name_en":"YG-1 Japan",
    "region":"asia",    "country":"JP", "flag":"🇯🇵",
    "address":"Shinosaka No.2 DOI BLDG. 2-14-6 Nishinakajima, Yodogawa-ku, Osaka 532-0011",
    "phone":"+81-6-6305-9897", "email":"t-kitaoka8@yg1.jp", "lat":34.7333, "lng":135.4951 },
  { "id":"AS_SG",       "name":"YG-1 TOOLS ASIA PTE. LTD.", "name_en":"YG-1 Tools Asia Singapore",
    "region":"asia",    "country":"SG", "flag":"🇸🇬",
    "address":"Block 3007 Ubi Road 1, #02-416, SINGAPORE 408701",
    "phone":"+65-6842-0468", "email":"yg1toolsasia@yg1.co.kr", "lat":1.3290, "lng":103.8990 },
  { "id":"AS_VN",       "name":"YG-1 VIETNAM CO., LTD.", "name_en":"YG-1 Vietnam",
    "region":"asia",    "country":"VN", "flag":"🇻🇳",
    "address":"Floor 7th, HEID building, Lane 6A, Thanh Cong, Ba Dinh, Hanoi",
    "phone":"+84-24-3795-7233", "email":"bbak98@yg1.co.kr", "lat":21.0285, "lng":105.8412 },
  { "id":"AS_TH",       "name":"YG-1 (THAILAND) CO., LTD.", "name_en":"YG-1 Thailand",
    "region":"asia",    "country":"TH", "flag":"🇹🇭",
    "address":"88 Nimitkul Building 5F, Soi Rama IX 57/1, Suanluang, Bangkok 10250",
    "phone":"+66-2-370-4945", "email":"cherdchai@yg1.co.th", "lat":13.7563, "lng":100.5018 },
  { "id":"AS_AU",       "name":"YG-1 AUSTRALIA PTY. LTD.", "name_en":"YG-1 Australia",
    "region":"asia",    "country":"AU", "flag":"🇦🇺",
    "address":"Unit 11, 42-44 Garden Blvd. Dingley Village, Vic.3172",
    "phone":"+61-3-9558-0177", "email":"ygone@ygone.com.au", "lat":-37.9856, "lng":145.1277 },
  { "id":"AS_MY",       "name":"YG-1 (M) SDN. BHD.", "name_en":"YG-1 Malaysia",
    "region":"asia",    "country":"MY", "flag":"🇲🇾",
    "address":"LOT 13A-2 & 15-2, UOA Business Park, Jalan Pengaturcara U1/51A, Shah Alam, Selangor",
    "phone":"+603-5569-9511", "email":"", "lat":3.0738, "lng":101.5183 },
  { "id":"AS_ID",       "name":"PT. YGI TOOLS", "name_en":"PT YGI Tools Indonesia",
    "region":"asia",    "country":"ID", "flag":"🇮🇩",
    "address":"Ruko Ruby Commercial Blok TB23 & TB25, JL.Boulevard Selatan, Summarecon Bekasi",
    "phone":"+62-21-8946-0074", "email":"", "lat":-6.2297, "lng":107.0087 },
  { "id":"AS_AE",       "name":"YG-1 Middle East FZE", "name_en":"YG-1 Middle East",
    "region":"asia",    "country":"AE", "flag":"🇦🇪",
    "address":"Sharjah Airport Int'l Free Zone, Building X2, Offices 28/29, Sharjah UAE",
    "phone":"+971-6-522-1419", "email":"CSR@yg1me.ae", "lat":25.3193, "lng":55.5172 },
  { "id":"AS_TR",       "name":"YG-1 KESICI TAKIMLAR", "name_en":"YG-1 Turkey",
    "region":"asia",    "country":"TR", "flag":"🇹🇷",
    "address":"Muradiye Mah. 14 Sk. Sanatkarlar Kooperatifi Sitesi No:19 Yunusemre/Manisa, Turkiye",
    "phone":"+90-216-504-8292", "email":"info@yg1.com.tr", "lat":38.6191, "lng":27.4305 },
  { "id":"EU_DE",       "name":"YG-1 DEUTSCHLAND GMBH", "name_en":"YG-1 Germany",
    "region":"europe",  "country":"DE", "flag":"🇩🇪",
    "address":"Rudolf-Diese-Str.12b, 65760 Eschborn/Taunus, Germany",
    "phone":"+49-6173-9667-0", "email":"info@yg-1.de", "lat":50.1426, "lng":8.5699 },
  { "id":"EU_FR",       "name":"YG-1 EUROPE SAS", "name_en":"YG-1 France",
    "region":"europe",  "country":"FR", "flag":"🇫🇷",
    "address":"Parc de l'Esplanade BAT. B1, 1 Rue Enrico Fermi, 77400 St. Thibault des Vignes",
    "phone":"+33-172-84-4070", "email":"yg1@yg1.eu", "lat":48.8566, "lng":2.7833 },
  { "id":"EU_ES",       "name":"herramientas YG-1 SL", "name_en":"YG-1 Spain",
    "region":"europe",  "country":"ES", "flag":"🇪🇸",
    "address":"C/ Nord, 22, 08329 Teià (Barcelona), Spain",
    "phone":"+34-938-297-275", "email":"ventas@yg-1.es", "lat":41.5085, "lng":2.3828 },
  { "id":"EU_PL",       "name":"YG-1 Poland", "name_en":"YG-1 Poland",
    "region":"europe",  "country":"PL", "flag":"🇵🇱",
    "address":"Ul. Gogolinska 29, Warszawa, 02-872, Poland",
    "phone":"+48-22-622-2586", "email":"info@yg-1.pl", "lat":52.2297, "lng":21.0122 },
  { "id":"AM_US",       "name":"YG-1 AMERICA INC.", "name_en":"YG-1 America",
    "region":"americas","country":"US", "flag":"🇺🇸",
    "address":"730 Corporate Woods Parkway, Vernon Hills, IL 60061, USA",
    "phone":"+1-847-634-3700", "email":"info@yg1usa.com", "lat":42.2211, "lng":-87.9506 },
  { "id":"AM_BR",       "name":"YG-1 Comercio de Ferramentas Ltda", "name_en":"YG-1 Brazil",
    "region":"americas","country":"BR", "flag":"🇧🇷",
    "address":"RUA ANTONIO MIORI, 275 - GALPAO 03 JARDIM SANTA BARBARA, ITUPEVA-SP",
    "phone":"+55-11-4496-2170", "email":"vendas@yg1.com.br", "lat":-23.1547, "lng":-47.0586 },
  { "id":"AM_CA_QC",    "name":"YG-1 CANADA QUEBEC (MINICUT INT'L)", "name_en":"YG-1 Canada Quebec",
    "region":"americas","country":"CA", "flag":"🇨🇦",
    "address":"8400 Boul. Du Golf, Anjou, Quebec, H1J 3A1",
    "phone":"+1-514-352-6464", "email":"sales@minicut.com", "lat":45.6012, "lng":-73.5596 },
  { "id":"AM_CA_ON",    "name":"YG-1 CANADA INC.", "name_en":"YG-1 Canada Ontario",
    "region":"americas","country":"CA", "flag":"🇨🇦",
    "address":"3375 North Service Road, Unit A8, Burlington, Ontario L7N 3G2",
    "phone":"+1-905-335-2500", "email":"orders@yg1.ca", "lat":43.3677, "lng":-79.8226 },
  { "id":"AF_ZA",       "name":"YG-1 South Africa", "name_en":"YG-1 South Africa",
    "region":"africa",  "country":"ZA", "flag":"🇿🇦",
    "address":"20 Van Wyk Road, Great North Industrial Park, Unit 17, Benoni",
    "phone":"+27-87-160-0779", "email":"yg1sales@yg1.co.za", "lat":-26.1880, "lng":28.3260 }
]
```

---

## 📋 STEP 2 — 유틸 & 훅

### haversine.ts
```typescript
// /src/utils/haversine.ts
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  if (km < 100) return `${km.toFixed(1)}km`;
  return `${Math.round(km).toLocaleString()}km`;
}
```

### useNearestDealers.ts
```typescript
// /src/hooks/useNearestDealers.ts
import { useMemo } from 'react';
import dealers from '@/data/dealers.json';
import { haversineDistance, formatDistance } from '@/utils/haversine';

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
```

---

## 📋 STEP 3 — LocationContext

```typescript
// /src/context/LocationContext.tsx
'use client';
import { createContext, useContext, useState, ReactNode } from 'react';

type PermissionStatus = 'not_asked' | 'pending' | 'granted' | 'denied';
type LocationSource  = 'gps' | 'ip' | 'none';

interface LocationState {
  lat: number | null;
  lng: number | null;
  source: LocationSource;
  permissionStatus: PermissionStatus;
}
interface LocationContextType extends LocationState {
  requestGPS: () => Promise<void>;
  skipLocation: () => void;
}

const LocationContext = createContext<LocationContextType | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LocationState>({
    lat: null, lng: null, source: 'none', permissionStatus: 'not_asked'
  });

  const requestGPS = async () => {
    setState(s => ({ ...s, permissionStatus: 'pending' }));
    return new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setState({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps', permissionStatus: 'granted' });
          resolve();
        },
        async () => {
          try {
            const res  = await fetch('https://ipapi.co/json/');
            const data = await res.json();
            setState({ lat: data.latitude, lng: data.longitude, source: 'ip', permissionStatus: 'denied' });
          } catch {
            setState(s => ({ ...s, permissionStatus: 'denied' }));
          }
          resolve();
        },
        { timeout: 8000, maximumAge: 300000 }
      );
    });
  };

  const skipLocation = () => setState(s => ({ ...s, permissionStatus: 'denied' }));

  return (
    <LocationContext.Provider value={{ ...state, requestGPS, skipLocation }}>
      {children}
    </LocationContext.Provider>
  );
}

export const useLocation = () => {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be within LocationProvider');
  return ctx;
};
```

---

## 📋 STEP 4 — UI 컴포넌트 구현 스펙

### 4-1. LocationPermissionBanner.tsx

**표시 조건:** `permissionStatus === 'not_asked'` 일 때만 표시

**디자인:**
- 챗봇 초기화면 상단에 sticky 배너 (모달 X — 덜 침습적)
- 좌: 📍 위치 아이콘 (CSS pulse 애니메이션)
- 중: "더 정확한 서비스를 위해 현재 위치를 사용해도 될까요? 가까운 YG-1 영업소를 바로 안내해드립니다."
- 우: `[📍 위치 허용]` 버튼 (YG-1 레드 #C8102E) + `[나중에]` 텍스트 버튼
- 허용 후: 배너 → "✅ 위치 확인됨 (GPS 정확)" 토스트 0.3초 후 사라짐
- 거부 후: 배너 슬라이드업 사라짐 (IP fallback 자동 시도)

### 4-2. DealerCard.tsx

```typescript
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
  rank: number;   // 1=금, 2=은, 3=동 뱃지
}
```

**디자인:**
- rank=1: 골드 테두리 + "⭐ 가장 가까운 영업소" 뱃지
- 거리 뱃지: GPS → 초록색 `📍 12.3km` / IP → 앰버색 `📍 약 230km`
- 주소 클릭 → Google Maps (`https://maps.google.com/?q=${encodeURIComponent(address)}`)
- 전화 클릭 → `tel:${phone}`
- 이메일 클릭 → `mailto:${email}`
- hover: box-shadow elevation 효과 (0.2s transition)

### 4-3. DealerPopup.tsx

```typescript
interface DealerPopupProps {
  isOpen: boolean;
  onClose: () => void;
  initialRegion?: string;  // 챗봇에서 특정 지역으로 열 때
}
```

**디자인:**
- 전체 화면 오버레이 (backdrop-filter: blur(8px) + rgba 반투명)
- 팝업 컨테이너: max-width 480px, 중앙 정렬, border-radius 16px
- 헤더: YG-1 네이비 배경 + "📍 가까운 YG-1 영업소" 타이틀 + X 닫기 버튼
- 지역 탭: `전체` `🇰🇷 국내` `🇨🇳 중국` `🌏 아시아` `🇪🇺 유럽` `🌎 미주` `🌍 아프리카`
- 카드 리스트: 기본 Top-3, "더 보기" 버튼으로 최대 5개
- 팝업 외부 클릭 → 닫기
- ESC 키 → 닫기
- **모바일:** bottom sheet (translateY 슬라이드업, 상단 rounded corner)

**애니메이션 (Framer Motion):**
- Desktop: `initial={{ opacity: 0, scale: 0.95 }}` → `animate={{ opacity: 1, scale: 1 }}` (0.25s)
- Mobile: `initial={{ y: '100%' }}` → `animate={{ y: 0 }}` (0.3s ease-out)
- 카드 stagger: 각 카드 0.05s 간격 순차 등장

### 4-4. DealerLocator/index.tsx (플로팅 버튼)

**위치:** 화면 우하단 fixed (챗봇 입력창 바로 위)

**상태별 UI:**
```
permissionStatus === 'not_asked':
  → [📍 영업소 찾기] 버튼 (pulse 애니메이션)

permissionStatus === 'pending':
  → [⏳ 위치 확인 중...] 로딩 상태

permissionStatus === 'granted':
  → [📍 대구 사무소 · 12.3km ▶] 확장 버튼
    (영업소명 + 거리 표시, 클릭 → 팝업)

permissionStatus === 'denied' + IP fallback 성공:
  → [📍 영업소 찾기 · 약 230km ▶] 앰버색 거리 표시
```

**트랜지션:** 위치 확인 후 버튼 너비 expand 애니메이션 (0.4s)

---

## 📋 STEP 5 — AI 챗봇 연동

### 5-1. 시스템 프롬프트 추가 내용

ARIA 기존 시스템 프롬프트 끝에 아래 내용 append:

```
=== YG-1 Dealer & Sales Office Knowledge ===

You have complete knowledge of YG-1's global sales network.
Use this information to answer dealer/office/contact questions.

DEALER LIST (name | country | phone | email):
서울 지점 | KR | +82-2-681-3456 | -
대구 사무소 | KR | +82-53-600-8909 | -
천안 사무소 | KR | +82-41-417-0985 | -
부산 사무소 | KR | +82-51-314-0985 | -
창원 사무소 | KR | +82-55-275-0985 | -
QINGDAO YG-1 CUTTING TOOL | CN | +86-532-8676-9779 | china-sales@yg1.kr
YG-1 TOOL SOLUTIONS Shanghai | CN | +86-21-5283-6816 | service@yg1-toolsolutions.cn
YG-1 INDUSTRIES India | IN | +91-80-22044620 | marketing@yg1india.com
YG-1 JAPAN CO., LTD. | JP | +81-6-6305-9897 | t-kitaoka8@yg1.jp
YG-1 TOOLS ASIA Singapore | SG | +65-6842-0468 | yg1toolsasia@yg1.co.kr
YG-1 VIETNAM | VN | +84-24-3795-7233 | bbak98@yg1.co.kr
YG-1 THAILAND | TH | +66-2-370-4945 | cherdchai@yg1.co.th
YG-1 AUSTRALIA | AU | +61-3-9558-0177 | ygone@ygone.com.au
YG-1 Malaysia | MY | +603-5569-9511 | -
PT. YGI TOOLS Indonesia | ID | +62-21-8946-0074 | -
YG-1 Middle East UAE | AE | +971-6-522-1419 | CSR@yg1me.ae
YG-1 Turkey | TR | +90-216-504-8292 | info@yg1.com.tr
YG-1 DEUTSCHLAND GMBH | DE | +49-6173-9667-0 | info@yg-1.de
YG-1 EUROPE SAS France | FR | +33-172-84-4070 | yg1@yg1.eu
herramientas YG-1 Spain | ES | +34-938-297-275 | ventas@yg-1.es
YG-1 Poland | PL | +48-22-622-2586 | info@yg-1.pl
YG-1 AMERICA INC. | US | +1-847-634-3700 | info@yg1usa.com
YG-1 Brazil | BR | +55-11-4496-2170 | vendas@yg1.com.br
YG-1 CANADA Quebec | CA | +1-514-352-6464 | sales@minicut.com
YG-1 CANADA Ontario | CA | +1-905-335-2500 | orders@yg1.ca
YG-1 South Africa | ZA | +27-87-160-0779 | yg1sales@yg1.co.za

RESPONSE RULES FOR DEALER QUESTIONS:
1. Give a brief 1-2 sentence answer with the most relevant dealer info
2. ALWAYS append this JSON marker on a new line at the end:
   {"action":"offer_dealer_popup","region":"<region>","top_dealer":"<name>"}
   - region: korea / china / asia / europe / americas / africa / all
   - top_dealer: the single most relevant dealer name

EXAMPLE:
User: "가까운 영업소 알려줘"
Response:
"현재 위치 기준으로 가장 가까운 영업소는 대구 사무소(+82-53-600-8909)입니다.
더 자세한 정보와 지도를 확인하시겠어요?
{"action":"offer_dealer_popup","region":"korea","top_dealer":"대구 사무소"}"
```

### 5-2. ChatMessage 렌더러 — JSON marker 처리

챗봇 메시지 렌더링 컴포넌트에 아래 로직 추가:

```tsx
// 기존 메시지 렌더러에 추가
function renderMessageContent(content: string) {
  const markerRegex = /\{"action":"offer_dealer_popup","region":"([^"]+)","top_dealer":"([^"]+)"\}/;
  const match = content.match(markerRegex);

  if (!match) return <p className="whitespace-pre-wrap">{content}</p>;

  const cleanText = content.replace(markerRegex, '').trim();
  const [, region, topDealer] = match;

  return (
    <div>
      <p className="whitespace-pre-wrap mb-3">{cleanText}</p>
      <DealerPopupTriggerButton region={region} topDealer={topDealer} />
    </div>
  );
}
```

### 5-3. DealerPopupTriggerButton.tsx

챗봇 말풍선 내부에 렌더링되는 인라인 팝업 열기 버튼:

```typescript
interface DealerPopupTriggerButtonProps {
  region: string;
  topDealer: string;
}
```

**디자인:**
- 말풍선 내부에 자연스럽게 붙는 작은 카드 형태
- 왼쪽: 📍 아이콘 + 영업소명
- 오른쪽: `[영업소 정보 보기 →]` CTA (YG-1 레드)
- 클릭 → DealerPopup 열기 + 해당 region 탭 활성화
- border: 1px solid #C8102E20, border-radius: 8px

---

## 📋 STEP 6 — 전체 UX 시나리오

### 시나리오 A: 정상 GPS 플로우
```
1. ARIA 접속
2. 상단 배너: "위치 정보를 사용해도 될까요?"
3. [위치 허용] 클릭 → 브라우저 GPS 팝업 → 허용
4. 토스트: "✅ 위치 확인됨 (GPS 정확)"
5. 플로팅 버튼: "📍 대구 사무소 · 12.3km"
6. 버튼 클릭 → DealerPopup (국내 탭, Top-3 카드)
```

### 시나리오 B: 챗봇 자연어 플로우
```
1. 사용자: "가까운 영업소 알려줘"
2. ARIA: "가장 가까운 영업소는 대구 사무소입니다."
         + [📍 대구 사무소 | 영업소 정보 보기 →] 인라인 카드
3. 클릭 → DealerPopup (korea 탭, 대구 사무소 1위)
```

### 시나리오 C: GPS 거부 플로우
```
1. [나중에] 또는 GPS 거부
2. IP fallback 자동 시도 → 국가 수준 위치 확인
3. 플로팅 버튼: "📍 영업소 찾기 · 약 230km" (앰버색)
4. 팝업 내: "정확한 거리를 보려면 위치 허용을 클릭해주세요" 안내
5. 챗봇: "지역을 알려주시면 더 정확히 안내해드릴게요." → 지역 선택
```

### 시나리오 D: 해외 사용자
```
1. GPS 허용 (예: 독일 프랑크푸르트)
2. 플로팅 버튼: "📍 YG-1 DEUTSCHLAND · 18km"
3. 사용자: "nearest dealer?"
4. ARIA: "Nearest dealer is YG-1 DEUTSCHLAND GMBH (+49-6173-9667-0)"
         + [📍 YG-1 Germany | View Dealer Info →] 인라인 카드
5. 팝업 → Europe 탭, 독일 법인 1위
```

---

## 🎨 디자인 토큰

```css
/* YG-1 브랜드 시스템 */
--color-primary:       #C8102E;   /* YG-1 레드 — CTA, 1위 뱃지 */
--color-primary-light: #FFE5E8;   /* 레드 연한 버전 */
--color-navy:          #1A1A2E;   /* 팝업 헤더, 다크 배경 */
--color-navy-mid:      #16213E;   /* 카드 hover */

/* 거리 표시 */
--color-gps:           #10B981;   /* GPS 정확 — 초록 */
--color-ip:            #F59E0B;   /* IP 대략 — 앰버 */

/* 순위 뱃지 */
--color-rank-1:        #F59E0B;   /* 금 */
--color-rank-2:        #9CA3AF;   /* 은 */
--color-rank-3:        #B45309;   /* 동 */

/* 팝업 */
--popup-backdrop:      rgba(0, 0, 0, 0.6);
--popup-blur:          blur(8px);
--popup-radius:        16px;
--popup-max-width:     480px;
```

---

## 📋 STEP 7 — 루트 Provider 등록

```tsx
// app/layout.tsx
import { LocationProvider } from '@/context/LocationContext';

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>
        <LocationProvider>
          {children}
        </LocationProvider>
      </body>
    </html>
  );
}
```

---

## 🚀 실행 순서

```
1.  dealers.json 생성 (위 JSON 그대로)
2.  haversine.ts 생성
3.  useNearestDealers.ts 생성
4.  LocationContext.tsx 생성 + layout.tsx에 Provider 등록
5.  LocationPermissionBanner.tsx 구현
6.  DealerCard.tsx 구현
7.  DealerPopup.tsx 구현 (Framer Motion 애니메이션 포함)
8.  DealerLocator/index.tsx 플로팅 버튼 구현
9.  DealerPopupTriggerButton.tsx 구현
10. ARIA 시스템 프롬프트에 dealer knowledge + JSON marker 규칙 추가
11. ChatMessage 렌더러에 marker 감지 → TriggerButton 변환 로직 추가
12. 테스트 체크리스트:
    ✅ GPS 허용 → 플로팅 버튼에 가까운 영업소명 + 거리 표시
    ✅ GPS 거부 → IP fallback 동작, 앰버색 거리 표시
    ✅ "가까운 영업소 알려줘" → 챗봇 답변 + 인라인 TriggerButton
    ✅ TriggerButton 클릭 → 팝업 열림, 해당 지역 탭 활성
    ✅ 팝업 Top-3 카드 거리순 정렬 확인
    ✅ 모바일 bottom sheet 동작 확인
    ✅ ESC / 외부 클릭 → 팝업 닫힘
    ✅ 지도 링크 → Google Maps 정상 열림
    ✅ 전화번호 클릭 → tel: 링크 동작
```

---

## ⚠️ 주의사항

1. **HTTPS 필수** — `navigator.geolocation`은 HTTP에서 차단됨 (Azure App Service 기본 HTTPS OK)
2. **IP Fallback** — `https://ipapi.co/json/` 무료 월 1,000건 제한. 프로덕션 시 상용 API 전환 고려
3. **JSON marker 파싱** — LLM이 JSON을 항상 완벽히 출력하지 않을 수 있음. try-catch + 파싱 실패 시 일반 텍스트 fallback 필수
4. **dealers.json 좌표** — 현재값은 도시 중심 근사치. Nominatim Geocoding으로 정확한 주소 좌표 교체 권장
5. **Framer Motion** — 미설치 시 `npm install framer-motion` 먼저 실행
6. **모바일 bottom sheet** — `window.innerWidth < 768` 기준으로 desktop/mobile 분기 처리
