/**
 * Configuration.
 *
 * Two rules govern this file:
 *
 * 1. The environment is passed in, never read from a global. loadConfig() is a
 *    pure function of its input, which is why it is testable without mutating
 *    process.env.
 * 2. Secrets never leave here. `NexusConfig` carries API keys, and the only
 *    supported way to display configuration is `describeConfig`, which reports
 *    whether a credential is present -- never its value. There is no toString,
 *    no JSON serialisation helper, and nothing logs a provider entry directly.
 */
import { type Result, ok, err } from '../result.ts';
import { nexusError } from '../errors.ts';
import { type ProviderId, providerId as toProviderId } from '../ids.ts';
import type { LogLevel } from '../logger.ts';

export type RuntimeEnvironment = 'development' | 'test' | 'production';

/**
 * Providers NEXUS knows how to be configured for. Listing an id here does NOT
 * mean an adapter exists -- none do yet. It means the environment variable
 * convention is fixed, so adding the adapter is purely additive.
 */
export const KNOWN_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'xai',
  'groq',
  'cerebras',
  'mistral',
  'sambanova',
] as const;

export type KnownProviderId = (typeof KNOWN_PROVIDERS)[number];

const API_KEY_VARS: Record<KnownProviderId, string> = {
  anthropic: 'NEXUS_ANTHROPIC_API_KEY',
  openai: 'NEXUS_OPENAI_API_KEY',
  google: 'NEXUS_GOOGLE_API_KEY',
  openrouter: 'NEXUS_OPENROUTER_API_KEY',
  xai: 'NEXUS_XAI_API_KEY',
  groq: 'NEXUS_GROQ_API_KEY',
  cerebras: 'NEXUS_CEREBRAS_API_KEY',
  mistral: 'NEXUS_MISTRAL_API_KEY',
  sambanova: 'NEXUS_SAMBANOVA_API_KEY',
};

const BASE_URL_VARS: Record<KnownProviderId, string> = {
  anthropic: 'NEXUS_ANTHROPIC_BASE_URL',
  openai: 'NEXUS_OPENAI_BASE_URL',
  google: 'NEXUS_GOOGLE_BASE_URL',
  openrouter: 'NEXUS_OPENROUTER_BASE_URL',
  xai: 'NEXUS_XAI_BASE_URL',
  groq: 'NEXUS_GROQ_BASE_URL',
  cerebras: 'NEXUS_CEREBRAS_BASE_URL',
  mistral: 'NEXUS_MISTRAL_BASE_URL',
  sambanova: 'NEXUS_SAMBANOVA_BASE_URL',
};

export interface ProviderConfig {
  readonly id: ProviderId;
  /** Present only when the corresponding environment variable is set. */
  readonly apiKey?: string;
  readonly baseUrl?: string;
  /** True when a key is present; the router skips providers that are not. */
  readonly enabled: boolean;
}

export interface NexusConfig {
  readonly environment: RuntimeEnvironment;
  readonly logLevel: LogLevel;
  readonly providers: Readonly<Record<string, ProviderConfig>>;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

const ENVIRONMENTS: readonly string[] = ['development', 'test', 'production'];
const LOG_LEVELS: readonly string[] = ['debug', 'info', 'warn', 'error'];

export function loadConfig(source: EnvSource): Result<NexusConfig> {
  const environment = source['NEXUS_ENV'] ?? 'development';
  if (!ENVIRONMENTS.includes(environment)) {
    return err(
      nexusError('INVALID_INPUT', `NEXUS_ENV must be one of ${ENVIRONMENTS.join(', ')}`, {
        details: { received: environment },
      }),
    );
  }

  const logLevel = source['NEXUS_LOG_LEVEL'] ?? 'info';
  if (!LOG_LEVELS.includes(logLevel)) {
    return err(
      nexusError('INVALID_INPUT', `NEXUS_LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`, {
        details: { received: logLevel },
      }),
    );
  }

  const providers: Record<string, ProviderConfig> = {};
  for (const name of KNOWN_PROVIDERS) {
    const apiKey = source[API_KEY_VARS[name]]?.trim();
    const baseUrl = source[BASE_URL_VARS[name]]?.trim();
    providers[name] = {
      id: toProviderId(name),
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      enabled: Boolean(apiKey),
    };
  }

  return ok({
    environment: environment as RuntimeEnvironment,
    logLevel: logLevel as LogLevel,
    providers,
  });
}

export interface ProviderSummary {
  readonly id: string;
  readonly enabled: boolean;
  /** Whether a credential was found -- never the credential. */
  readonly credentialPresent: boolean;
  readonly baseUrlOverridden: boolean;
}

export interface ConfigSummary {
  readonly environment: RuntimeEnvironment;
  readonly logLevel: LogLevel;
  readonly providers: readonly ProviderSummary[];
}

/**
 * The ONLY safe way to render configuration. Anything printed to a log, an
 * event payload, a health report or a console must come from here.
 */
export function describeConfig(config: NexusConfig): ConfigSummary {
  return {
    environment: config.environment,
    logLevel: config.logLevel,
    providers: Object.values(config.providers).map((provider) => ({
      id: provider.id,
      enabled: provider.enabled,
      credentialPresent: provider.apiKey !== undefined,
      baseUrlOverridden: provider.baseUrl !== undefined,
    })),
  };
}

/** Redacts anything that looks like a credential before it reaches a log. */
export function redactSecrets(value: string, secrets: readonly (string | undefined)[]): string {
  return secrets.reduce<string>(
    (text, secret) => (secret && secret.length >= 8 ? text.split(secret).join('[REDACTED]') : text),
    value,
  );
}
