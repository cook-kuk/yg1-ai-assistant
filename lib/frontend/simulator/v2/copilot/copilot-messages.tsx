"use client";

/**
 * CuttingCopilot 메시지 버블 컴포넌트.
 * - Assistant: markdown 렌더링, 좌측 정렬, slate 톤.
 * - User: plain text, 우측 정렬, teal.
 * - isStreaming=true: 내용 끝에 깜빡이는 커서(▍) 표시.
 */

import * as React from "react";
import ReactMarkdown from "react-markdown";

export interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  context?: unknown;
}

interface MessageBubbleProps {
  message: CopilotMessage;
  isStreaming?: boolean;
}

function formatTime(ts: number): string {
  try {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return "";
  }
}

export function MessageBubble({ message, isStreaming = false }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const content = message.content ?? "";
  const displayContent = isStreaming ? `${content}▍` : content;

  return (
    <div className={`w-full flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[85%] flex flex-col ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        <div
          className={[
            "px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed border",
            isUser
              ? "bg-teal-500 text-white border-teal-500 rounded-br-sm"
              : "bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-700 rounded-bl-sm",
          ].join(" ")}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{displayContent}</div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none break-words">
              <ReactMarkdown>{displayContent}</ReactMarkdown>
            </div>
          )}
        </div>
        <div
          className={`mt-1 text-[10px] text-slate-400 dark:text-slate-500 ${
            isUser ? "text-right pr-1" : "text-left pl-1"
          }`}
        >
          {formatTime(message.timestamp)}
          {isStreaming ? " · typing..." : ""}
        </div>
      </div>
    </div>
  );
}

export default MessageBubble;
