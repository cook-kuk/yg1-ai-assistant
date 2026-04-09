import { handleRecommendationPost } from "@/lib/recommendation/infrastructure/http/recommendation-http"

// 서버리스 실행 시간 상한. 추천 엔진이 검색/LLM을 함께 쓰므로 기본값보다 길게 잡는다.
export const maxDuration = 120

// /api/recommend POST의 실제 처리는 HTTP 어댑터로 위임한다.
export const POST = handleRecommendationPost
