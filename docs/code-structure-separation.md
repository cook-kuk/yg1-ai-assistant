# Code Structure Separation

## 목적

이 문서는 `yg1-ai-catalog`에서 추천 엔진과 UI 및 기타 기능을 장기적으로 분리 관리하기 위한 코드 구조 원칙을 정의한다.

현재 프로젝트는 Next.js App Router 기반 단일 저장소이지만, 실제 코드 결합은 다음과 같이 강하다.

- 프론트엔드가 추천 엔진의 내부 세션 구조를 직접 참조한다.
- API route가 단순 transport 계층이 아니라 엔진 구현과 화면 표시 계약을 동시에 담당한다.
- `lib/types/exploration.ts` 같은 내부 타입이 서버와 클라이언트에서 함께 소비된다.
- 추천 엔진 변경이 UI 변경으로, UI 확장이 엔진 세션 구조 변경으로 곧바로 이어진다.

이 구조는 다음 상황에서 유지보수 비용이 급격히 증가한다.

- `serve` 엔진은 유지하고 `main` UI만 올리고 싶을 때
- 추천 엔진을 여러 버전으로 운영하고 싶을 때
- `/api/recommend` 외 기능(`/api/chat`, 피드백, Slack, 일반 조회 기능 등)을 독립적으로 발전시키고 싶을 때

이 문서의 목표는 "프로젝트를 물리적으로 여러 저장소로 쪼개는 것"이 아니라, 먼저 "코드 경계와 계약을 분리하는 것"이다.

## 결론

이 프로젝트는 최소한 다음 3계층으로 분리하는 것이 맞다.

1. `frontend`
2. `backend`
3. `shared contract`

여기서 중요한 것은 디렉터리 이름보다 경계다.

- `frontend`는 화면, 사용자 입력, 렌더링 상태만 책임진다.
- `backend`는 추천 엔진, 세션 상태 머신, LLM/tool-use, DB 접근, 오케스트레이션을 책임진다.
- `shared contract`는 요청/응답 DTO와 capability 선언만 가진다.

핵심 원칙은 다음 한 줄로 요약된다.

`UI는 추천 엔진의 내부 타입을 몰라야 한다.`

## 현재 결합 지점

현재 특히 강하게 묶여 있는 지점은 다음과 같다.

- `app/products/page.tsx`
- `app/api/recommend/route.ts`
- `app/api/chat/route.ts`
- `lib/types/exploration.ts`
- `lib/domain/session-manager.ts`
- `lib/agents/*`

문제는 프론트가 단순히 API 응답을 그리는 수준이 아니라, 서버 내부 세션 구조를 전제로 UI를 조립하고 있다는 점이다.

예시:

- `displayedCandidates`
- `displayedProducts`
- `displayedSeriesGroups`
- `taskHistory`
- `currentTask`
- `uiNarrowingPath`
- `pendingIntents`

이 값들은 원래 엔진 내부 상태에 가깝다. 이런 필드를 프론트가 직접 알게 되면, 추천 엔진 구현이 바뀌는 순간 UI 계약도 함께 바뀐다.

## 목표 아키텍처

권장 방향은 `Hexagonal Architecture (Ports and Adapters)`를 기본으로 하고, API 계층에는 `DTO + Presenter + Adapter` 패턴을 적용하는 것이다.

### 1. Frontend

역할:

- 페이지/컴포넌트 렌더링
- 사용자 이벤트 처리
- 폼 상태 및 표시용 UI 상태 관리
- API 호출
- 응답 DTO를 ViewModel로 변환

금지:

- 추천 엔진 내부 상태 타입 import
- DB 모델 import
- 엔진 액션 타입에 의존한 분기 처리
- 엔진 구현 상세를 전제로 한 UI 로직 작성

### 2. Backend

역할:

- 추천 엔진 실행
- 세션 상태 전이
- 질문 선택
- 후보 검색/정렬/복원
- LLM 라우팅 및 검증
- 데이터 접근

금지:

- React 컴포넌트용 표시 형식을 직접 책임지는 것
- 페이지 특화 UI 상태를 엔진 내부 상태에 섞는 것

### 3. Shared Contract

역할:

- API request/response DTO 정의
- zod schema 또는 validator 정의
- capability field 정의
- backend와 frontend 사이의 안정된 계약 제공

금지:

- 엔진 내부 mutable state 저장
- DB row 타입 노출
- 특정 UI 컴포넌트 전용 임시 필드 누적

## 추천하는 디렉터리 방향

아래는 한 번에 완성할 최종형이라기보다 목표 구조다.

```text
app/
  api/
    recommend/
      route.ts
    chat/
      route.ts

src/
  frontend/
    pages/
    features/
      recommendation/
        components/
        hooks/
        view-models/
    shared/
      ui/

  backend/
    recommendation/
      application/
        ports/
        services/
        commands/
      domain/
        entities/
        session/
        policies/
      infrastructure/
        engines/
          serve-engine/
          main-engine/
        repositories/
        llm/
        presenters/
    chat/
      application/
      domain/
      infrastructure/

  contracts/
    recommendation/
      request.ts
      response.ts
    chat/
      request.ts
      response.ts
```

현재 레포에서는 `src/`를 새로 도입하지 않아도 된다. 다만 최소한 다음 분리는 필요하다.

- `lib/recommendation/domain`
- `lib/recommendation/application`
- `lib/recommendation/infrastructure`
- `lib/contracts`
- `lib/frontend` 또는 `features/recommendation`

## 적용해야 할 디자인 패턴

### 1. Ports and Adapters

추천 엔진은 공통 인터페이스를 구현해야 한다.

예시:

```ts
export interface RecommendationEnginePort {
  start(command: RecommendStartCommand): Promise<RecommendResponseDto>
  continue(command: RecommendContinueCommand): Promise<RecommendResponseDto>
}
```

이 인터페이스를 기준으로:

- `serve` 엔진 구현
- `main` 엔진 구현
- 향후 `v2` 엔진 구현

을 바꿔 끼울 수 있어야 한다.

### 2. DTO Contract-First

프론트는 엔진 내부 타입이 아니라 API DTO만 알아야 한다.

예시:

```ts
export interface RecommendResponseDto {
  text: string
  recommendation: RecommendationSummary | null
  candidates: CandidateCardItem[]
  uiState: RecommendationUiState
  capabilities: RecommendationCapabilities
}
```

여기서 중요한 점:

- `ExplorationSessionState` 전체를 노출하지 않는다.
- 프론트에 필요한 정보만 노출한다.
- 내부 엔진 필드명과 API 필드명은 동일할 필요가 없다.

### 3. Anti-Corruption Layer

엔진 결과와 UI 계약 사이에는 변환 계층이 있어야 한다.

예시:

```ts
function mapServeEngineResultToDto(result: ServeEngineResult): RecommendResponseDto
function mapMainEngineResultToDto(result: MainEngineResult): RecommendResponseDto
```

이 계층이 필요한 이유:

- `serve`는 `displayedCandidates`
- `main`은 `displayedProducts`, `displayedSeriesGroups`, `taskHistory`

처럼 결과 구조가 다르기 때문이다.

프론트는 이 차이를 절대 직접 처리하지 않는다.

### 4. Presenter / ViewModel

백엔드는 "엔진 상태"를 만들고, API presenter는 "화면에 필요한 응답"으로 바꾼다.

프론트는 다시 이를 "컴포넌트 표시용 view model"로 바꾼다.

즉 다음 3단계를 분리한다.

1. Engine State
2. API DTO
3. UI ViewModel

## API 계약 원칙

향후 `/api/recommend`는 엔진 내부 상태를 raw JSON으로 그대로 내보내지 않는다.

권장 응답 예시:

```ts
type RecommendResponseDto = {
  text: string
  recommendation: RecommendationSummary | null
  candidates: CandidateCardItem[]
  followUpChips: string[]
  uiState: {
    sessionId: string | null
    candidateCount: number
    resolutionStatus: "broad" | "narrowing" | "resolved" | "none"
    appliedFilters: Array<{ field: string; value: string }>
  }
  capabilities: {
    canCompare: boolean
    canRestoreTask: boolean
    canGroupBySeries: boolean
    canFilterDisplayed: boolean
  }
  meta?: {
    requestPreparation?: unknown
    explanation?: unknown
    factCheck?: unknown
  }
}
```

중요:

- `capabilities`로 지원 기능을 명시한다.
- 프론트는 필드 존재 여부로 엔진 종류를 추론하지 않는다.
- `taskHistory`, `displayedSeriesGroups` 같은 세부 구조는 가능하면 `uiState` 내부 하위 DTO로 재정의한다.

## 세션 상태 원칙

세션 상태는 2종류로 나눠야 한다.

### 1. Engine Session State

용도:

- 내부 상태 전이
- 복원
- 검증
- 오케스트레이션

특징:

- 서버 전용
- 구조가 자주 변할 수 있음
- 엔진 버전별로 달라도 됨

### 2. Public Session DTO

용도:

- 프론트가 지금 어떤 단계인지 표시
- 다음 행동 가능 여부 판단
- 화면 복원에 필요한 최소 정보 제공

특징:

- 공개 계약
- 가능한 안정적으로 유지
- 엔진 교체와 독립적이어야 함

즉, `Engine Session State !== Public Session DTO`여야 한다.

## 추천하는 실제 코드 규칙

### 규칙 1

프론트 파일에서 아래 import를 직접 하지 않는다.

- `lib/agents/*`
- `lib/domain/session-manager`
- `lib/types/exploration`
- DB repo 타입

### 규칙 2

`app/api/recommend/route.ts`는 orchestration을 직접 다 들고 있지 않는다.

역할을 아래로 축소한다.

1. request parse
2. contract validation
3. engine 선택
4. presenter 호출
5. DTO 반환

### 규칙 3

추천 엔진 내부 로직은 route handler에서 분리한다.

예시:

- `backend/recommendation/application/recommendation-service.ts`
- `backend/recommendation/infrastructure/engines/serve-engine.ts`
- `backend/recommendation/infrastructure/engines/main-engine.ts`

### 규칙 4

엔진별 feature 차이는 DTO의 `capabilities`로 노출한다.

예시:

- `serve` 엔진: `canRestoreTask = false`
- `main` 엔진: `canRestoreTask = true`

프론트는 이 값만 보고 버튼/패널을 켜거나 끈다.

### 규칙 5

공용 contract는 zod 등으로 런타임 검증한다.

이유:

- 추천 엔진 교체 시 UI가 조용히 깨지는 문제 방지
- 브랜치 간 DTO drift 조기 발견

## 단계별 마이그레이션 전략

한 번에 대수술하지 않는다.

### Phase 1. Contract 분리

우선 할 일:

- `lib/contracts/recommendation.ts` 생성
- `/api/recommend` 응답 DTO 정의
- 프론트는 DTO만 읽도록 변경

목표:

- 프론트가 `ExplorationSessionState` 직접 참조하지 않도록 시작

### Phase 2. Presenter 도입

우선 할 일:

- `serve` 결과 -> DTO mapper
- `main` 결과 -> DTO mapper

목표:

- 엔진 내부 필드명이 프론트로 새지 않도록 차단

### Phase 3. Engine Port 도입

우선 할 일:

- `RecommendationEnginePort` 도입
- `serve` 엔진 구현 분리
- `main` 엔진 구현 분리

목표:

- 엔진 선택이 전략 패턴처럼 가능해짐

### Phase 4. Route Slimming

우선 할 일:

- `app/api/recommend/route.ts`를 thin controller로 축소

목표:

- route가 더 이상 엔진 본체가 아님

### Phase 5. UI Capability 전환

우선 할 일:

- 프론트가 raw session field가 아니라 `capabilities` 기준으로 렌더링

목표:

- `serve` 엔진과 `main` UI 조합 가능

## 이 프로젝트에서의 실천 우선순위

현재 기준 가장 먼저 해야 하는 작업 순서는 아래와 같다.

1. `app/products/page.tsx`가 직접 기대는 추천 세션 필드 목록을 정리한다.
2. `/api/recommend`의 공개 응답 DTO를 정의한다.
3. `serve`, `main` 응답을 DTO로 변환하는 mapper를 만든다.
4. 프론트에서 `lib/types/exploration.ts` 직접 참조를 제거한다.
5. 그 다음에야 엔진 분리 또는 저장소 분리를 논의한다.

## 하지 말아야 할 것

- UI와 backend를 파일 위치만 나누고 타입은 계속 공유하는 것
- route handler에 엔진 로직을 계속 추가하는 것
- 엔진 내부 state를 그대로 JSON 응답으로 공개하는 것
- "필드가 있으면 이 엔진, 없으면 저 엔진" 같은 추론식 UI 작성
- `serve`와 `main`의 차이를 프론트 조건문으로 계속 흡수하는 것

## 최종 판단 기준

구조 분리가 잘 된 상태인지 여부는 아래 질문으로 판단한다.

### 체크리스트

- 프론트가 추천 엔진 내부 타입을 import하지 않는가
- `/api/recommend` 응답 스키마가 문서화되어 있는가
- `serve`와 `main` 엔진이 같은 port를 구현하는가
- 응답 변환 mapper가 엔진별로 존재하는가
- 프론트가 `capabilities`만 보고 기능 노출 여부를 결정하는가
- route handler가 thin controller 역할만 하는가

위 질문에 대부분 `yes`가 나오면, 그때부터는 추천 엔진과 UI를 별도 속도로 관리할 수 있다.

## 요약

이 프로젝트에서 필요한 분리 방향은 단순한 `frontend/backend 폴더 분리`가 아니다.

필요한 것은 아래 조합이다.

- `frontend / backend / shared contract` 경계 분리
- `Ports and Adapters`
- `DTO Contract-First`
- `Anti-Corruption Layer`
- `Presenter / ViewModel`

실제 우선순위는 항상 같다.

`폴더 분리보다 계약 분리가 먼저다.`
