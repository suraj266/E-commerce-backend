import { StringValue } from "ms";

export const config = {
    JWT_SECRET: process.env.JWT_SECRET as string,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN as StringValue,
    JWT_ALGORITHM: process.env.JWT_ALGORITHM as Algorithm,
    FRONTEND_URL: process.env.FRONTEND_URL as string,
    REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET as string,
    REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN as string,
    NODE_ENV: process.env.NODE_ENV as string,
    PORT: process.env.PORT as string,
    // -- Durable outbox / BullMQ (P3-01) -- Redis connection string.
    REDIS_URL: process.env.REDIS_URL as string,
    // -- Observability (Sentry) -- all optional; unset ⇒ Sentry no-ops.
    SENTRY_DSN: process.env.SENTRY_DSN as string | undefined,
    SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT as string | undefined,
    SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE as string | undefined,
    // -- Soft-delete Prisma extension (P3-10) -- kill-switch, DEFAULT OFF.
    // When false (the default) PrismaService is a plain PrismaClient: no
    // $extends filter is built and runtime behavior is byte-for-byte unchanged.
    // Flip to 'true' only after the partial indexes are live and the manual
    // `deletedAt: null` filters have been reviewed. Parsed here (not via Joi's
    // coerced value) since config reads raw process.env; '' / unset ⇒ false.
    SOFT_DELETE_EXTENSION_ENABLED: process.env.SOFT_DELETE_EXTENSION_ENABLED === 'true',
    // -- Prometheus metrics (P3-04) --
    // METRICS_ENABLED (default ON): gates the secured /metrics endpoint AND the
    // Prisma query-duration timing extension composed into PrismaService. Parsed
    // from raw process.env (mirrors SOFT_DELETE_EXTENSION_ENABLED): unset ⇒ true,
    // 'false' ⇒ false. Set to 'false' to fully disable collection + exposition.
    METRICS_ENABLED: process.env.METRICS_ENABLED !== 'false',
    // Optional bearer token that secures GET /metrics. When set, scrapers must
    // send `Authorization: Bearer <token>`. When unset, /metrics is open (only
    // safe on a private network / behind an ingress ACL) — see ops/README.md.
    METRICS_AUTH_TOKEN: process.env.METRICS_AUTH_TOKEN as string | undefined,
}

export type Algorithm =
    | "HS256"
    | "HS384"
    | "HS512"
    | "RS256"
    | "RS384"
    | "RS512"
    | "ES256"
    | "ES384"
    | "ES512"
    | "PS256"
    | "PS384"
    | "PS512"
    | "none";