# Simulator v3 환경변수 전체 가이드

## 필수 (없으면 주요 기능 비활성)

### ANTHROPIC_API_KEY (서버 전용)
- **용도**: 6개 AI API 전부 (coach, nl-query, explain-warning, optimize, auto-agent, chat)
- **형식**: `sk-ant-api03-...`
- **없으면**: 각 API가 500 에러 "ANTHROPIC_API_KEY not configured" 반환
- **비용**: 매월 Anthropic 콘솔에서 확인

## 선택적 (기본값 있음)

### ANTHROPIC_COACH_MODEL (서버)
- **기본값**: `claude-sonnet-4-6`
- **용도**: AI 코치 + 채팅 모델 오버라이드
- **예시**: `claude-opus-4-7` 또는 `claude-haiku-4-5-20251001`

### ANTHROPIC_SONNET_MODEL / ANTHROPIC_AUTO_AGENT_MODEL (서버)
- (동일 패턴)

### SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN
- **용도**: 프로덕션 에러 모니터링
- **없으면**: init 스킵, 로깅 비활성

### LOG_LEVEL (서버, Pino)
- **기본값**: dev="debug", prod="info"
- **옵션**: trace/debug/info/warn/error

## 데이터베이스 (기존)

### DATABASE_URL (PostgreSQL)
- **형식**: `postgresql://user:pass@host:port/db`
- **현재**: smart_catalog@20.119.98.136:5432/smart_catalog

### MONGO_LOG_URI (선택)

## 배포

### MAIN_HOST / MAIN_USER / MAIN_PASSWORD / MAIN_PATH (GitHub Secrets)
- **용도**: GitHub Actions sshpass 배포 (main branch auto)
