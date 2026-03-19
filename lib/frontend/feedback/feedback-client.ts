import { feedbackListResponseSchema, type FeedbackListResponseDto } from "@/lib/contracts/feedback"

export function parseFeedbackListResponse(payload: unknown): FeedbackListResponseDto {
  return feedbackListResponseSchema.parse(payload) as FeedbackListResponseDto
}
