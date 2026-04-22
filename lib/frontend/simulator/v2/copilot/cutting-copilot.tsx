"use client";

/**
 * CuttingCopilot  — 메인 UI 컴포넌트
 * ----------------------------------------------------------------
 * 3가지 상태: Closed (floating button) / Minimized (compact bar) / Open (chat window)
 *
 * - window.addEventListener("copilot:ask", ...) 지원:
 *     window.dispatchEvent(new CustomEvent("copilot:ask", { detail: { question: "..." } }))
 *   이벤트가 오면 copilot을 열고 해당 질문을 입력 후 300ms 뒤 자동 전송.
 */

import * as React from "react";
import { MessageSquare, X, Minimize2, Sparkles, Send } from "lucide-react";
import { MessageBubble } from "./copilot-messages";
import { QuickActions } from "./copilot-quick-actions";
import { useCopilotStream } from "./use-copilot-stream";

interface CuttingCopilotProps {
  currentSection?: string;
  currentState?: unknown;
}

type UiState = "closed" | "minimized" | "open";

export function CuttingCopilot({
  currentSection,
  currentState,
}: CuttingCopilotProps) {
  const [uiState, setUiState] = React.useState<UiState>("closed");
  const [input, setInput] = React.useState<string>("");
  const { messages, streamingMessage, isStreaming, sendMessage } =
    useCopilotStream();

  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const isOpen = uiState === "open";
  const isMinimized = uiState === "minimized";

  const openCopilot = React.useCallback(() => setUiState("open"), []);
  const minimize = React.useCallback(() => setUiState("minimized"), []);
  const close = React.useCallback(() => setUiState("closed"), []);

  const submit = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      await sendMessage(trimmed, {
        section: currentSection,
        state: currentState,
      });
    },
    [sendMessage, currentSection, currentState],
  );

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = input;
    setInput("");
    void submit(value);
  };

  const handleQuickAction = (question: string) => {
    setInput("");
    void submit(question);
  };

  // Auto-scroll when messages or streaming content changes
  React.useEffect(() => {
    if (!isOpen) return;
    const el = messagesEndRef.current;
    if (el) {
      try {
        el.scrollIntoView({ behavior: "smooth", block: "end" });
      } catch {
        /* noop */
      }
    }
  }, [messages, streamingMessage, isOpen]);

  // Focus input when opened
  React.useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Global "copilot:ask" event bridge
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (evt: Event) => {
      const custom = evt as CustomEvent<{ question?: string }>;
      const question = custom.detail?.question ?? "";
      if (!question) return;
      setUiState("open");
      setInput(question);
      const t = setTimeout(() => {
        setInput("");
        void submit(question);
      }, 300);
      // best-effort cleanup handled by the listener lifecycle; per-call timeout
      // is small (300ms) so leaking one is not a concern.
      return () => clearTimeout(t);
    };
    window.addEventListener("copilot:ask", handler as EventListener);
    return () => {
      window.removeEventListener("copilot:ask", handler as EventListener);
    };
  }, [submit]);

  // ---------- (a) Closed state: floating button ----------
  if (uiState === "closed") {
    return (
      <button
        type="button"
        aria-label="Open CuttingCopilot"
        data-tour="copilot-trigger"
        onClick={openCopilot}
        className={[
          "fixed bottom-6 right-6 z-50",
          "w-14 h-14 rounded-full",
          "bg-gradient-to-br from-teal-500 to-emerald-500",
          "text-white shadow-lg hover:shadow-xl",
          "flex items-center justify-center",
          "transition-transform hover:scale-105 active:scale-95",
          "ring-1 ring-white/30",
        ].join(" ")}
      >
        <MessageSquare className="w-6 h-6" />
        <span
          aria-hidden
          className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse ring-2 ring-white"
        />
      </button>
    );
  }

  // ---------- (b) Minimized state ----------
  if (isMinimized) {
    return (
      <div
        className={[
          "fixed bottom-6 right-6 z-50",
          "flex items-center gap-2",
          "px-3 py-2 rounded-full",
          "bg-white dark:bg-slate-900",
          "border border-slate-200 dark:border-slate-700",
          "shadow-md cursor-pointer",
        ].join(" ")}
        onClick={openCopilot}
      >
        <span className="w-6 h-6 rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center">
          <MessageSquare className="w-3.5 h-3.5 text-white" />
        </span>
        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
          CuttingCopilot
        </span>
        <button
          type="button"
          aria-label="Close CuttingCopilot"
          className="ml-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // ---------- (c) Open state: full chat window ----------
  return (
    <div
      className={[
        "fixed bottom-6 right-6 z-50",
        "w-[420px] max-w-[calc(100vw-2rem)]",
        "h-[600px] max-h-[calc(100vh-2rem)]",
        "flex flex-col",
        "bg-white dark:bg-slate-900",
        "border border-slate-200 dark:border-slate-700",
        "rounded-2xl shadow-2xl overflow-hidden",
      ].join(" ")}
      role="dialog"
      aria-label="CuttingCopilot"
    >
      {/* Header */}
      <div
        className={[
          "flex items-center justify-between gap-2",
          "px-3.5 py-2.5",
          "bg-gradient-to-r from-teal-500 to-emerald-500 text-white",
        ].join(" ")}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold truncate">
              CuttingCopilot
            </span>
            <span className="text-[10px] text-white/80 truncate">
              {currentSection
                ? `섹션: ${currentSection}`
                : "YG-1 ARIA AI Research Lab"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Minimize"
            onClick={minimize}
            className="w-7 h-7 rounded-md hover:bg-white/20 flex items-center justify-center"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="w-7 h-7 rounded-md hover:bg-white/20 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 bg-white dark:bg-slate-900">
        {messages.length === 0 && !isStreaming ? (
          <WelcomeBlock
            section={currentSection}
            onAction={handleQuickAction}
          />
        ) : (
          <>
            {messages.map((m, i) => (
              <MessageBubble key={`${m.timestamp}-${i}`} message={m} />
            ))}
            {isStreaming ? (
              <MessageBubble
                message={{
                  role: "assistant",
                  content: streamingMessage,
                  timestamp: Date.now(),
                }}
                isStreaming
              />
            ) : null}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick actions */}
      <div className="px-2 pt-1 pb-1 border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40">
        <QuickActions section={currentSection} onAction={handleQuickAction} />
      </div>

      {/* Input form */}
      <form
        onSubmit={handleFormSubmit}
        className="flex items-center gap-2 px-3 py-2.5 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="CuttingCopilot에게 질문하세요..."
          disabled={isStreaming}
          className={[
            "flex-1 text-sm",
            "px-3 py-2 rounded-lg",
            "bg-white dark:bg-slate-800",
            "border border-slate-200 dark:border-slate-700",
            "text-slate-800 dark:text-slate-100",
            "placeholder:text-slate-400",
            "focus:outline-none focus:ring-2 focus:ring-teal-400",
            "disabled:opacity-60",
          ].join(" ")}
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={isStreaming || !input.trim()}
          className={[
            "w-9 h-9 rounded-lg",
            "bg-gradient-to-br from-teal-500 to-emerald-500 text-white",
            "flex items-center justify-center",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "hover:shadow-md transition-shadow",
          ].join(" ")}
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}

/** Welcome message + initial 3 quick action buttons */
function WelcomeBlock({
  section,
  onAction,
}: {
  section?: string;
  onAction: (q: string) => void;
}) {
  const initial = section
    ? [
        "이 섹션 3줄 요약해줘",
        "이 화면 숫자 어떻게 읽어요?",
        "다음에 뭘 해보면 좋아요?",
      ]
    : [
        "SFM이 뭐예요?",
        "ARIA가 뭐예요?",
        "투어 시작해주세요",
      ];

  return (
    <div className="flex flex-col items-start gap-3 py-2">
      <div
        className={[
          "max-w-[90%] px-3.5 py-3 rounded-2xl rounded-bl-sm",
          "bg-slate-50 dark:bg-slate-800",
          "border border-slate-200 dark:border-slate-700",
          "text-sm text-slate-800 dark:text-slate-100 leading-relaxed",
        ].join(" ")}
      >
        <p className="font-semibold mb-1">안녕하세요! CuttingCopilot입니다 👋</p>
        <p className="text-slate-600 dark:text-slate-300 text-[13px]">
          YG-1 ARIA AI Research Lab 데모를 함께 둘러보고, 지금 화면에 보이는
          숫자·그래프·모델을 한국어로 쉽게 설명해 드려요. 무엇이 궁금하세요?
        </p>
      </div>
      <div className="flex flex-wrap gap-2 pl-1">
        {initial.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onAction(q)}
            className={[
              "inline-flex items-center gap-1.5",
              "px-2.5 py-1.5 rounded-full text-[11px] font-medium",
              "bg-white dark:bg-slate-900",
              "border border-slate-200 dark:border-slate-700",
              "text-slate-700 dark:text-slate-200",
              "hover:border-teal-400 hover:text-teal-700 dark:hover:text-teal-300",
            ].join(" ")}
          >
            <Sparkles className="w-3 h-3 text-teal-500" />
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

export default CuttingCopilot;
