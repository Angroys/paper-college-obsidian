import { requestUrl, type RequestUrlParam } from "obsidian";

/**
 * `requestUrl` behind a `fetch` signature. Obsidian asks plugins to use
 * `requestUrl` instead of `fetch` so requests bypass CORS and behave the same
 * on desktop and mobile; keeping the `fetch` shape lets the API helpers stay
 * injectable with a plain fetch double in tests.
 */
export const obsidianFetch: typeof fetch = async (input, init) => {
  const param: RequestUrlParam = {
    url: requestTarget(input),
    method: init?.method ?? "GET",
    headers: plainHeaders(init?.headers),
    // Without this `requestUrl` rejects on 4xx/5xx, and the callers branch on
    // status codes themselves.
    throw: false,
  };
  if (typeof init?.body === "string") {
    param.body = init.body;
  }

  const response = await requestUrl(param);
  const hasBody = response.status !== 204 && response.status !== 304;
  return new Response(hasBody ? response.arrayBuffer : null, {
    status: response.status,
    headers: plainHeaders(response.headers),
  });
};

function requestTarget(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function plainHeaders(
  headers: HeadersInit | Record<string, string> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) {
    return result;
  }
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      result[key] = value;
    }
    return result;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}
