// SPDX-License-Identifier: MIT
// Clipboard 복사 유틸 — HTTP (비-secure) 환경에서도 작동하는 fallback.
// navigator.clipboard 는 HTTPS / localhost 에서만 허용되므로,
// 거부되면 legacy execCommand("copy") textarea trick 으로 폴백한다.

export async function copyText(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false

  // 1) 최신 Clipboard API (secure context 필요)
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 권한 거부 시 legacy fallback으로 시도
    }
  }

  // 2) Legacy fallback — textarea + execCommand
  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.top = "-1000px"
    ta.style.left = "-1000px"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
