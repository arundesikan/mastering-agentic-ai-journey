import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy to the Anthropic API.
 *
 * The whole reason this route exists: the API key stays on the server.
 * The browser calls /api/agent, this route adds the credential and forwards.
 * A key in client-side code is readable by anyone who opens devtools.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on the server." },
      { status: 500 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Only forward the fields we expect. Never let the client set the model
  // to something arbitrary or pass through unexpected parameters.
  const payload: Record<string, unknown> = {
    model: "claude-sonnet-4-6",
    max_tokens: Math.min(Number(body.max_tokens) || 1000, 4000),
    messages: body.messages,
  };
  if (body.system) payload.system = body.system;
  if (body.tools) payload.tools = body.tools;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream ${res.status}`, detail: text.slice(0, 500) },
        { status: res.status }
      );
    }

    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Upstream request failed", detail: String(e?.message ?? e) },
      { status: 502 }
    );
  }
}
