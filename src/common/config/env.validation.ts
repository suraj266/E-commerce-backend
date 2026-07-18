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

    // -- Observability (Sentry) --
    // All optional: when SENTRY_DSN is unset the SDK initialises disabled and
    // every capture becomes a no-op. Set the DSN to start shipping errors.
    SENTRY_DSN: Joi.string().uri().optional(),
    SENTRY_ENVIRONMENT: Joi.string().optional(),
    SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).optional(),
}).unknown(true)
