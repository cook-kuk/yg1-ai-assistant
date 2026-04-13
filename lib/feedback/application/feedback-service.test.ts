import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FeedbackService } from "@/lib/feedback/application/feedback-service"
import { loadAllFeedbackDataFromMongo } from "@/lib/feedback/infrastructure/persistence/feedback-mongo-read"
import { loadAllFeedbackData } from "@/lib/feedback/infrastructure/storage/feedback-storage"

vi.mock("@/lib/feedback/infrastructure/persistence/feedback-mongo-read", () => ({
  loadAllFeedbackDataFromMongo: vi.fn(),
}))

vi.mock("@/lib/feedback/infrastructure/storage/feedback-storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/feedback/infrastructure/storage/feedback-storage")>(
    "@/lib/feedback/infrastructure/storage/feedback-storage"
  )

  return {
    ...actual,
    loadAllFeedbackData: vi.fn(),
  }
})

describe("FeedbackService.loadAll", () => {
  const originalTimeout = process.env.MONGO_FEEDBACK_LOAD_TIMEOUT_MS

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    if (originalTimeout == null) {
      delete process.env.MONGO_FEEDBACK_LOAD_TIMEOUT_MS
    } else {
      process.env.MONGO_FEEDBACK_LOAD_TIMEOUT_MS = originalTimeout
    }

    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("falls back to local JSON when Mongo load exceeds the timeout", async () => {
    process.env.MONGO_FEEDBACK_LOAD_TIMEOUT_MS = "50"

    vi.mocked(loadAllFeedbackDataFromMongo).mockImplementation(
      () => new Promise(() => undefined)
    )
    vi.mocked(loadAllFeedbackData).mockReturnValue({
      generalEntries: [{ id: "fb-local" } as never],
      feedbackEntries: [{ id: "tf-local" } as never],
    })

    const service = new FeedbackService()
    const pending = service.loadAll()

    await vi.advanceTimersByTimeAsync(50)

    await expect(pending).resolves.toMatchObject({
      generalTotal: 1,
      feedbackTotal: 1,
      generalEntries: [{ id: "fb-local" }],
      feedbackEntries: [{ id: "tf-local" }],
    })
    expect(loadAllFeedbackData).toHaveBeenCalledTimes(1)
  })

  it("keeps Mongo data when it resolves before the timeout", async () => {
    process.env.MONGO_FEEDBACK_LOAD_TIMEOUT_MS = "50"

    vi.mocked(loadAllFeedbackDataFromMongo).mockResolvedValue({
      generalEntries: [{ id: "fb-mongo" } as never],
      feedbackEntries: [{ id: "tf-mongo" } as never],
    })
    vi.mocked(loadAllFeedbackData).mockReturnValue({
      generalEntries: [{ id: "fb-local" } as never],
      feedbackEntries: [{ id: "tf-local" } as never],
    })

    const service = new FeedbackService()

    await expect(service.loadAll()).resolves.toMatchObject({
      generalTotal: 1,
      feedbackTotal: 1,
      generalEntries: [{ id: "fb-mongo" }],
      feedbackEntries: [{ id: "tf-mongo" }],
    })
    expect(loadAllFeedbackData).not.toHaveBeenCalled()
  })
})
