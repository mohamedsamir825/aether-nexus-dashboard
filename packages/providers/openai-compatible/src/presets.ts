/**
 * Base URLs for endpoints that speak the OpenAI chat-completions shape.
 *
 * These are DEFAULTS only, and every one is overridable through configuration
 * (`NEXUS_<PROVIDER>_BASE_URL`). Deliberately absent: model catalogues. Context
 * windows, output caps and pricing are facts about a vendor's current offering
 * that this file cannot know and must not guess -- inventing them would be
 * exactly the fabricated data the project forbids. Supply them in configuration.
 */
export interface OpenAICompatiblePreset {
  readonly baseUrl: string;
  /** Environment variable holding the credential, if the endpoint needs one. */
  readonly apiKeyEnv?: string;
}

export const OPENAI_COMPATIBLE_PRESETS = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', apiKeyEnv: 'NEXUS_GROQ_API_KEY' },
  cerebras: { baseUrl: 'https://api.cerebras.ai/v1', apiKeyEnv: 'NEXUS_CEREBRAS_API_KEY' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'NEXUS_OPENROUTER_API_KEY' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', apiKeyEnv: 'NEXUS_MISTRAL_API_KEY' },
  sambanova: { baseUrl: 'https://api.sambanova.ai/v1', apiKeyEnv: 'NEXUS_SAMBANOVA_API_KEY' },
  openai: { baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'NEXUS_OPENAI_API_KEY' },
  /** Local runtimes need no credential; the same wire shape applies. */
  ollama: { baseUrl: 'http://localhost:11434/v1' },
} as const satisfies Record<string, OpenAICompatiblePreset>;

export type OpenAICompatiblePresetName = keyof typeof OPENAI_COMPATIBLE_PRESETS;
