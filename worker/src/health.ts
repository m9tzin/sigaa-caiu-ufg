import type {
  CheckResult,
  Env,
  LayerResult,
  ReachabilityResult,
  Status,
} from "./types";

const SIGAA_URL = "https://sigaa.sistemas.ufg.br/sigaa/verTelaLogin.do";
// UFG uses CAS/SSO for authentication — no public SPA portal like UFPB.
// Layer 2 checks SSO availability; layer 3 verifies the CAS form fields.
const SSO_LOGIN_URL = "https://sso.ufg.br/cas/login?locale=pt_BR&service=https%3A%2F%2Fsigaa.sistemas.ufg.br%2Fsigaa%2FverTelaLogin.do";
const USER_AGENT = "sigaa-caiu-ufg-monitor/1.0";

const TIMEOUT_MS = 30_000;
const THRESHOLD_DEGRADED_MS = 10_000;
const RETRY_DELAY_MS = 3_000;
const MAX_RETRIES = 2;

export async function performHealthCheck(
  env: Env,
  shouldRunE2E: boolean
): Promise<CheckResult> {
  const reachability = await checkReachability();

  // Short-circuit higher layers when the host isn't even reachable — no point
  // probing the SPA/login form, and saves time/load on a degraded SIGAA.
  if (reachability.status === "offline") {
    return assemble(reachability, skipped(), skipped(), skipped());
  }

  const [portal, loginForm] = await Promise.all([
    checkPortal(),
    checkLoginForm(),
  ]);

  let loginE2e: LayerResult;
  if (!shouldRunE2E) {
    loginE2e = skipped();
  } else if (!env.SIGAA_MONITOR_USER || !env.SIGAA_MONITOR_PASS) {
    loginE2e = skipped();
  } else {
    loginE2e = await checkLoginE2E(env.SIGAA_MONITOR_USER, env.SIGAA_MONITOR_PASS);
  }

  return assemble(reachability, portal, loginForm, loginE2e);
}

function assemble(
  reachability: ReachabilityResult,
  portal: LayerResult,
  loginForm: LayerResult,
  loginE2e: LayerResult
): CheckResult {
  const overall = deriveOverall(reachability, portal, loginForm, loginE2e);

  // The top-level `error` mirrors whichever layer drove the failure, most specific wins.
  const overallError =
    reachability.status === "offline"
      ? reachability.error
      : portal.status === "offline"
        ? portal.error
        : loginForm.status === "offline"
          ? loginForm.error
          : loginE2e.status === "offline"
            ? loginE2e.error
            : reachability.error; // carries "degraded" slow-response context if any

  return {
    status: overall,
    httpCode: reachability.httpCode,
    responseTimeMs: reachability.responseTimeMs,
    error: overallError,
    reachability,
    portal,
    loginForm,
    loginE2e,
  };
}

export function deriveOverall(
  reachability: ReachabilityResult,
  portal: LayerResult,
  loginForm: LayerResult,
  loginE2e: LayerResult
): Status {
  if (reachability.status === "offline") return "offline";
  if (portal.status === "offline") return "offline";
  if (loginForm.status === "offline") return "offline";
  if (loginE2e.status === "offline") return "offline";
  if (reachability.status === "degraded") return "degraded";
  return "online";
}

// --- Layer 1: reachability ---

async function checkReachability(): Promise<ReachabilityResult> {
  let result = await singleReachability();

  if (result.status === "offline") {
    for (let i = 0; i < MAX_RETRIES; i++) {
      await sleep(RETRY_DELAY_MS);
      const retry = await singleReachability();
      if (retry.status !== "offline") return retry;
      result = retry;
    }
  }

  return result;
}

async function singleReachability(): Promise<ReachabilityResult> {
  const start = Date.now();
  try {
    const res = await fetch(SIGAA_URL, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT },
    });

    const responseTimeMs = Date.now() - start;
    const status = determineReachabilityStatus(res.status, responseTimeMs);

    return {
      status,
      httpCode: res.status,
      responseTimeMs,
      error: null,
    };
  } catch (err) {
    const responseTimeMs = Date.now() - start;
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      status: "offline",
      httpCode: null,
      responseTimeMs,
      error: message,
    };
  }
}

function determineReachabilityStatus(httpCode: number, responseTimeMs: number): Status {
  const isExpected = httpCode === 302 || httpCode === 200;
  if (!isExpected || httpCode >= 500) return "offline";
  if (responseTimeMs >= THRESHOLD_DEGRADED_MS) return "degraded";
  return "online";
}

// --- Layer 2: SSO availability ---
// UFG has no public SPA portal. Instead, verify the CAS/SSO service is reachable
// and responding — students cannot log in if SSO is down even if SIGAA is up.

async function checkPortal(): Promise<LayerResult> {
  const start = Date.now();
  try {
    const res = await fetch(SSO_LOGIN_URL, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT },
    });

    if (res.status !== 200) return { status: "offline", error: `sso_http_${res.status}`, responseTimeMs: Date.now() - start };

    const body = await res.text();

    if (!body.includes('name="username"')) {
      return { status: "offline", error: "sso_missing_username_field", responseTimeMs: Date.now() - start };
    }

    return { status: "online", error: null, responseTimeMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return { status: "offline", error: `sso_fetch_error: ${message}`, responseTimeMs: Date.now() - start };
  }
}

// --- Layer 3: CAS login form fields ---
// Verify the SSO form renders all required fields (username, password, execution token).
// A missing execution token means CAS is degraded and cannot issue session tickets.

async function checkLoginForm(): Promise<LayerResult> {
  const start = Date.now();
  try {
    const res = await fetch(SSO_LOGIN_URL, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT },
    });

    if (res.status !== 200) return { status: "offline", error: `sso_form_http_${res.status}`, responseTimeMs: Date.now() - start };

    const body = await res.text();

    if (!body.includes('name="username"') || !body.includes('name="password"')) {
      return { status: "offline", error: "sso_form_missing_credentials_fields", responseTimeMs: Date.now() - start };
    }

    if (!body.includes('name="execution"')) {
      return { status: "offline", error: "sso_form_missing_execution_token", responseTimeMs: Date.now() - start };
    }

    return { status: "online", error: null, responseTimeMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return { status: "offline", error: `sso_form_fetch_error: ${message}`, responseTimeMs: Date.now() - start };
  }
}

// --- Layer 4: end-to-end login ---
// UFG's CAS enforces reCAPTCHA, making automated login impossible.
// This layer is always skipped — credentials are never set for UFG.
async function checkLoginE2E(_user: string, _pass: string): Promise<LayerResult> {
  return skipped();
}

// --- Helpers ---

function skipped(): LayerResult {
  return { status: "skipped", error: null, responseTimeMs: 0 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
