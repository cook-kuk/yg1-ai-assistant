# Simulator v3 배포 체크리스트

## 코드 품질
- [ ] `npx tsc --noEmit` EXIT 0
- [ ] `npx vitest run` 시뮬 관련 테스트 통과
- [ ] `npm run lint` 실행 (기존 경고 허용)
- [ ] `npm run build` 성공 + 번들 크기 확인

## 환경 설정
- [ ] .env.local에 ANTHROPIC_API_KEY 설정
- [ ] SENTRY_DSN 선택 설정
- [ ] (선택) 모델 오버라이드 env

## Git 정책
- [ ] origin push + company push (CLAUDE.md 규칙)
- [ ] main 브랜치 forced push 금지

## 런타임 확인
- [ ] http://40.82.129.113:3000/simulator_v2 HTTP 200
- [ ] /simulator_v2/glossary HTTP 200
- [ ] AI 코치 실제 응답 확인 (한국어)
- [ ] 3D 씬 토글 정상 렌더
- [ ] 모바일 뷰포트 (360px) 확인

## 회귀 검증
- [ ] 기존 /recommend, /edp 엔드포인트 건드린 것 없음
- [ ] cutting-calculator.ts 공식 로직 변경 없음
- [ ] SimulatorState 필드 삭제 없음
