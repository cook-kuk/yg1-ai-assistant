/**
 * Memory Manager — Explicit keep / update / drop / replace behavior.
 *
 * Decides for each memory item what to do when new information arrives.
 *
 * Rules:
 * - Keep durable resolved facts unless explicitly changed
 * - Keep recommendation artifacts unless reset is explicit
 * - Temporary filters may be relaxed or replaced during repair
 * - If user changes material, do NOT erase all other memory
 * - Distinguish: replace_single vs branch_explore vs restart
 * - Avoid redundant or repeated memory
 * - Mark older items stale/replaced rather than silently mixing
 */

import type {
  ConversationMemory,
  MemoryItem,
  MemoryStatus,
} from "./conversation-memory"
import type { ContextInterpretation, IntentShift } from "../context/context-types"

export type MemoryAction = "keep" | "update" | "replace" | "drop"

export interface MemoryDecision {
  key: string
  action: MemoryAction
  reason: string
  newValue?: string
}

/**
 * Process memory updates based on context interpretation.
 * Returns a new ConversationMemory with decisions applied.
 */
export function updateMemory(
  memory: ConversationMemory,
  interpretation: ContextInterpretation,
  turnCount: number
): { memory: ConversationMemory; decisions: MemoryDecision[] } {
  const decisions: MemoryDecision[] = []
  const updatedItems: MemoryItem[] = []

  for (const item of memory.items) {
    const decision = decideItemFate(item, interpretation)
    decisions.push(decision)

    switch (decision.action) {
      case "keep":
        updatedItems.push(item)
        break
      case "update":
        updatedItems.push({
          ...item,
          value: decision.newValue ?? item.value,
          status: "resolved",
          turnUpdated: turnCount,
        })
        break
      case "replace":
        updatedItems.push({
          ...item,
          status: "replaced",
          replacedBy: decision.newValue ? `new_${item.field}` : undefined,
          turnUpdated: turnCount,
        })
        break
      case "drop":
        // Don't include in updated items
        break
    }
  }

  // Add new items from interpretation if they don't exist
  if (interpretation.intentShift === "replace_constraint" || interpretation.intentShift === "branch_exploration") {
    for (const conflict of interpretation.detectedConflicts) {
      const existingNew = updatedItems.find(i => i.field === conflict.newField && i.status !== "replaced" && i.status !== "stale")
      if (!existingNew) {
        updatedItems.push({
          key: `new_${conflict.newField}_${turnCount}`,
          field: conflict.newField,
          value: conflict.newValue,
          source: "user_followup",
          status: "tentative",
          priority: 6,
          turnCreated: turnCount,
          turnUpdated: turnCount,
        })
        decisions.push({
          key: `new_${conflict.newField}_${turnCount}`,
          action: "update",
          reason: `New ${conflict.newField} from user intent shift`,
          newValue: conflict.newValue,
        })
      }
    }
  }

  // Handle referenced field updates
  if (interpretation.referencedField && interpretation.intentShift === "refine_existing") {
    const existing = updatedItems.find(
      i => i.field === interpretation.referencedField && i.status !== "replaced" && i.status !== "stale"
    )
    if (existing) {
      existing.status = "tentative"
      existing.turnUpdated = turnCount
    }
  }

  const updatedMemory: ConversationMemory = {
    ...memory,
    items: updatedItems,
    followUp: {
      ...memory.followUp,
      lastAskedField: interpretation.referencedField ?? memory.followUp.lastAskedField,
      pendingDecisionType: interpretation.shouldGenerateRepairOptions
        ? "repair"
        : interpretation.suggestedNextAction === "compare"
        ? "comparison"
        : interpretation.suggestedNextAction === "explain"
        ? "explanation"
        : memory.followUp.pendingDecisionType,
    },
  }

  // On restart, mark everything stale except intake facts
  if (interpretation.intentShift === "restart") {
    for (const item of updatedMemory.items) {
      if (item.source !== "intake") {
        item.status = "stale"
      }
    }
    updatedMemory.recommendationContext = {
      primaryProductCode: null,
      primarySeriesName: null,
      alternativeCount: 0,
      lastComparedProducts: [],
      matchStatus: null,
    }
  }

  return { memory: updatedMemory, decisions }
}

// ════════════════════════════════════════════════════════════════
// DECISION LOGIC
// ════════════════════════════════════════════════════════════════

function decideItemFate(
  item: MemoryItem,
  interpretation: ContextInterpretation
): MemoryDecision {
  const { intentShift, detectedConflicts, preserveContext } = interpretation

  // Already stale/replaced → drop
  if (item.status === "stale" || item.status === "replaced") {
    return { key: item.key, action: "drop", reason: "Already stale/replaced" }
  }

  // Active filters behave like resolved for conflict detection
  // but can be more easily replaced than intake-resolved facts

  // On restart: keep intake facts, drop everything else
  if (intentShift === "restart") {
    if (item.source === "intake") {
      return { key: item.key, action: "keep", reason: "Intake fact preserved across restart" }
    }
    return { key: item.key, action: "drop", reason: "Non-intake item dropped on restart" }
  }

  // Check if this item is directly conflicted
  const isDirectlyConflicted = detectedConflicts.some(
    c => c.conflictingConstraints.some(cc => cc.field === item.field)
  )

  if (isDirectlyConflicted) {
    // Durable intake facts: mark as replaced, not dropped
    if (item.source === "intake" || item.status === "resolved") {
      if (intentShift === "replace_constraint") {
        return {
          key: item.key,
          action: "replace",
          reason: `Constraint ${item.field}=${item.value} replaced by user`,
          newValue: detectedConflicts.find(c =>
            c.conflictingConstraints.some(cc => cc.field === item.field)
          )?.newValue,
        }
      }
      if (intentShift === "branch_exploration") {
        // Branch: keep original but mark tentative
        return { key: item.key, action: "keep", reason: "Kept during branch exploration" }
      }
    }

    // Temporary/narrowing items with soft conflicts: keep with warning
    if (detectedConflicts.some(c => c.severity === "soft" && c.conflictingConstraints.some(cc => cc.field === item.field))) {
      return { key: item.key, action: "keep", reason: "Soft conflict — kept for repair options" }
    }

    // Hard conflict on temporary item: replace
    return {
      key: item.key,
      action: "replace",
      reason: `Hard conflict on ${item.field}`,
    }
  }

  // Preserve context requested → keep everything
  if (preserveContext) {
    return { key: item.key, action: "keep", reason: "Context preservation" }
  }

  // Default: keep
  return { key: item.key, action: "keep", reason: "No conflict, default keep" }
}

/**
 * Get active (non-stale, non-replaced) memory items.
 */
export function getActiveMemoryItems(memory: ConversationMemory): MemoryItem[] {
  return memory.items.filter(i => i.status === "resolved" || i.status === "active" || i.status === "tentative")
}

/**
 * Check if a field has been answered/resolved in memory.
 */
export function isFieldAnswered(memory: ConversationMemory, field: string): boolean {
  return memory.items.some(
    i => i.field === field && (i.status === "resolved" || i.status === "tentative")
  )
}
