export interface ProviderHttpLimitsV1 {
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface ProviderJsonRequestV1 extends ProviderHttpLimitsV1 {
  label: string;
  url: string;
  secret: string;
  fetch: typeof globalThis.fetch;
  init: RequestInit;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;

export function validateProviderBaseUrlV1(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} baseUrl must be a valid URL`);
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && loopbackHosts.has(url.hostname));
  if (!allowed) throw new Error(`${label} baseUrl must use HTTPS or an explicit loopback host`);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} baseUrl cannot include credentials, query parameters, or fragments`);
  }
  return url.toString().replace(/\/+$/, '');
}

export function validateProviderLimitsV1(limits: ProviderHttpLimitsV1): Required<ProviderHttpLimitsV1> {
  const timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = limits.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('provider timeoutMs must be an integer between 1 and 120000');
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 10_000_000) {
    throw new Error('provider maxResponseBytes must be an integer between 1 and 10000000');
  }
  return { timeoutMs, maxResponseBytes };
}

export async function requestProviderJsonV1(input: ProviderJsonRequestV1): Promise<unknown> {
  const limits = validateProviderLimitsV1(input);
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) forwardAbort();
  else input.signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`${input.label} request timed out`));
  }, limits.timeoutMs);
  try {
    let response: Response;
    try {
      response = await input.fetch(input.url, { ...input.init, signal: controller.signal });
    } catch (error) {
      if (timedOut) throw new Error(`${input.label} request timed out`);
      throw redactProviderErrorV1(error, input.secret);
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > limits.maxResponseBytes) {
      throw new Error(`${input.label} response was too large`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limits.maxResponseBytes) throw new Error(`${input.label} response was too large`);
    const text = new TextDecoder().decode(bytes);
    if (!response.ok) {
      throw new Error(`${input.label} request failed (${response.status}): ${redactProviderTextV1(text.slice(0, 500), input.secret)}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`${input.label} response was not valid JSON`);
    }
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', forwardAbort);
  }
}

export function redactProviderTextV1(value: string, secret: string): string {
  return secret ? value.split(secret).join('[REDACTED]') : value;
}

function redactProviderErrorV1(error: unknown, secret: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(redactProviderTextV1(message, secret));
}
