import { Db, MongoClient, ServerApiVersion } from "mongodb"

const uri = process.env.MONGO_LOG_URI
const dbName = process.env.MONGO_LOG_DB || "yg1_ai_catalog_log"
const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 2500
const DEFAULT_CONNECT_TIMEOUT_MS = 2500
const DEFAULT_SOCKET_TIMEOUT_MS = 10000

declare global {
  // eslint-disable-next-line no-var
  var __mongoLogClientPromise: Promise<MongoClient> | undefined
}

function getTimeoutFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback

  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function createClient(): Promise<MongoClient> {
  if (!uri) {
    throw new Error("MONGO_LOG_URI is not configured")
  }

  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
    serverSelectionTimeoutMS: getTimeoutFromEnv("MONGO_LOG_SERVER_SELECTION_TIMEOUT_MS", DEFAULT_SERVER_SELECTION_TIMEOUT_MS),
    connectTimeoutMS: getTimeoutFromEnv("MONGO_LOG_CONNECT_TIMEOUT_MS", DEFAULT_CONNECT_TIMEOUT_MS),
    socketTimeoutMS: getTimeoutFromEnv("MONGO_LOG_SOCKET_TIMEOUT_MS", DEFAULT_SOCKET_TIMEOUT_MS),
  })

  return client.connect()
}

export function isMongoLogEnabled(): boolean {
  return process.env.MONGO_LOG_ENABLED === "true" && Boolean(uri)
}

export async function getMongoLogDb(): Promise<Db | null> {
  if (!isMongoLogEnabled()) return null

  if (!global.__mongoLogClientPromise) {
    global.__mongoLogClientPromise = createClient().catch(error => {
      global.__mongoLogClientPromise = undefined
      throw error
    })
  }

  const client = await global.__mongoLogClientPromise
  return client.db(dbName)
}
