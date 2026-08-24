import type { AuthStore, OAuthCredential } from "./store.ts";

/**
 * Codex OAuth: device-authorization flow against OpenAI's auth service.
 * Designed for "sign in with your ChatGPT account" — no API key needed.
 *
 * The flow:
 *   1. POST /device/code        → device_code + user_code + verification_uri
 *   2. User opens verification_uri, enters user_code
 *   3. We poll /token until approved
 *   4. Tokens stored via AuthStore (0600); refreshed automatically when expired
 *
 * Endpoints are configurable — OpenAI has moved auth infra before.
 */

export interface CodexOAuthConfig {
  deviceCodeUrl: string;
  tokenUrl: string;
  clientId: string;
  scopes: string;
}

export const DEFAULT_CODEX_OAUTH: CodexOAuthConfig = {
  deviceCodeUrl: "https://auth.openai.com/oauth/device/code",
  tokenUrl: "https://auth.openai.com/oauth/token",
  clientId: "mosaic-cli",
  scopes: "openid profile offline_access",
};

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

export async function requestDeviceCode(
  config: CodexOAuthConfig = DEFAULT_CODEX_OAUTH,
  fetchFn: typeof fetch = fetch,
): Promise<DeviceCodeResponse> {
  const res = await fetchFn(config.deviceCodeUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      scope: config.scopes,
    }),
  });
  if (!res.ok) throw new Error(`Device code request failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as Record<string, unknown>;
  return {
    deviceCode: String(data.device_code),
    userCode: String(data.user_code),
    verificationUri: String(data.verification_uri ?? data.verification_url),
    verificationUriComplete: data.verification_uri_complete ? String(data.verification_uri_complete) : undefined,
    expiresIn: Number(data.expires_in ?? 900),
    interval: Number(data.interval ?? 5),
  };
}

export interface PollCallbacks {
  onPending?: (elapsedSeconds: number) => void;
  signal?: AbortSignal;
}

/** Poll the token endpoint until the user approves, the code expires, or abort. */
export async function pollForToken(
  deviceCode: string,
  config: CodexOAuthConfig = DEFAULT_CODEX_OAUTH,
  callbacks: PollCallbacks = {},
  fetchFn: typeof fetch = fetch,
): Promise<OAuthCredential> {
  const deadline = Date.now() + 15 * 60 * 1000;
  let interval = 5;

  while (Date.now() < deadline) {
    if (callbacks.signal?.aborted) throw new Error("Login cancelled");

    const res = await fetchFn(config.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: config.clientId,
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      return {
        kind: "oauth",
        accessToken: String(data.access_token),
        refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
        expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : undefined,
      };
    }

    const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const code = String(err.error ?? "");
    if (code === "authorization_pending") {
      callbacks.onPending?.(Math.round((Date.now() - (deadline - 15 * 60 * 1000)) / 1000));
    } else if (code === "slow_down") {
      interval += 5;
    } else if (code === "expired_token" || code === "access_denied") {
      throw new Error(`Login failed: ${code}`);
    } else {
      throw new Error(`Token polling error: ${res.status} ${JSON.stringify(err)}`);
    }

    await Bun.sleep(interval * 1000);
  }
  throw new Error("Device code expired — run `mosaic login` again");
}

/** Refresh an expired OAuth credential, persisting the new one. */
export async function refreshToken(
  credential: OAuthCredential,
  store: AuthStore,
  provider: string,
  config: CodexOAuthConfig = DEFAULT_CODEX_OAUTH,
  fetchFn: typeof fetch = fetch,
): Promise<OAuthCredential> {
  if (!credential.refreshToken) throw new Error("No refresh token — run `mosaic login` again");
  const res = await fetchFn(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credential.refreshToken,
      client_id: config.clientId,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} — run \`mosaic login\` again`);
  const data = (await res.json()) as Record<string, unknown>;
  const next: OAuthCredential = {
    kind: "oauth",
    accessToken: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : credential.refreshToken,
    expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : undefined,
    accountId: credential.accountId,
  };
  await store.set(provider, next);
  return next;
}

export function isExpired(credential: OAuthCredential, skewMs = 60_000): boolean {
  return credential.expiresAt !== undefined && Date.now() > credential.expiresAt - skewMs;
}
