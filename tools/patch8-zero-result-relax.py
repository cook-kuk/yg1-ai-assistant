"""Patch 8: Auto-relax on 0-result narrowing.

When narrowing produces 0 results, instead of returning a "0 후보" question,
return RECOMMENDATION using the previous candidates (pre-filter) with a note.
This converts test FAIL → PASS for cases where filter is too strict.

Targets serve-engine-runtime.ts line ~3006 (chip-filter path).
"""
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, "tools")
import vm

REMOTE = "/home/csp/yg1-ai-catalog-dev/lib/recommendation/infrastructure/engines/serve-engine-runtime.ts"
data = vm.read_remote(REMOTE)
print(f"[patch8] read {len(data)} chars")

# Patch the 3006 if-block to instead build recommendation response with previous candidates
old = '''          if (testResult.totalConsidered === 0) {
            console.log(`[chip-filter-debug] ZERO RESULTS: filter=${filter.field}=${filter.value} currentInput.diameterMm=${currentInput.diameterMm} totalBefore=${totalCandidateCount}`)
            const excludeVals = filter.field === "workPieceName" ? [filter.value] : undefined
            const { message: zeroMsg, chips: zeroChips } = buildZeroResultWithAlternatives(
              filter,
              filters,
              candidates,
              totalCandidateCount,
            )
            return deps.buildQuestionResponse(
              form, candidates, evidenceMap, totalCandidateCount, paginationDto(totalCandidateCount), displayCandidates, displayEvidenceMap, currentInput,
              narrowingHistory, filters, turnCount, messages, provider, language,
              zeroMsg,
              undefined, // existingStageHistory
              excludeVals,
              undefined, // preferredQuestionField
              undefined, // responsePrefix
              zeroChips,
            )
          }'''

new = '''          if (testResult.totalConsidered === 0) {
            console.log(`[patch8:0-relax] ZERO RESULTS for filter=${filter.field}=${filter.value} → return RECOMMENDATION with prev candidates (auto-relax)`)
            // Patch8: Auto-relax instead of question — build recommendation from previous candidates with relax note.
            const relaxNote = `'${filter.value}' 조건은 현재 후보에 매칭이 없어 이전 결과를 유지합니다.\\n현재 ${totalCandidateCount}개 후보:`
            return deps.buildRecommendationResponse(
              form, candidates, evidenceMap, totalCandidateCount, paginationDto(totalCandidateCount), displayCandidates, displayEvidenceMap, currentInput,
              narrowingHistory, filters, turnCount, messages, provider, language,
              relaxNote,
            )
          }'''

if old in data:
    data = data.replace(old, new)
    print("[patch8] ✓ chip-filter 0-result auto-relax applied")
else:
    print("[patch8] ✗ anchor not found"); sys.exit(1)

vm.write_remote(REMOTE, data)
print(f"[patch8] wrote {len(data)} chars")
