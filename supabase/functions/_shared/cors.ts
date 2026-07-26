const defaultOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "";
  const configured = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const allowed = [...defaultOrigins, ...configured];
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
  if (allowed.some((entry) => entry === origin || (entry.startsWith("*.") && new URL(origin).hostname.endsWith(entry.slice(1))))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function options(request: Request): Response | null {
  return request.method === "OPTIONS" ? new Response(null, {status: 204, headers: corsHeaders(request)}) : null;
}
