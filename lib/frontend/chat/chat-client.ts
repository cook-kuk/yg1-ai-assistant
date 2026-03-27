import { chatResponseSchema, type ChatResponseDto } from "@/lib/contracts/chat"

export function parseChatResponse(payload: unknown): ChatResponseDto {
  return chatResponseSchema.parse(payload) as ChatResponseDto
}
