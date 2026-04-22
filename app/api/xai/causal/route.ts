/**
 * /api/xai/causal — Causal/SHAP explanation SSE endpoint (Anthropic)
 * ----------------------------------------------------------------
 * - Node.js runtime (default) — Anthropic SDK requires it.
 * - maxDuration literal per Next 16 segment-config rule.
 * - Body: { prediction, sandvikPrediction, shapValues, context }
 *   -> compiled into a single user message describing the numeric situation.
 * - Uses CAUSAL_XAI_SYSTEM_PROMPT + claude-sonnet-4-6 (quality priority).
 */

import Anthropic from "@anthropic-ai/sdk";
import { CAUSAL_XAI_SYSTEM_PROMPT } from "../../../../lib/frontend/simulator/v2/copilot/copilot-system-prompts";

export const maxDuration = 120;

interface ShapEntry {
  feature: string;
  value: number;
  input?: number | string;
}

interface RequestBody {
  prediction?: number | null;
  sandvikPrediction?: number | null;
  shapValues?: ShapEntry[] | Record<string, number> | null;
  context?: {
    section?: string;
    state?: unknown;
    causalEdges?: string[];
  } | null;
}

const MODEL_ID = "claude-sonnet-4-6";

function sseEncode(obj: unknown): Uint8Array {
  const payload = JSON.stringify(obj);
  return new TextEncoder().encode(`data: ${payload}\n\n`);
}

function sseDone(): Uint8Array {
  return new TextEncoder().encode(`data: [DONE]\n\n`);
}

function normalizeShap(
  raw: RequestBody["shapValues"],
): ShapEntry[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .filter(
        (e) =>
          e &&
          typeof e === "object" &&
          typeof (e as ShapEntry).feature === "string" &&
          typeof (e as ShapEntry).value === "number",
      )
      .map((e) => e as ShapEntry);
  }
  if (typeof raw === "object") {
    return Object.entries(raw)
      .filter(([, v]) => typeof v === "number")
      .map(([feature, value]) => ({ feature, value: value as number }));
  }
  return [];
}

function buildUserMessage(body: RequestBody): string {
  const pred = body.prediction;
  const sandvik = body.sandvikPrediction;
  const shap = normalizeShap(body.shapValues)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 8);

  const diffPct =
    typeof pred === "number" && typeof sandvik === "number" && sandvik !== 0
      ? (((pred - sandvik) / sandvik) * 100).toFixed(1)
      : null;

  const shapLines = shap.length
    ? shap
        .map(
          (e) =>
            `- ${e.feature}: SHAP=${e.value.toFixed(3)}${
              e.input !== undefined ? ` (input=${String(e.input)})` : ""
            }`,
        )
        .join("\n")
    : "- (SHAP 값 제공 없음)";

  const edges = body.context?.causalEdges;
  const edgesBlock =
    edges && edges.length
      ? edges.map((e) => `- ${e}`).join("\n")
      : "- (인과 엣지 정보 없음)";

  const section = body.context?.section ?? "(섹션 정보 없음)";
  let stateSnap = "{}";
  try {
    stateSnap = body.context?.state
      ? JSON.stringify(body.context.state, null, 2).slice(0, 2000)
      : "{}";
  } catch {
    stateSnap = "(직렬화 불가)";
  }

  return [
    `# 상황`,
    `섹션: ${section}`,
    `ML 예측 공구 수명: ${pred ?? "N/A"} min`,
    `Sandvik baseline: ${sandvik ?? "N/A"} min`,
    diffPct !== null ? `→ 차이: ${diffPct}%` : null,
    ``,
    `# 상위 SHAP 기여도`,
    shapLines,
    ``,
    `# 인과 그래프 엣지`,
    edgesBlock,
    ``,
    `# 상태 스냅샷`,
    "```json",
    stateSnap,
    "```",
    ``,
    `위 정보를 바탕으로 시스템 프롬프트에서 지정한 5단계 구조(요약/Why/What/Counterfactual/마무리)를 지켜 한국어로 설명해주세요.`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    /* keep empty */
  }

  const userMessage = buildUserMessage(body);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          /* noop */
        }
      };
      const safeClose = () => {
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };

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

      try {
        const client = new Anthropic({ apiKey });
        const mstream = client.messages.stream({
          model: MODEL_ID,
          max_tokens: 1024,
          system: CAUSAL_XAI_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        });

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
