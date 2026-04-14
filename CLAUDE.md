## 핵심 규칙 (모든 작업에 적용)

### 코딩 원칙
- 하드코딩 금지. 모든 매직넘버는 config + envNum() 패턴
- 키워드는 patterns.ts SSOT에서만 관리
- 브랜드는 canonical-values.ts SSOT에서만 관리
- legacy 네이밍(haiku/sonnet/opus) 리팩토링은 명시 지시 전까지 금지

### LLM 설정
- 현재 OpenAI GPT-5.4 사용 중 (Anthropic 아님)
- provider.ts의 tier 네이밍은 건드리지 말 것
- 새 코드는 llm-executor.ts 래퍼 사용

### DB
- PostgreSQL: smart_catalog@20.119.98.136:5432/smart_catalog
- 공유 풀: getSharedPool() 사용, 새 Pool 생성 금지
- MongoDB: 피드백 로그용

### Git
- origin push 후 반드시 company push도 할 것
- response-composer gpt-5-mini 전환은 push 보류

### 작업 방식
- 매 Phase 끝에 npx tsc --noEmit 타입체크
- 전부 끝나면 npm run build
- 테스트 파일 변경 시 vitest run 확인
