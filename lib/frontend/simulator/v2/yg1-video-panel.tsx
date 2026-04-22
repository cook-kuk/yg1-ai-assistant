// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — YG-1 실제 가공 영상 임베드 패널
// 현재 재질(ISO 그룹)/가공 모드(operation)에 해당하는 YG-1 공식 YouTube
// 영상을 iframe 으로 보여 주는 독립 패널.
//
// - cutting-simulator-v2.tsx 를 건드리지 않는 독립 컴포넌트
// - 초기에는 썸네일만 로드(성능), 사용자가 ▶ 버튼을 눌러야 iframe 삽입
// - 좌: 선택 영상 플레이어, 우: 같은 ISO 그룹 영상 리스트
// - 다크모드, 모바일 스택 지원
"use client"

import { useEffect, useMemo, useState } from "react"

// ─────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────

export interface Yg1VideoPanelProps {
  /** ISO 재질 그룹 (P/M/K/N/S/H) */
  isoGroup: string
  /** 가공 모드 — side-milling, slotting, finishing, roughing 등 */
  operation: string
  darkMode?: boolean
}

// ─────────────────────────────────────────────────────────────────────
// SSOT — YG-1 유튜브 영상 매핑 (가상 ID — 관리자 교체 예정)
// ─────────────────────────────────────────────────────────────────────

interface Yg1Video {
  id: string
  title: string
  description: string
  duration?: string
}

const VIDEO_MAP: Record<string, readonly Yg1Video[]> = {
  P: [
    { id: "dQw4w9WgXcQ", title: "탄소강 고속 가공 (YG-1 GNX)", description: "S45C · 4날 스퀘어 · Vc 180 m/min", duration: "3:24" },
    { id: "J---aiyznGQ", title: "합금강 프로파일링", description: "4140 · HEM 전략", duration: "2:18" },
  ],
  M: [
    { id: "jNQXAC9IVRw", title: "스테인리스 304 측면 가공", description: "SUS304 · Vc 120 · AlTiN", duration: "4:12" },
  ],
  K: [
    { id: "9bZkp7q19f0", title: "주철 GC250 헤비컷", description: "FCD · V7 PLUS · Vc 200", duration: "2:45" },
  ],
  N: [
    { id: "kJQP7kiw5Fk", title: "알루미늄 7075 고속 가공", description: "Al7075 · Vc 500+ · DLC", duration: "3:02" },
    { id: "L_jWHffIx5E", title: "구리 C11000 정삭", description: "C11000 · 2날 볼", duration: "2:30" },
  ],
  S: [
    { id: "hT_nvWreIhg", title: "인코넬 718 가공 (AlCrN)", description: "Inconel · Vc 45 · 고난이도", duration: "5:15" },
    { id: "W6NZfCO5SIk", title: "티타늄 Ti-6Al-4V", description: "Ti6Al4V · AlCrN · 안전 가공", duration: "4:28" },
  ],
  H: [
    { id: "2vjPBrBU-TM", title: "고경도강 45~55 HRC", description: "경화강 · GNX · 저속", duration: "3:45" },
    { id: "RgKAFK5djSk", title: "55~65 HRC 하드밀링", description: "SEM846 4G · nACo", duration: "4:02" },
  ],
}

const YG1_CHANNEL_URL = "https://www.youtube.com/@YG1Global" // 가상 공식 채널

// ─────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────

function thumbnailUrl(id: string): string {
  return `https://img.youtube.com/vi/${id}/mqdefault.jpg`
}

function embedUrl(id: string): string {
  return `https://www.youtube.com/embed/${id}?rel=0&autoplay=1`
}

function watchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`
}

function normalizeIso(iso: string): string {
  return (iso || "").trim().toUpperCase().charAt(0)
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export default function Yg1VideoPanel({
  isoGroup,
  operation,
  darkMode = false,
}: Yg1VideoPanelProps) {
  const normIso = useMemo(() => normalizeIso(isoGroup), [isoGroup])
  const videos = useMemo<readonly Yg1Video[]>(() => VIDEO_MAP[normIso] ?? [], [normIso])

  // 선택된 영상 index + 재생 여부 (lazy load)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [playing, setPlaying] = useState(false)

  // ISO 그룹이 바뀌면 0번으로 리셋 + 재생 중지
  useEffect(() => {
    setSelectedIdx(0)
    setPlaying(false)
  }, [normIso])

  const selected = videos[selectedIdx]

  // ── 스타일 토큰 ────────────────────────────────────────────────
  const cardCls = darkMode
    ? "rounded-xl border border-slate-700 bg-gradient-to-br from-slate-900 to-rose-950/30 p-4 sm:p-5"
    : "rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-rose-50/30 p-4 sm:p-5"
  const headerTextCls = darkMode ? "text-slate-100" : "text-slate-800"
  const subtleTextCls = darkMode ? "text-slate-400" : "text-slate-500"
  const borderCls = darkMode ? "border-slate-700" : "border-slate-200"
  const chipBaseCls = darkMode
    ? "bg-slate-800/60 text-slate-200 border-slate-700"
    : "bg-white text-slate-700 border-slate-300"
  const listItemActiveCls = darkMode
    ? "border-rose-500 bg-rose-900/30"
    : "border-rose-400 bg-rose-50"
  const listItemIdleCls = darkMode
    ? "border-slate-700 bg-slate-800/40 hover:bg-slate-800"
    : "border-slate-200 bg-white hover:bg-slate-50"
  const linkCls = darkMode
    ? "text-rose-300 hover:text-rose-200"
    : "text-rose-600 hover:text-rose-700"

  return (
    <section className={cardCls} aria-label="YG-1 실 가공 영상">
      {/* ── 헤더 ──────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-2">
        <span className="text-xl leading-none" aria-hidden>🎥</span>
        <h3 className={`text-base font-semibold ${headerTextCls}`}>YG-1 실 가공 영상</h3>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${chipBaseCls}`}
        >
          ISO {normIso || "?"}
        </span>
        {operation && (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${chipBaseCls}`}
          >
            {operation}
          </span>
        )}
        <span className={`ml-auto text-[11px] ${subtleTextCls}`}>
          {videos.length > 0 ? `${videos.length}개 영상` : "준비 중"}
        </span>
      </header>

      {/* ── 본문 ──────────────────────────────────────────────── */}
      {videos.length === 0 || !selected ? (
        <div
          className={`mt-4 flex min-h-[160px] items-center justify-center rounded-lg border border-dashed ${borderCls} ${subtleTextCls} text-sm`}
          role="status"
        >
          이 재질(ISO {normIso || "?"})에 대한 영상 준비 중입니다.
        </div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-[2fr_1fr]">
          {/* ── 좌: 플레이어 ───────────────────────────────── */}
          <div>
            <div
              className={`relative overflow-hidden rounded-lg border ${borderCls} bg-black`}
              style={{ aspectRatio: "16 / 9" }}
            >
              {playing ? (
                <iframe
                  key={selected.id}
                  src={embedUrl(selected.id)}
                  title={selected.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  loading="lazy"
                  className="absolute inset-0 h-full w-full"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setPlaying(true)}
                  aria-label={`${selected.title} 재생`}
                  className="group absolute inset-0 flex h-full w-full items-center justify-center"
                >
                  <img
                    src={thumbnailUrl(selected.id)}
                    alt={selected.title}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                  />
                  <span className="relative z-10 inline-flex h-14 w-14 items-center justify-center rounded-full bg-black/70 text-white shadow-lg transition-transform group-hover:scale-110">
                    <span className="ml-0.5 text-xl" aria-hidden>▶</span>
                  </span>
                  <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    클릭하여 재생
                  </span>
                </button>
              )}
            </div>

            {/* 제목/설명 */}
            <div className="mt-3 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className={`truncate text-sm font-semibold ${headerTextCls}`} title={selected.title}>
                  {selected.title}
                </div>
                <div className={`mt-0.5 text-[12px] ${subtleTextCls}`}>
                  {selected.description}
                  {selected.duration ? ` · ${selected.duration}` : ""}
                </div>
              </div>
              <a
                href={watchUrl(selected.id)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="YouTube에서 새 탭으로 열기"
                className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium ${chipBaseCls}`}
              >
                YouTube <span aria-hidden>↗</span>
              </a>
            </div>
          </div>

          {/* ── 우: 영상 리스트 ───────────────────────────── */}
          <div>
            <div className={`mb-2 text-[11px] font-semibold uppercase tracking-wider ${subtleTextCls}`}>
              같은 재질의 다른 영상
            </div>
            <ul className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {videos.map((v, idx) => {
                const active = idx === selectedIdx
                return (
                  <li key={v.id}>
                    <div
                      className={`flex items-stretch gap-2 rounded-lg border p-2 transition-colors ${
                        active ? listItemActiveCls : listItemIdleCls
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedIdx(idx)
                          setPlaying(false)
                        }}
                        aria-pressed={active}
                        aria-label={`${v.title} 선택`}
                        className="flex flex-1 items-center gap-2 text-left"
                      >
                        <img
                          src={thumbnailUrl(v.id)}
                          alt=""
                          loading="lazy"
                          className="h-12 w-20 flex-shrink-0 rounded object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div
                            className={`truncate text-[12px] font-medium ${headerTextCls}`}
                            title={v.title}
                          >
                            {v.title}
                          </div>
                          <div className={`mt-0.5 text-[10px] ${subtleTextCls}`}>
                            {v.duration ?? ""}
                          </div>
                        </div>
                      </button>
                      <a
                        href={watchUrl(v.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${v.title} YouTube에서 열기`}
                        onClick={e => e.stopPropagation()}
                        className={`inline-flex w-6 flex-shrink-0 items-center justify-center rounded ${linkCls}`}
                      >
                        <span aria-hidden>↗</span>
                      </a>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}

      {/* ── 하단: 공식 채널 링크 ───────────────────────────── */}
      <footer className={`mt-4 border-t pt-3 text-[12px] ${borderCls} ${subtleTextCls}`}>
        <a
          href={YG1_CHANNEL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 font-medium ${linkCls}`}
        >
          <span aria-hidden>👉</span> YG-1 공식 YouTube 채널 <span aria-hidden>↗</span>
        </a>
      </footer>
    </section>
  )
}
