import type { Config } from '../config.ts';
import type { Provider } from './types.ts';
import { MockProvider } from './mock.ts';
import { AnthropicProvider } from './anthropic.ts';
import { OpenAIProvider } from './openai.ts';

// Build the configured provider once at boot. A real vendor selected without a key falls back
// to the mock provider with a warning, so the server always boots and stays testable rather
// than crash-looping on a missing secret.
export function makeProvider(config: Config, warn: (msg: string) => void): Provider {
  switch (config.provider) {
    case 'anthropic':
      if (!config.anthropicKey) {
        warn('OFFICIAL_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty — using mock provider.');
        return new MockProvider();
      }
      return new AnthropicProvider(
        config.anthropicKey,
        config.anthropicBaseURL,
        config.model,
        config.maxTokens,
      );
    case 'openai':
      if (!config.openaiKey) {
        warn('OFFICIAL_PROVIDER=openai but OPENAI_API_KEY is empty — using mock provider.');
        return new MockProvider();
      }
      return new OpenAIProvider(
        config.openaiKey,
        config.openaiBaseURL,
        config.model,
        config.maxTokens,
      );
    default:
      return new MockProvider();
  }
}
