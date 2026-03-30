import { NextRequest, NextResponse } from "next/server";

const UPSTREAM = "https://api.appliedbas.com/v1/pdf/sr";

/**
 * Proxies PDF generation to Applied BAS so the browser does not call the API
 * cross-origin (avoids CORS / "Failed to fetch" when the API omits CORS headers).
 */
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json(
      { message: "Authorization must start with 'Bearer '" },
      { status: 401 }
    );
  }

  const body = await request.text();

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
      },
      body,
    });
  } catch (err) {
    console.error("PDF SR proxy upstream fetch failed:", err);
    return NextResponse.json(
      {
        message:
          "Unable to reach the PDF service from the server. Check network or API availability.",
      },
      { status: 502 }
    );
  }

  const raw = await upstream.text();
  const contentType =
    upstream.headers.get("content-type") || "application/json";

  return new NextResponse(raw, {
    status: upstream.status,
    headers: { "Content-Type": contentType },
  });
}
