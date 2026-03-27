# Claude Code Prompt — YG-1 ARIA Dealer Locator Feature

---

## 🎯 목표

YG-1 공식 사이트(`https://brand.yg1.solutions/kr/support/domestic.do`)에서
전 세계 판매법인/영업소 데이터를 크롤링하고,
GPS 기반 거리 계산으로 가까운 영업소를 추천하는 기능을
ARIA 챗봇 시스템에 통합해줘.

---

## 📋 STEP 1 — 데이터 크롤링 & 좌표 매핑

### 1-1. 크롤링 대상
아래 URL에서 탭별 영업소 정보를 전부 수집해줘:
- **URL**: `https://brand.yg1.solutions/kr/support/domestic.do`
- **대상 탭**: 한국본사, 아시아, 중국, 유럽, 미주, 아프리카

### 1-2. 크롤링 방식
Playwright를 사용해서 각 탭을 클릭하며 데이터 수집:
```bash
npm install playwright
npx playwright install chromium
```

각 영업소에서 다음 정보 추출:
- 영업소명 (한국어 + 영어)
- 국가 / 지역
- 주소 (전체 주소)
- 전화번호
- 이메일
- 담당 지역

### 1-3. 좌표 매핑
수집한 주소를 **Nominatim (OpenStreetMap)** 으로 위도/경도 변환 — API 키 없음, 완전 무료:
```
https://nominatim.openstreetmap.org/search?q={주소}&format=json&limit=1
```
⚠️ Nominatim 이용 정책상 요청 사이 **1초 딜레이** 필수:
```typescript
// geocode_dealers.ts
async function geocode(address: string) {
  await sleep(1100); // 초당 1건 제한 준수
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
    { headers: { 'User-Agent': 'YG1-ARIA-DealerLocator/1.0' } } // User-Agent 필수
  );
  const data = await res.json();
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}
```

결과를 `dealers.json`으로 저장:
```json
[
  {
    "id": "KR_HQ",
    "name": "YG-1 한국본사",
    "name_en": "YG-1 Korea HQ",
    "region": "korea",
    "country": "KR",
    "address": "인천광역시 ...",
    "phone": "+82-32-...",
    "email": "...",
    "lat": 37.4563,
    "lng": 126.7052
  }
]
```

---

## 📋 STEP 2 — 챗봇 위치 권한 초기화

### 2-1. 챗봇 시작 시 위치 동의 요청
챗봇이 처음 열릴 때 (onMount 또는 초기 메시지) 아래 흐름 구현:

```
챗봇 오픈
    ↓
시스템 메시지: "더 정확한 서비스를 위해 현재 위치 정보를 사용해도 될까요?
                가까운 YG-1 영업소를 바로 안내해드릴 수 있습니다."
    ↓
[허용] 버튼 클릭 → navigator.geolocation.getCurrentPosition() 호출
                 → 위도/경도 세션 context에 저장
                 → "위치가 확인되었습니다. 무엇을 도와드릴까요?"
    ↓
[거부] 버튼 클릭 → IP 기반 fallback (ipapi.co 또는 ip-api.com 무료 API)
                 → 또는 "지역을 알려주시면 가까운 영업소를 찾아드릴게요."
```

### 2-2. 위치 데이터 세션 관리
```typescript
// types/location.ts
interface UserLocation {
  lat: number;
  lng: number;
  source: 'gps' | 'ip' | 'manual';
  accuracy?: number;
}
```

세션 동안 위치 재요청 없이 저장된 좌표 재사용.
컴포넌트 간 공유는 Context API 또는 Zustand store 사용.

---

## 📋 STEP 3 — Haversine 거리 계산 Tool

### 3-1. 유틸 함수
```typescript
// utils/haversine.ts
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371; // 지구 반경 km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
```

### 3-2. LangGraph Agent Tool 등록
```python
# tools/dealer_locator.py
from langchain.tools import tool

@tool
def find_nearest_dealers(
    user_lat: float,
    user_lng: float,
    region_filter: str = "all",  # "korea", "asia", "europe", "americas", "china", "africa"
    top_k: int = 3
) -> list[dict]:
    """
    사용자 GPS 위치 기반으로 가장 가까운 YG-1 영업소를 반환합니다.
    
    Args:
        user_lat: 사용자 위도
        user_lng: 사용자 경도  
        region_filter: 특정 지역으로 필터링 (기본값: 전체)
        top_k: 반환할 영업소 수 (기본값: 3)
    
    Returns:
        거리순 정렬된 영업소 리스트 (이름, 주소, 전화, 거리)
    """
    dealers = load_dealers_json()  # dealers.json 로드
    
    if region_filter != "all":
        dealers = [d for d in dealers if d["region"] == region_filter]
    
    for dealer in dealers:
        dealer["distance_km"] = haversine(user_lat, user_lng, dealer["lat"], dealer["lng"])
    
    return sorted(dealers, key=lambda x: x["distance_km"])[:top_k]
```

---

## 📋 STEP 4 — 챗봇 UI 컴포넌트

### 4-1. 영업소 추천 카드 UI
영업소 추천 결과를 채팅창에서 카드 형태로 표시:

```tsx
// components/DealerCard.tsx
interface DealerCardProps {
  name: string;
  address: string;
  phone: string;
  email: string;
  distance_km: number;
  lat: number;
  lng: number;
}

// 카드에 표시할 정보:
// - 영업소명 (국기 이모지 + 이름)
// - 거리 (예: 2.3km / 1,240km)
// - 주소
// - 전화번호 (클릭 시 tel: 링크)
// - [지도에서 보기] 버튼 → Google Maps 또는 Kakao Map 링크
```

### 4-2. 위치 허용 초기 메시지 UI
```tsx
// components/LocationPermissionBanner.tsx
// 챗봇 첫 메시지로 표시되는 위치 동의 배너
// [📍 위치 허용] [나중에] 두 버튼 포함
```

---

## 📋 STEP 5 — Agent Intent 처리

### 5-1. 영업소 관련 인텐트 감지
LangGraph router에 아래 케이스 추가:
- "가까운 영업소", "근처 대리점", "판매점 어디", "영업소 찾아줘"
- "유럽 영업소", "미국 대리점", "중국 판매점" (지역 명시)
- "nearest dealer", "sales office", "where to buy"

### 5-2. Agent 처리 흐름
```
사용자: "가까운 영업소 알려줘"
    ↓
Router: dealer_locator intent 감지
    ↓
Context에서 user_location 확인
    ↓ (있으면)
find_nearest_dealers(user_lat, user_lng) 호출
    ↓
DealerCard 컴포넌트로 결과 렌더링
    ↓ (없으면)
"위치 정보가 없어요. 지역을 알려주시겠어요?" → 수동 입력 처리
```

---

## 📋 STEP 6 — 파일 구조 (최종)

```
/
├── data/
│   └── dealers.json              # 크롤링 결과 + 좌표 매핑
├── scripts/
│   └── crawl_dealers.ts          # Playwright 크롤러
│   └── geocode_dealers.ts        # 주소 → 좌표 변환
├── utils/
│   └── haversine.ts              # 거리 계산
├── tools/
│   └── dealer_locator.py         # LangGraph tool
├── components/
│   ├── DealerCard.tsx            # 영업소 카드 UI
│   └── LocationPermissionBanner.tsx  # 위치 동의 UI
└── context/
    └── LocationContext.tsx       # GPS 좌표 세션 관리
```

---

## ⚠️ 주의사항

1. **Geocoding**: Nominatim (OpenStreetMap) 사용 — API 키 없음, 완전 무료. User-Agent 헤더 필수, 요청 간 1초 딜레이 필수
2. **dealers.json 갱신 주기**: 영업소 데이터가 바뀔 경우 크롤러 재실행 필요 → cron job 고려
3. **HTTPS 필수**: `navigator.geolocation`은 HTTPS 환경에서만 작동
4. **권한 거부 처리**: IP fallback은 `https://ipapi.co/json/` 무료 API 활용 가능
5. **크롤링 실패 시**: YG-1 측에 영업소 데이터 엑셀/JSON으로 직접 요청하는 것도 고려

---

## 🚀 실행 순서 요약

```
1. npx playwright crawl_dealers.ts 실행 → dealers_raw.json 생성
2. npx ts-node geocode_dealers.ts 실행 → dealers.json 생성 (좌표 포함)
3. dealer_locator.py tool을 LangGraph agent에 등록
4. LocationContext.tsx 챗봇 루트에 Provider로 감싸기
5. 챗봇 초기화 시 LocationPermissionBanner 표시
6. Router에 dealer_locator intent 추가
7. 테스트: "가까운 영업소 찾아줘" 입력 → DealerCard 3개 출력 확인
```
