/**
 * Tests for the OpenRouter client.
 *
 * The success and error-response paths run against a local HTTP server that
 * speaks the real wire format, so the SDK's own request building, JSON parsing
 * and error mapping are all exercised. No network access is required and the
 * API key is never sent anywhere.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import {
  DEFAULT_MODEL,
  OpenRouterConfigError,
  OpenRouterRequestError,
  askModel,
} from '../../src/openrouter/client.ts';

/** Start a stub OpenRouter endpoint. `handler` returns [status, body] (or a promise of it). */
function startStubServer(handler) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', async () => {
        const [status, body] = await handler({ method: req.method, url: req.url, headers: req.headers, raw });
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/api/v1` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

const COMPLETION = {
  id: 'gen-test-1',
  object: 'chat.completion',
  created: 1,
  model: DEFAULT_MODEL,
  system_fingerprint: null,
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'Hello from the stub.' },
    },
  ],
  usage: { prompt_tokens: 7, completion_tokens: 4, total_tokens: 11, cost: 0 },
};

test('askModel throws a config error when the API key is missing', async () => {
  const saved = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  try {
    await assert.rejects(
      () => askModel('hello'),
      (err) => {
        assert.ok(err instanceof OpenRouterConfigError, `expected a config error, got ${err?.name}`);
        assert.match(err.message, /OPENROUTER_API_KEY is not set/);
        assert.match(err.message, /openrouter\.ai\/keys/);
        return true;
      }
    );
  } finally {
    if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
  }
});

test('askModel rejects an empty prompt before making a request', async () => {
  await assert.rejects(
    () => askModel('   ', { apiKey: 'test-key' }),
    (err) => {
      assert.ok(err instanceof OpenRouterConfigError, `expected a config error, got ${err?.name}`);
      return true;
    }
  );
});

test('askModel returns the completion and sends the documented request', async () => {
  let seen;
  const { server, baseUrl } = await startStubServer((req) => {
    seen = req;
    return [200, COMPLETION];
  });

  try {
    const result = await askModel('What is tt-rss?', {
      apiKey: 'test-key',
      baseUrl,
      maxTokens: 64,
    });

    assert.equal(result.content, 'Hello from the stub.');
    assert.equal(result.id, 'gen-test-1');
    assert.equal(result.model, DEFAULT_MODEL);
    assert.deepEqual(result.usage, {
      promptTokens: 7,
      completionTokens: 4,
      totalTokens: 11,
      cost: 0,
    });

    // The SDK must POST to /chat/completions with the bearer token in the header.
    assert.equal(seen.method, 'POST');
    assert.match(seen.url, /\/api\/v1\/chat\/completions$/);
    assert.equal(seen.headers.authorization, 'Bearer test-key');

    const payload = JSON.parse(seen.raw);
    assert.equal(payload.model, DEFAULT_MODEL);
    assert.deepEqual(payload.messages, [{ role: 'user', content: 'What is tt-rss?' }]);
    assert.equal(payload.max_tokens, 64);
    assert.equal(payload.stream, false);
  } finally {
    await closeServer(server);
  }
});

test('askModel honours an explicit model slug', async () => {
  let payload;
  const { server, baseUrl } = await startStubServer((req) => {
    payload = JSON.parse(req.raw);
    return [200, COMPLETION];
  });

  try {
    const result = await askModel('hi', {
      apiKey: 'test-key',
      baseUrl,
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    });

    assert.equal(payload.model, 'nvidia/nemotron-3-ultra-550b-a55b:free');
    assert.equal(result.model, DEFAULT_MODEL, 'the model reported by the API wins');
  } finally {
    await closeServer(server);
  }
});

test('askModel surfaces the API error message and status code', async () => {
  const { server, baseUrl } = await startStubServer(() => [
    404,
    { error: { message: 'No endpoints found for that model.', code: 404 } },
  ]);

  try {
    await assert.rejects(
      () => askModel('hi', { apiKey: 'test-key', baseUrl }),
      (err) => {
        assert.ok(err instanceof OpenRouterRequestError, `expected a request error, got ${err?.name}`);
        assert.equal(err.statusCode, 404);
        assert.match(err.message, /HTTP 404/);
        assert.match(err.message, /No endpoints found for that model\./);
        return true;
      }
    );
  } finally {
    await closeServer(server);
  }
});

test('askModel reports an unreachable endpoint as a request error', async () => {
  // Port 1 on loopback refuses connections immediately. Retries are disabled so
  // the test does not wait out the backoff window.
  await assert.rejects(
    () =>
      askModel('hi', {
        apiKey: 'test-key',
        baseUrl: 'http://127.0.0.1:1/api/v1',
        retries: { strategy: 'none' },
      }),
    (err) => {
      assert.ok(err instanceof OpenRouterRequestError, `expected a request error, got ${err?.name}`);
      assert.match(err.message, /Could not reach OpenRouter|OpenRouter request failed/);
      return true;
    }
  );
});

test('askModel rejects a response with no content', async () => {
  const { server, baseUrl } = await startStubServer(() => [
    200,
    {
      ...COMPLETION,
      choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: '' } }],
    },
  ]);

  try {
    await assert.rejects(
      () => askModel('hi', { apiKey: 'test-key', baseUrl }),
      (err) => {
        assert.ok(err instanceof OpenRouterRequestError, `expected a request error, got ${err?.name}`);
        assert.match(err.message, /empty completion/);
        assert.match(err.message, /length/);
        return true;
      }
    );
  } finally {
    await closeServer(server);
  }
});

test('askModel applies the timeout even when a cancellation signal is passed', async () => {
  // A review flagged that supplying a signal might disable the timeout. The
  // pinned SDK restores it (hooks/signal-hooks.js, issue #1123), so both the
  // timeout and the caller's signal must stay effective. Guard that here.
  const { server, baseUrl } = await startStubServer(() => {
    return new Promise((resolve) => setTimeout(() => resolve([200, COMPLETION]), 500));
  });

  try {
    const started = Date.now();
    await assert.rejects(
      () =>
        askModel('hi', {
          apiKey: 'test-key',
          baseUrl,
          signal: new AbortController().signal,
          timeoutMs: 100,
          retries: { strategy: 'none' },
        }),
      (err) => {
        assert.ok(err instanceof OpenRouterRequestError, `expected a request error, got ${err?.name}`);
        assert.match(err.message, /timed out|timeout/i);
        return true;
      }
    );
    assert.ok(Date.now() - started < 500, 'the timeout must fire before the stub responds');
  } finally {
    await closeServer(server);
  }
});

test('askModel aborts promptly when the caller cancels', async () => {
  const { server, baseUrl } = await startStubServer(() => {
    return new Promise((resolve) => setTimeout(() => resolve([200, COMPLETION]), 2000));
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50);

  try {
    const started = Date.now();
    await assert.rejects(
      () =>
        askModel('hi', {
          apiKey: 'test-key',
          baseUrl,
          signal: controller.signal,
          timeoutMs: 10_000,
          retries: { strategy: 'none' },
        }),
      (err) => {
        assert.ok(err instanceof OpenRouterRequestError, `expected a request error, got ${err?.name}`);
        return true;
      }
    );
    assert.ok(Date.now() - started < 1500, 'cancellation must abort before the stub responds');
  } finally {
    clearTimeout(timer);
    await closeServer(server);
  }
});

test('askModel reads a key from OPENROUTER_API_KEY and a base URL from the environment', async () => {
  const savedKey = process.env.OPENROUTER_API_KEY;
  const savedUrl = process.env.OPENROUTER_BASE_URL;

  let seen;
  const { server, baseUrl } = await startStubServer((req) => {
    seen = req;
    return [200, COMPLETION];
  });

  process.env.OPENROUTER_API_KEY = 'env-key';
  process.env.OPENROUTER_BASE_URL = baseUrl;

  try {
    const result = await askModel('from env');
    assert.equal(result.content, 'Hello from the stub.');
    assert.equal(seen.headers.authorization, 'Bearer env-key');
  } finally {
    await closeServer(server);
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedKey;
    if (savedUrl === undefined) delete process.env.OPENROUTER_BASE_URL;
    else process.env.OPENROUTER_BASE_URL = savedUrl;
  }
});
