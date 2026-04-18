import { NextRequest } from "next/server"

const PYTHON_API = process.env.PYTHON_API_URL || "http://127.0.0.1:8010"

export const maxDuration = 120
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const body = await req.text()
  try {
    const upstream = await fetch(`${PYTHON_API}/products/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body,
      // Pass through aborts so Python stops work when the client disconnects.
      signal: req.signal,
    })
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "")
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
    return new Response(
      JSON.stringify({ error: `Python stream unreachable: ${e?.message ?? e}` }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    )
  }
}
