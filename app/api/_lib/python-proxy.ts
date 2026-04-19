/**
 * Shared plumbing for the /api/products* and /api/filter-options routes
 * that each forward to the FastAPI service. Before this the same three
 * lines (PYTHON_API URL + maxDuration + forward helper) were duplicated
 * across every route — drift risk.
 */
import { NextRequest, NextResponse } from "next/server"

export const PYTHON_API_URL = process.env.PYTHON_API_URL || "http://127.0.0.1:8010"

// Conservative upper bound for a Python round-trip that may include a CoT
// LLM call. Longer than the client's 60s budget so a stall surfaces as
// the client's timeout, not ours. Stream routes reuse this too since the
// SSE body still has to start within this window.
export const MAX_DURATION = 120

// Single line emitter so ops can grep `[python-proxy]` for every
// upstream incident without code changes per route. Wrapped in a try
// so a logger import failure never masks the original error.
function logProxyError(
  kind: "json" | "sse",
  path: string,
  status: number,
  message: string,
  detail?: string,
): void {
  try {
    // eslint-disable-next-line no-console
    console.error(
      `[python-proxy] ${kind} ${path} status=${status} msg=${JSON.stringify(message)}` +
      (detail ? ` detail=${JSON.stringify(detail.slice(0, 500))}` : ""),
    )
  } catch {
    /* swallow logging failures — original error already returned to caller */
  }
}

/** Forward a JSON POST to FastAPI and mirror the response as JSON. */
export async function proxyJson(req: NextRequest, path: string): Promise<NextResponse> {
  try {
    const body = await req.json()
    const resp = await fetch(`${PYTHON_API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "")
      logProxyError("json", path, resp.status, `upstream non-2xx`, detail)
      return NextResponse.json(
        { error: `Python API error: ${resp.status}`, detail: detail.slice(0, 500) },
        { status: resp.status },
      )
    }
    return NextResponse.json(await resp.json())
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    logProxyError("json", path, 502, msg)
    return NextResponse.json(
      { error: `Python API unreachable: ${msg}` },
      { status: 502 },
    )
  }
}

/** Forward a JSON POST to FastAPI as SSE — stream the upstream body
 * back verbatim with the headers the browser expects. Abort propagation
 * lets Python stop work as soon as the client disconnects. */
export async function proxySse(req: NextRequest, path: string): Promise<Response> {
  const body = await req.text()
  try {
    const upstream = await fetch(`${PYTHON_API_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body,
      signal: req.signal,
    })
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "")
      logProxyError("sse", path, upstream.status, "upstream non-2xx or empty body", detail)
      return new Response(
        JSON.stringify({ error: `Python stream error: ${upstream.status}`, detail }),
        { status: upstream.status, headers: { "Content-Type": "application/json" } },
      )
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    logProxyError("sse", path, 502, msg)
    return new Response(
      JSON.stringify({ error: `Python stream unreachable: ${msg}` }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    )
  }
}
