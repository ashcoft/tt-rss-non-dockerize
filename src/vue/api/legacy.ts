/**
 * Legacy backend adapter for `backend.php`.
 *
 * The Vue client talks to the same legacy dispatch the Dojo client uses, so it
 * must reproduce the real wire contract rather than the external JSON API:
 *
 * - `backend.php` dispatches a handler class (`op`) and a method
 *   (`method`, lowercased). Unknown pairs answer with an `error` object.
 * - CSRF is validated from `$_POST['csrf_token']` only. A query-string token or
 *   the literal string `auto` never validates, so every request is POSTed and
 *   the real per-session token is sent in the body.
 * - Responses are not uniformly `{status, content}`. Most handlers print a
 *   plain JSON object, some print nothing, and errors use `{error: {code}}`.
 */

export type LegacyParam = string | number | boolean;
export type LegacyParams = Record<string, LegacyParam | LegacyParam[] | undefined>;

/** Thrown when the backend reports a structured error. */
export class LegacyApiError extends Error {
  readonly code: string;
  readonly params: Record<string, unknown>;

  constructor(code: string, params: Record<string, unknown> = {}) {
    const detail = Object.keys(params).length > 0 ? ` ${JSON.stringify(params)}` : '';
    super(`${code}${detail}`);
    this.name = 'LegacyApiError';
    this.code = code;
    this.params = params;
  }
}

/** Thrown when the request could not be completed as specified. */
export class LegacyProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyProtocolError';
  }
}

/** Thrown for operations that have no legacy `backend.php` equivalent. */
export class LegacyUnsupportedOperation extends Error {
  constructor(operation: string) {
    super(
      `The legacy backend.php does not expose an endpoint for "${operation}". ` +
        'This action requires the external JSON API (see VITE_MIGRATION.md).'
    );
    this.name = 'LegacyUnsupportedOperation';
  }
}

export interface LegacyResponse {
  /** Parsed JSON body, or `null` when the handler printed nothing / non-JSON. */
  body: Record<string, unknown> | null;
  /** Raw response text, kept for handlers that print plain text. */
  raw: string;
}

const CSRF_PLACEHOLDER = 'auto';

/**
 * Locates the session CSRF token.
 *
 * The PHP shell embeds it as `const __csrf_token = "...";`. There is no JSON
 * endpoint that returns it, so the shell is fetched and parsed when the global
 * is not already present. The literal `auto` is never returned: sending it can
 * never pass `validate_csrf()` and would silently mask a missing session.
 */
export async function fetchCsrfToken(shellPath = '/index.php'): Promise<string> {
  const win = window as unknown as Record<string, unknown>;
  const embedded = win.__csrf_token;
  if (typeof embedded === 'string' && embedded !== '' && embedded !== CSRF_PLACEHOLDER) {
    return embedded;
  }

  // The shell is served with an ETag and answers 304 when the client already
  // has a copy. After logging in the previous copy is stale (it embeds an empty
  // token), so the revalidation must be bypassed to get the authenticated body.
  const response = await fetch(shellPath, {
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'text/html', 'Cache-Control': 'no-cache' },
  });

  if (!response.ok) {
    throw new LegacyProtocolError(
      `Unable to load ${shellPath} to obtain a CSRF token (HTTP ${response.status}).`
    );
  }

  const html = await response.text();
  const match = /const\s+__csrf_token\s*=\s*"([^"]*)"/.exec(html);
  const token = match?.[1] ?? '';

  if (token === '' || token === CSRF_PLACEHOLDER) {
    throw new LegacyProtocolError(
      `${shellPath} did not contain a session CSRF token. The session is probably not authenticated.`
    );
  }

  return token;
}

/** Methods the backend accepts without a valid CSRF token. */
const CSRF_IGNORED = new Set([
  'feeds/index',
  'pref_feeds/getfeedtree',
  'pref_labels/getlabeltree',
  'pref_filters/getfiltertree',
]);

export class LegacyBackend {
  private readonly baseUrl: string;
  private csrfToken: string | null = null;

  constructor(baseUrl = '/backend.php') {
    this.baseUrl = baseUrl;
  }

  setCsrfToken(token: string): void {
    this.csrfToken = token;
  }

  getCsrfToken(): string | null {
    return this.csrfToken;
  }

  /** Read the token from the shell if it has not been captured yet. */
  async ensureCsrfToken(): Promise<string> {
    if (!this.csrfToken) {
      this.csrfToken = await fetchCsrfToken();
    }
    return this.csrfToken;
  }

  /**
   * Invoke `op`/`method` on the legacy backend.
   *
   * @throws {LegacyApiError} when the backend reports `{error: {code}}`.
   * @throws {LegacyProtocolError} when no CSRF token is available for a
   *   method that requires one, or when the HTTP request fails.
   */
  async call(op: string, method: string, params: LegacyParams = {}): Promise<LegacyResponse> {
    const body = encodeParams(op, method, params);

    if (this.requiresCsrf(op, method)) {
      body.set('csrf_token', await this.resolveCsrfToken(op, method));
    }

    const response = await this.send(op, method, body);
    const raw = await response.text();
    const parsed = parseBody(raw);
    throwIfBackendError(parsed, op, method);

    return { body: parsed, raw };
  }

  /** Methods listed in CSRF_IGNORED may be called before a session exists. */
  private requiresCsrf(op: string, method: string): boolean {
    return !CSRF_IGNORED.has(`${op}/${method}`.toLowerCase());
  }

  /**
   * Return a token the backend will accept, or refuse to send the request.
   * Guarding here is what keeps the previous client's bug from returning: an
   * empty or literal "auto" token can never pass `validate_csrf()`.
   */
  private async resolveCsrfToken(op: string, method: string): Promise<string> {
    const token = this.csrfToken ?? (await this.ensureCsrfToken());

    if (token === '' || token === CSRF_PLACEHOLDER) {
      throw new LegacyProtocolError(
        `Refusing to call ${op}->${method} without a real CSRF token.`
      );
    }

    return token;
  }

  private async send(op: string, method: string, body: URLSearchParams): Promise<Response> {
    let response: Response;

    try {
      response = await fetch(this.baseUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new LegacyProtocolError(`${op}->${method} request failed: ${detail}`);
    }

    if (!response.ok) {
      throw new LegacyProtocolError(`${op}->${method} returned HTTP ${response.status}.`);
    }

    return response;
  }
}

/** Encode op/method/params the way backend.php expects. */
function encodeParams(op: string, method: string, params: LegacyParams): URLSearchParams {
  const body = new URLSearchParams();
  body.set('op', op);

  if (method) {
    body.set('method', method);
  }

  for (const [key, value] of Object.entries(params)) {
    appendParam(body, key, value);
  }

  return body;
}

function appendParam(body: URLSearchParams, key: string, value: LegacyParams[string]): void {
  if (value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      body.append(`${key}[]`, String(entry));
    }
    return;
  }

  body.set(key, String(value));
}

/** Turn a structured `{error: {...}}` body into a LegacyApiError. */
function throwIfBackendError(
  parsed: Record<string, unknown> | null,
  op: string,
  method: string
): void {
  const error = parsed?.error;

  if (isErrorObject(error)) {
    throw new LegacyApiError(error.code, error.params);
  }

  void op;
  void method;
}

function parseBody(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // Handlers such as Pref_Feeds/inactiveFeeds print a top-level array.
    return { data: parsed };
  } catch {
    // Several mutating handlers (renameCat, removeCat, addCat, remove) print
    // nothing or plain text on success. Treat non-JSON as an opaque success.
    return null;
  }
}

function isErrorObject(value: unknown): value is { code: string; params: Record<string, unknown> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

/** Narrow a legacy body field to an array, rejecting malformed payloads. */
export function expectArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new LegacyProtocolError(`${context}: expected an array, received ${typeof value}.`);
  }
  return value;
}

/** Narrow a legacy body field to an object, rejecting malformed payloads. */
export function expectObject(
  value: unknown,
  context: string
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LegacyProtocolError(`${context}: expected an object, received ${typeof value}.`);
  }
  return value as Record<string, unknown>;
}

export const legacyBackend = new LegacyBackend();
export default legacyBackend;
