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
    // -- Observability (Sentry) -- all optional; unset ⇒ Sentry no-ops.
    SENTRY_DSN: process.env.SENTRY_DSN as string | undefined,
    SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT as string | undefined,
    SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE as string | undefined,
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