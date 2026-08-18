import { PLUGIN_COPY } from "./copy";
import type { ExchangeFailure, ExchangeResult } from "./types";
import { bearerHeaders, pairingExchangeUrl } from "./urls";

export function normalizePairingCode(raw: string): string | null {
  const digits = raw.replace(/\s+/g, "");
  if (!/^\d{8}$/.test(digits)) {
    return null;
  }
  return digits;
}

export function mapExchangeError(
  status: number,
  body: unknown,
): ExchangeFailure["kind"] {
  const code =
    body && typeof body === "object" && "code" in body
      ? String((body as { code?: unknown }).code)
      : "";
  if (status === 400 || code === "invalid_code") {
    return "invalid_code";
  }
  if (status === 410 || code === "expired_code") {
    return "expired_code";
  }
  if (status === 0) {
    return "offline";
  }
  return "unknown";
}

export function exchangeErrorMessage(kind: ExchangeFailure["kind"]): string {
  if (kind === "invalid_code") {
    return PLUGIN_COPY.connectInvalidCode;
  }
  if (kind === "expired_code") {
    return PLUGIN_COPY.connectExpiredCode;
  }
  return PLUGIN_COPY.offline;
}

export async function exchangePairingCode(
  fetchFn: typeof fetch,
  baseUrl: string,
  code: string,
  vaultName: string,
): Promise<ExchangeResult> {
  const normalized = normalizePairingCode(code);
  if (!normalized) {
    return { ok: false, kind: "invalid_code", status: 400 };
  }

  let response: Response;
  try {
    response = await fetchFn(pairingExchangeUrl(baseUrl), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: normalized, vaultName }),
    });
  } catch {
    return { ok: false, kind: "offline", status: 0 };
  }

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      kind: mapExchangeError(response.status, json),
      status: response.status,
    };
  }

  if (!json || typeof json !== "object") {
    return { ok: false, kind: "unknown", status: response.status };
  }
  const record = json as Record<string, unknown>;
  if (
    typeof record.token !== "string" ||
    typeof record.deviceId !== "string" ||
    typeof record.accountLabel !== "string"
  ) {
    return { ok: false, kind: "unknown", status: response.status };
  }

  return {
    ok: true,
    token: record.token,
    deviceId: record.deviceId,
    accountLabel: record.accountLabel,
  };
}

export { bearerHeaders };
