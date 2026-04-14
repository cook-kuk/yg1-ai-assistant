/**
 * Session Cache — In-memory TTL cache for DB query results within a session.
 *
 * Reduces redundant DB calls for series profiles, product lookups,
 * and brand references that don't change within a session.
 *
 * NOT for: inventory (real-time), search results (filter-dependent).
 */

import { SESSION_CACHE } from "@/lib/recommendation/infrastructure/config/cache-config"

export class SessionCache {
  private cache = new Map<string, { data: unknown; timestamp: number }>()
  private ttl: number

  constructor(ttlMs: number = SESSION_CACHE.ttlMs) {
    this.ttl = ttlMs
  }

  /** Get cached value or fetch and cache it */
  async getOrFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.data as T
    }
    const data = await fetcher()
    this.cache.set(key, { data, timestamp: Date.now() })
    return data
  }

  /** Get cached value if available (no fetch) */
  get<T>(key: string): T | undefined {
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.data as T
    }
    return undefined
  }

  /** Manually set a cached value */
  set(key: string, data: unknown): void {
    this.cache.set(key, { data, timestamp: Date.now() })
  }

  /** Check if key exists and is valid */
  has(key: string): boolean {
    const cached = this.cache.get(key)
    return !!cached && Date.now() - cached.timestamp < this.ttl
  }

  /** Clear all cached data */
  clear(): void {
    this.cache.clear()
  }

  /** Get cache statistics */
  stats(): { size: number; keys: string[] } {
    // Prune expired entries first
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp >= this.ttl) {
        this.cache.delete(key)
      }
    }
    return { size: this.cache.size, keys: Array.from(this.cache.keys()) }
  }
}

/** Global session cache instance (reset per session) */
let _sessionCache: SessionCache | null = null

export function getSessionCache(): SessionCache {
  if (!_sessionCache) {
    _sessionCache = new SessionCache()
  }
  return _sessionCache
}

export function resetSessionCache(): void {
  _sessionCache = null
}
