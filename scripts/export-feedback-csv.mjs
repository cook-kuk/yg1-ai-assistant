/**
 * 의견남기기 + 대화 피드백 데이터를 CSV로 내보내기
 * Usage: node scripts/export-feedback-csv.mjs
 */

const API = "http://20.119.98.136:3001/api/feedback"

async function fetchAll() {
  // 의견남기기 (generalEntries) + 대화 피드백 (feedbackEntries)
  const res = await fetch(`${API}?page=1&pageSize=9999`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

function escapeCSV(val) {
  if (val == null) return ""
  const s = String(val)
  return `"${s.replace(/"/g, '""')}"`
}

function formatChat(chatHistory) {
  if (!chatHistory || !Array.isArray(chatHistory) || chatHistory.length === 0) return ""
  return chatHistory.map(m => `[${m.role}] ${m.text || ""}`).join("\n")
}

function formatConversation(snapshot) {
  if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) return ""
  return snapshot.map(m => `[${m.role}] ${m.text || ""}`).join("\n")
}

async function main() {
  console.log("Fetching data from API...")
  const data = await fetchAll()

  const generalEntries = data.generalEntries || []
  const feedbackEntries = data.feedbackEntries || []

  console.log(`의견남기기: ${generalEntries.length}건, 대화피드백: ${feedbackEntries.length}건`)

  // ── 의견남기기 CSV ──
  const generalHeaders = [
    "No", "일자", "유형", "소속부서", "작성자", "작성자유형",
    "평점", "의견내용", "태그", "세션ID",
    "대화내용"
  ]

  const generalRows = generalEntries.map((e, i) => {
    const deptMatch = e.authorName?.match(/^\[(.+?)\]\s*(.+)$/)
    const dept = deptMatch?.[1] ?? ""
    const author = deptMatch?.[2] ?? e.authorName ?? ""
    const chat = formatChat(e.chatHistory)

    return [
      i + 1,
      e.timestamp || "",
      "의견남기기",
      dept,
      author,
      e.authorType || "",
      e.rating ?? "",
      e.comment || "",
      (e.tags || []).join(", "),
      e.sessionId || "",
      chat
    ].map(escapeCSV).join(",")
  })

  // ── 대화 피드백 CSV ──
  const eventHeaders = [
    "No", "일자", "유형", "피드백", "모드",
    "사용자메시지", "AI응답", "사용자코멘트",
    "세션ID", "턴번호",
    "대화내용"
  ]

  const eventRows = feedbackEntries.map((e, i) => {
    const typeName = e.type === "success_case" ? "좋은사례"
      : e.type === "failure_case" ? "문제사례"
      : "대화피드백"

    const feedback = e.feedback || e.responseFeedback || ""
    const userMsg = e.userMessage || e.lastUserMessage || ""
    const aiMsg = e.aiResponse || e.lastAiResponse || ""
    const chat = formatChat(e.chatHistory)
      || formatConversation(e.conversationSnapshot)
      || ""

    return [
      i + 1,
      e.timestamp || "",
      typeName,
      feedback,
      e.mode || "",
      userMsg,
      aiMsg,
      e.userComment || "",
      e.sessionId || "",
      e.turnNumber ?? "",
      chat
    ].map(escapeCSV).join(",")
  })

  // Write files
  const { writeFileSync } = await import("fs")
  const BOM = "\uFEFF"
  const date = new Date().toISOString().slice(0, 10)

  const generalCSV = BOM + [generalHeaders.join(","), ...generalRows].join("\n")
  const generalPath = `feedback_의견남기기_${date}.csv`
  writeFileSync(generalPath, generalCSV, "utf-8")
  console.log(`✓ ${generalPath} (${generalEntries.length}건)`)

  const eventCSV = BOM + [eventHeaders.join(","), ...eventRows].join("\n")
  const eventPath = `feedback_대화피드백_${date}.csv`
  writeFileSync(eventPath, eventCSV, "utf-8")
  console.log(`✓ ${eventPath} (${feedbackEntries.length}건)`)

  // 통합본도 생성
  const allHeaders = [
    "No", "일자", "유형", "소속부서", "작성자", "작성자유형",
    "평점/피드백", "모드", "의견/코멘트", "태그",
    "사용자메시지", "AI응답", "세션ID",
    "대화내용"
  ]

  let no = 0
  const allRows = []

  for (const e of generalEntries) {
    no++
    const deptMatch = e.authorName?.match(/^\[(.+?)\]\s*(.+)$/)
    const dept = deptMatch?.[1] ?? ""
    const author = deptMatch?.[2] ?? e.authorName ?? ""
    const lastUserMsg = (e.chatHistory || []).filter(m => m.role === "user").pop()?.text ?? ""
    const lastAiMsg = (e.chatHistory || []).filter(m => m.role === "assistant").pop()?.text ?? ""

    allRows.push([
      no, e.timestamp || "", "의견남기기", dept, author, e.authorType || "",
      e.rating ?? "", "",
      e.comment || "", (e.tags || []).join(", "),
      lastUserMsg, lastAiMsg,
      e.sessionId || "",
      formatChat(e.chatHistory)
    ].map(escapeCSV).join(","))
  }

  for (const e of feedbackEntries) {
    no++
    const typeName = e.type === "success_case" ? "좋은사례"
      : e.type === "failure_case" ? "문제사례" : "대화피드백"
    const fb = e.feedback || e.responseFeedback || ""
    const userMsg = e.userMessage || e.lastUserMessage || ""
    const aiMsg = e.aiResponse || e.lastAiResponse || ""
    const chat = formatChat(e.chatHistory) || formatConversation(e.conversationSnapshot) || ""

    allRows.push([
      no, e.timestamp || "", typeName, "", "", "",
      fb, e.mode || "",
      e.userComment || "", "",
      userMsg, aiMsg,
      e.sessionId || "",
      chat
    ].map(escapeCSV).join(","))
  }

  const allCSV = BOM + [allHeaders.join(","), ...allRows].join("\n")
  const allPath = `feedback_전체_${date}.csv`
  writeFileSync(allPath, allCSV, "utf-8")
  console.log(`✓ ${allPath} (${no}건 통합)`)
}

main().catch(err => { console.error("Error:", err.message); process.exit(1) })
