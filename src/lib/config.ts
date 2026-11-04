import { z } from "zod";

const envSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().min(1).default("harmonia-local"),
  GOOGLE_CLOUD_LOCATION: z.string().default("us-central1"),
  FIRESTORE_JOB_COLLECTION: z.string().default("jobs"),
  PUBSUB_STAGE_TOPIC: z.string().default("harmonia-stages"),
  PUBSUB_DATA_TOPIC: z.string().default("harmonia-data-work"),
  INTERNAL_API_TOKEN: z.string().min(1),
  AGENT_SERVICE_URL: z.string().url(),
  MODEL_API_KEY: z.string().min(1).optional(),
  META_API_BASE_URL: z.string().url().default("https://api.meta.ai/v1"),
  MODEL_ID: z.string().min(1).default("muse-spark-1.3"),
  MODEL_PRICING_VERSION: z.string().min(1).default("unconfigured"),
  DEFAULT_JOB_BUDGET_USD: z.string().regex(/^\d+\.\d{1,6}$/).default("5.00"),
  DEFAULT_JOB_APPROVAL_THRESHOLD_USD: z.string().regex(/^\d+\.\d{1,6}$/).default("1.00"),
  DEFAULT_WORKSPACE_BUDGET_USD: z.string().regex(/^\d+\.\d{1,6}$/).default("100.00"),
  PUBLIC_BASE_URL: z.string().url().optional(),
  ATTACHMENT_ALLOWED_ORIGINS: z.string().min(1).optional(),
});

const budgetEnvSchema = envSchema.pick({
  DEFAULT_JOB_BUDGET_USD: true,
  DEFAULT_JOB_APPROVAL_THRESHOLD_USD: true,
  DEFAULT_WORKSPACE_BUDGET_USD: true,
});

export function parseBudgetConfig(environment: Record<string, string | undefined>) {
  return budgetEnvSchema.parse(environment);
}

export type Config = z.infer<typeof envSchema>;

/** Parse a supplied runtime environment without mutating the process cache. */
export function parseConfig(environment: Record<string, string | undefined>): Config {
  return envSchema.parse(environment);
}

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration -> ${missing}`);
  }
  cached = parsed.data;
  return cached;
}

export function isEmulatorMode(): boolean {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.PUBSUB_EMULATOR_HOST);
}
