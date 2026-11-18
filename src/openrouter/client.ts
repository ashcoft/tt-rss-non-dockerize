/**
 * Server-side OpenRouter client.
 *
 * `OPENROUTER_API_KEY` is read from the environment, so this module must only
 * be imported by server-side or CLI code. Importing it from the Vue bundle
 * would leak the key to the browser.
 */

/// <reference types="node" />

import { OpenRouter } from '@openrouter/sdk';

/** Free model from https://openrouter.ai/models. */
export const DEFAULT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * The SDK's own default retries connection errors for up to an hour, which is
 * far too long for an interactive caller. Cap the total retry window instead.
 */
export const DEFAULT_RETRY: RetryPolicy = {
  strategy: 'backoff',
  backoff: {
    initialInterval: 500,
    maxInterval: 5_000,
    exponent: 1.5,
    maxElapsedTime: 15_000,
  },
  retryConnectionErrors: true,
};

export interface AskOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Overrides the API base URL. Tests use this to point at a local server. */
  baseUrl?: string;
  /** Overrides the environment variable. Tests use this to probe a missing key. */
  apiKey?: string;
  /** Retry policy for transient failures. Defaults to {@link DEFAULT_RETRY}. */
  retries?: RetryPolicy;
}

/**
 * Mirrors the SDK's `RetryConfig`, which is not re-exported from the package root.
 */
export type RetryPolicy =
  | { strategy: 'none' }
  | {
      strategy: 'backoff';
      backoff?: {
        initialInterval: number;
        maxInterval: number;
        exponent: number;
        /** Milliseconds spent retrying before giving up. */
        maxElapsedTime: number;
      };
      retryConnectionErrors?: boolean;
    };

export interface AskUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number | null;
}

export interface AskResult {
  content: string;
  model: string;
  id: string;
  usage?: AskUsage;
}

/** The key is missing or unusable, so no request was attempted. */
export class OpenRouterConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenRouterConfigError';
  }
}

/** The request was attempted and failed. */
export class OpenRouterRequestError extends Error {
  /** HTTP status, when the failure was an HTTP response. */
  readonly statusCode?: number;
  /** Raw response body, kept for diagnostics. */
  readonly body?: string;

  constructor(message: string, options: { statusCode?: number; body?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'OpenRouterRequestError';
    this.statusCode = options.statusCode;
    this.body = options.body;
  }
}

function resolveApiKey(explicit?: string): string {
  const key = explicit ?? process.env.OPENROUTER_API_KEY;
  if (!key || key.trim() === '') {
    throw new OpenRouterConfigError(
      'OPENROUTER_API_KEY is not set. Create a key at https://openrouter.ai/keys, then put it in ' +
        '.env as OPENROUTER_API_KEY=sk-or-v1-... and run `pnpm run ask "<prompt>"`, or export it first.'
    );
  }
  return key.trim();
}

function resolveBaseUrl(explicit?: string): string {
  // Override for EU in-region routing (https://eu.openrouter.ai/api/v1) or a
  // self-hosted gateway.
  return explicit ?? process.env.OPENROUTER_BASE_URL ?? DEFAULT_BASE_URL;
}

/** OpenRouter reports failures as `{"error": {"message": "...", "code": 404}}`. */
function messageFromBody(body: unknown): string | undefined {
  if (typeof body !== 'string' || body.trim() === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    const error = (parsed as { error?: unknown } | null)?.error;
    if (typeof error === 'string') return error;
    const message = (error as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message !== '') return message;
  } catch {
    // Not JSON: fall back to the raw text below.
  }
  return body.slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toRequestError(err: unknown): OpenRouterRequestError {
  if (err instanceof OpenRouterConfigError || err instanceof OpenRouterRequestError) return err;

  const statusCode = isRecord(err) && typeof err.statusCode === 'number' ? err.statusCode : undefined;
  const rawBody = isRecord(err) ? err.body : undefined;
  const detail = messageFromBody(rawBody);

  if (statusCode !== undefined) {
    const suffix = detail ? `: ${detail}` : '';
    return new OpenRouterRequestError(
      `OpenRouter request failed with HTTP ${statusCode}${suffix}`,
      { statusCode, body: typeof rawBody === 'string' ? rawBody : undefined, cause: err }
    );
  }

  const name = err instanceof Error ? err.name : 'Error';
  const message = err instanceof Error ? err.message : String(err);

  // The SDK signals transport failures (DNS, TLS, aborts) with its own classes.
  if (/ConnectionError|RequestTimeoutError|RequestAbortedError/.test(name)) {
    return new OpenRouterRequestError(`Could not reach OpenRouter (${name}): ${message}`, { cause: err });
  }

  return new OpenRouterRequestError(`OpenRouter request failed (${name}): ${message}`, { cause: err });
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }
  return '';
}

/**
 * Send a single prompt and return the assistant's reply.
 *
 * @throws {OpenRouterConfigError} when the API key is missing.
 * @throws {OpenRouterRequestError} when the request fails or the reply is empty.
 */
export async function askModel(prompt: string, options: AskOptions = {}): Promise<AskResult> {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new OpenRouterConfigError('A non-empty prompt is required.');
  }

  const apiKey = resolveApiKey(options.apiKey);

  const client = new OpenRouter({
    apiKey,
    serverURL: resolveBaseUrl(options.baseUrl),
    httpReferer: 'https://tt-rss.org',
    appTitle: 'tt-rss',
  });

  const requestOptions = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retries: options.retries ?? DEFAULT_RETRY,
    ...(options.signal ? { signal: options.signal } : {}),
  };

  let response;
  try {
    response = await client.chat.send(
      {
        chatRequest: {
          model: options.model ?? DEFAULT_MODEL,
          messages: [{ role: 'user', content: prompt }],
          maxTokens: options.maxTokens,
          temperature: options.temperature,
          stream: false,
        },
      },
      requestOptions
    );
  } catch (err) {
    throw toRequestError(err);
  }

  const choice = response.choices?.[0];
  const content = contentToText(choice?.message?.content);

  if (content === '') {
    const finishReason = choice?.finishReason ? ` (finish reason: ${choice.finishReason})` : '';
    throw new OpenRouterRequestError(`OpenRouter returned an empty completion${finishReason}.`, {
      body: JSON.stringify(response).slice(0, 500),
    });
  }

  return {
    content,
    model: response.model ?? options.model ?? DEFAULT_MODEL,
    id: response.id,
    usage: response.usage
      ? {
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
          cost: response.usage.cost,
        }
      : undefined,
  };
}
