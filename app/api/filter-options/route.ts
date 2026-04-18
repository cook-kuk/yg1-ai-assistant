import { NextRequest, NextResponse } from "next/server"

const PYTHON_API = process.env.PYTHON_API_URL || "http://127.0.0.1:8010"

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const resp = await fetch(`${PYTHON_API}/filter-options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      return NextResponse.json({ error: `Python API error: ${resp.status}` }, { status: resp.status })
    }
    return NextResponse.json(await resp.json())
  } catch (e: any) {
    return NextResponse.json({ error: `Python API unreachable: ${e.message}` }, { status: 502 })
  }
}
