import { Db, MongoClient, ServerApiVersion } from "mongodb"

const uri = process.env.MONGO_LOG_URI
const dbName = process.env.MONGO_LOG_DB || "yg1_ai_catalog_log"

declare global {
  // eslint-disable-next-line no-var
  var __mongoLogClientPromise: Promise<MongoClient> | undefined
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
