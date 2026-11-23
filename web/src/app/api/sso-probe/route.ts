// Relay for the Worker's SSO layers. sso.ufg.br refuses Cloudflare egress (525 since
// 2026-11-19), so the Worker asks us to fetch the page from outside Cloudflare.
// The target is fixed: this is not a general-purpose proxy.
const SSO_LOGIN_URL = "https://sso.ufg.br/cas/login?locale=pt_BR&service=https%3A%2F%2Fsigaa.sistemas.ufg.br%2Fsigaa%2FverTelaLogin.do";
const USER_AGENT = "sigaa-caiu-ufg-monitor/1.0";

export const dynamic = "force-dynamic";
export const preferredRegion = "gru1";

export async function GET(request: Request) {
  const secret = process.env.SSO_PROBE_SECRET;
  if (!secret) return new Response("probe not configured", { status: 503 });
  if (request.headers.get("x-probe-secret") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const res = await fetch(SSO_LOGIN_URL, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
      headers: { "User-Agent": USER_AGENT },
    });

    return new Response(await res.text(), {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-upstream-status": String(res.status),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return new Response(`sso_probe_fetch_error: ${message}`, {
      status: 502,
      headers: { "cache-control": "no-store" },
    });
  }
}
