/**
 * /api/copilot  — CuttingCopilot SSE streaming endpoint (Anthropic)
 * ----------------------------------------------------------------
 * - Node.js runtime (default) — Anthropic SDK requires it.
 * - maxDuration is a LITERAL (Next 16 segment config restriction).
 * - Body: { messages: {role, content}[], newMessage: string, context?: {...} }
 * - Streams: `data: {"text":"..."}\n\n` … then `data: [DONE]\n\n`.
 * - On error: streams `data: {"error":"..."}\n\n` and closes gracefully
 *   (never throws outside of the stream).
 */

import Anthropic from "@anthropic-ai/sdk";
import { buildContextualPrompt } from "../../../lib/frontend/simulator/v2/copilot/copilot-system-prompts";

export const maxDuration = 120;

type ChatRole = "user" | "assistant";

interface IncomingMessage {
  role: ChatRole;
  content: string;
}

interface RequestBody {
  messages?: IncomingMessage[];
  newMessage?: string;
  context?: { section?: string; state?: unknown } | null;
}

const MODEL_ID = "claude-haiku-4-5-20251001";

function sseEncode(obj: unknown): Uint8Array {
  const payload = JSON.stringify(obj);
  return new TextEncoder().encode(`data: ${payload}\n\n`);
}

function sseDone(): Uint8Array {
  return new TextEncoder().encode(`data: [DONE]\n\n`);
}

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    // fall through with empty body — stream will emit error
  }

  const pastMessages: IncomingMessage[] = Array.isArray(body.messages)
    ? body.messages
        .filter(
          (m): m is IncomingMessage =>
            !!m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string",
        )
        .slice(-20) // cap history
    : [];

  const newMessage = (body.newMessage ?? "").toString().trim();
  const context = body.context ?? undefined;
  const systemPrompt = buildContextualPrompt(context ?? {});

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          /* controller may already be closed */
        }
      };
      const safeClose = () => {
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };

      // ----- validate env -----
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        safeEnqueue(
          sseEncode({
            error:
              "ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다. 관리자에게 문의하세요.",
          }),
        );
        safeEnqueue(sseDone());
        safeClose();
        return;
      }

      if (!newMessage) {
        safeEnqueue(
          sseEncode({ error: "메시지가 비어 있습니다." }),
        );
        safeEnqueue(sseDone());
        safeClose();
        return;
      }

      try {
        const client = new Anthropic({ apiKey });

        const messages = [
          ...pastMessages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content: newMessage },
        ];

        const mstream = client.messages.stream({
          model: MODEL_ID,
          max_tokens: 1024,
          system: systemPrompt,
          messages,
        });

        // Consume raw events; emit only text_delta increments.
        for await (const event of mstream) {
          const evt = event as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (
            evt?.type === "content_block_delta" &&
            evt.delta?.type === "text_delta" &&
            typeof evt.delta.text === "string" &&
            evt.delta.text.length > 0
          ) {
            safeEnqueue(sseEncode({ text: evt.delta.text }));
          }
        }

        safeEnqueue(sseDone());
        safeClose();
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "알 수 없는 스트림 오류";
        safeEnqueue(sseEncode({ error: msg }));
        safeEnqueue(sseDone());
        safeClose();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
