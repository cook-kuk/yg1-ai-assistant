"use client";

/**
 * useCopilotStream
 * ----------------------------------------------------------------
 * /api/copilot SSE 스트림을 소비하는 React hook.
 * - messages[]  : 과거 대화(유저/어시스턴트)
 * - streamingMessage: 현재 들어오는 어시스턴트 응답(부분 문자열)
 * - isStreaming : 스트림 진행 여부
 * - sendMessage(text, context?): 유저 메시지 전송 + 스트림 수신
 * - clear(): 대화 초기화
 */

import { useCallback, useRef, useState } from "react";
import type { CopilotMessage } from "./copilot-messages";

interface SendContext {
  section?: string;
  state?: unknown;
}

interface UseCopilotStreamReturn {
  messages: CopilotMessage[];
  streamingMessage: string;
  isStreaming: boolean;
  sendMessage: (text: string, context?: SendContext) => Promise<void>;
  clear: () => void;
}

export function useCopilotStream(): UseCopilotStreamReturn {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {
        /* noop */
      }
      abortRef.current = null;
    }
    setMessages([]);
    setStreamingMessage("");
    setIsStreaming(false);
  }, []);

  const sendMessage = useCallback(
    async (text: string, context?: SendContext) => {
      const trimmed = (text ?? "").trim();
      if (!trimmed) return;

      const userMsg: CopilotMessage = {
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
        context,
      };

      // snapshot past messages BEFORE adding new user message for API payload
      let pastMsgs: CopilotMessage[] = [];
      setMessages((prev) => {
        pastMsgs = prev;
        return [...prev, userMsg];
      });

      setStreamingMessage("");
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      let accumulated = "";
      try {
        const res = await fetch("/api/copilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: pastMsgs.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            newMessage: trimmed,
            context: context ?? null,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;

        while (!done) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) {
            done = true;
            break;
          }
          buffer += decoder.decode(value, { stream: true });

          // Split by newline. SSE events are separated by "\n\n" but we also
          // process incremental "data: ..." lines.
          const lines = buffer.split("\n");
          // keep last partial line in buffer
          buffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === "[DONE]") {
              done = true;
              break;
            }
            try {
              const parsed = JSON.parse(payload) as {
                text?: string;
                error?: string;
              };
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              if (typeof parsed.text === "string" && parsed.text.length > 0) {
                accumulated += parsed.text;
                setStreamingMessage(accumulated);
              }
            } catch (e) {
              // If it's a JSON parse failure for unknown payload, skip;
              // if it's a thrown Error above, rethrow.
              if (e instanceof Error && e.message && !e.message.startsWith("Unexpected")) {
                throw e;
              }
            }
          }
        }

        const assistantMsg: CopilotMessage = {
          role: "assistant",
          content: accumulated,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err: unknown) {
        const errorText =
          err instanceof Error ? err.message : "알 수 없는 오류";
        const assistantErr: CopilotMessage = {
          role: "assistant",
          content:
            accumulated.length > 0
              ? `${accumulated}\n\n⚠️ 에러: ${errorText}`
              : `⚠️ 에러: ${errorText}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantErr]);
      } finally {
        setStreamingMessage("");
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [],
  );

  return { messages, streamingMessage, isStreaming, sendMessage, clear };
}

export default useCopilotStream;
