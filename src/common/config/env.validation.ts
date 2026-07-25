import Joi from "joi";

export const envSchema = Joi.object({
    JWT_SECRET: Joi.string().required(),
    JWT_EXPIRES_IN: Joi.string().required(),
    JWT_ALGORITHM: Joi.string().required(),
    REFRESH_TOKEN_SECRET: Joi.string().required(),
    REFRESH_TOKEN_EXPIRES_IN: Joi.string().required(),
    FRONTEND_URL: Joi.string().required(),

    // -- Image module --
    // Default 'local' — swap to 's3' for production.
    IMAGE_PROVIDER: Joi.string().valid('local', 's3').default('local'),
    // Local provider
    LOCAL_UPLOAD_DIR: Joi.string().default('/app/uploads'),
    LOCAL_PUBLIC_BASE_URL: Joi.string().default('http://localhost:7000'),
    // S3 provider — required only when IMAGE_PROVIDER=s3
    AWS_S3_BUCKET: Joi.string().when('IMAGE_PROVIDER', {
        is: 's3', then: Joi.required(), otherwise: Joi.optional(),
    }),
    AWS_REGION: Joi.string().when('IMAGE_PROVIDER', {
        is: 's3', then: Joi.required(), otherwise: Joi.optional(),
    }),
    AWS_ACCESS_KEY_ID: Joi.string().when('IMAGE_PROVIDER', {
        is: 's3', then: Joi.required(), otherwise: Joi.optional(),
    }),
    AWS_SECRET_ACCESS_KEY: Joi.string().when('IMAGE_PROVIDER', {
        is: 's3', then: Joi.required(), otherwise: Joi.optional(),
    }),
    AWS_S3_PUBLIC_BASE_URL: Joi.string().optional(),

    // -- Payment module --
    // 32-byte AES key (64 hex chars) for encrypting gateway credentials in DB.
    // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    PAYMENT_ENCRYPTION_KEY: Joi.string().length(64).required(),

    // -- Durable outbox / BullMQ (P3-01) --
    // Redis connection string for the BullMQ queues that drive the transactional
    // outbox. REQUIRED: the app fails to boot without a reachable Redis (a Redis
    // health check pings it on bootstrap). Compose sets this to redis://redis:6379.
    REDIS_URL: Joi.string().uri().required(),

    // -- Observability (Sentry) --
    // All optional: when SENTRY_DSN is unset the SDK initialises disabled and
    // every capture becomes a no-op. Set the DSN to start shipping errors.
    SENTRY_DSN: Joi.string().uri().optional(),
    SENTRY_ENVIRONMENT: Joi.string().optional(),
    SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).optional(),

    // -- Soft-delete Prisma extension (P3-10) --
    // Kill-switch for the centralized soft-delete $extends filter in
    // PrismaService. Defaults OFF so enabling it is an explicit ops decision
    // made only after the partial `WHERE "deletedAt" IS NULL` indexes are live.
    // Joi coerces the 'true'/'false' env string to a boolean.
    SOFT_DELETE_EXTENSION_ENABLED: Joi.boolean().default(false),

    // -- Prometheus metrics (P3-04) --
    // METRICS_ENABLED gates the secured /metrics endpoint and the Prisma
    // query-timing extension. Defaults ON. METRICS_AUTH_TOKEN, when provided,
    // requires scrapers to present `Authorization: Bearer <token>`; when omitted
    // /metrics is open (intended for a private scrape network / ingress ACL).
    METRICS_ENABLED: Joi.boolean().default(true),
    METRICS_AUTH_TOKEN: Joi.string().optional(),

    // -- TCS §52 marketplace tax (P3-03) -- NEEDS CA SIGN-OFF for filing.
    // Operator identity stamped onto GSTR-8 exports; TCS_OPS_EMAIL receives the
    // by-10th deposit reminder. All optional — absence only degrades the export
    // header / reminder recipient, never blocks boot.
    OPERATOR_GSTIN: Joi.string().allow('').optional(),
    OPERATOR_LEGAL_NAME: Joi.string().allow('').optional(),
    TCS_OPS_EMAIL: Joi.string().email().allow('').optional(),
}).unknown(true)
