"use client"

export function createClientEventId(): string {
  const webCrypto = globalThis.crypto
  if (webCrypto?.randomUUID) return webCrypto.randomUUID()

  const timestamp = Date.now().toString(36)
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `evt-${timestamp}-${randomPart}`
}
