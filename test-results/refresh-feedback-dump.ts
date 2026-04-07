import fs from "fs"
import path from "path"
import { loadAllFeedbackDataFromMongo } from "@/lib/feedback/infrastructure/persistence/feedback-mongo-read"

async function main() {
  const data = await loadAllFeedbackDataFromMongo()
  if (!data) {
    console.error("Mongo connection failed (loadAllFeedbackDataFromMongo returned null)")
    process.exit(1)
  }
  const out = path.join(__dirname, "feedback-full-dump.json")
  fs.writeFileSync(out, JSON.stringify(data, null, 2))
  console.log(`wrote ${out}`)
  console.log(`generalEntries: ${data.generalEntries.length}`)
  console.log(`feedbackEntries: ${data.feedbackEntries.length}`)
}

main().catch(e => { console.error(e); process.exit(1) })
