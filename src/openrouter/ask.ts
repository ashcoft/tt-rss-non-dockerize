#!/usr/bin/env node
/**
 * End-to-end OpenRouter request from the command line.
 *
 * Usage:
 *   node --env-file=.env src/openrouter/ask.ts "What is tt-rss?"
 *
 * Options:
 *   --model <slug>   Model slug (default: $OPENROUTER_MODEL or DEFAULT_MODEL)
 *   --max-tokens <n> Cap on generated tokens
 *   --json           Print the full result as JSON
 *
 * Exits 0 on success, 1 on a failed request, 2 on missing configuration.
 */

/// <reference types="node" />

import { DEFAULT_MODEL, OpenRouterConfigError, OpenRouterRequestError, askModel } from './client.ts';

interface CliOptions {
  prompt: string;
  model?: string;
  maxTokens?: number;
  json: boolean;
}

function usage(): string {
  return [
    'Usage: node --env-file=.env src/openrouter/ask.ts "<prompt>" [options]',
    '',
    'Options:',
    '  --model <slug>    Model slug, e.g. nvidia/nemotron-3-ultra-550b-a55b:free',
    '  --max-tokens <n>  Cap on generated tokens',
    '  --json            Print the full result as JSON',
  ].join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { prompt: '', json: false };
  const words: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (arg === '--model') {
      const value = argv[++i];
      if (value === undefined) throw new OpenRouterConfigError('--model requires a value.');
      options.model = value;
    } else if (arg === '--max-tokens') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new OpenRouterConfigError('--max-tokens requires a positive integer.');
      }
      options.maxTokens = value;
    } else if (arg.startsWith('-')) {
      throw new OpenRouterConfigError(`Unknown option: ${arg}`);
    } else {
      words.push(arg);
    }
  }

  options.prompt = words.join(' ').trim();
  return options;
}

async function main(): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(usage());
    return 2;
  }

  if (options.prompt === '') {
    console.error('A prompt is required.');
    console.error(usage());
    return 2;
  }

  try {
    const result = await askModel(options.prompt, {
      model: options.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
      maxTokens: options.maxTokens,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.content);
      if (result.usage) {
        console.error(
          `[model=${result.model} tokens=${result.usage.totalTokens} cost=$${result.usage.cost ?? 0}]`
        );
      }
    }
    return 0;
  } catch (err) {
    if (err instanceof OpenRouterConfigError) {
      console.error(`Configuration error: ${err.message}`);
      return 2;
    }

    if (err instanceof OpenRouterRequestError) {
      console.error(`Request failed: ${err.message}`);
      return 1;
    }

    console.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}