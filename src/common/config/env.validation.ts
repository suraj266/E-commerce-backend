import Joi from "joi";

export const envSchema = Joi.object({
    JWT_SECRET: Joi.string().required(),
    JWT_EXPIRES_IN: Joi.string().required(),
    JWT_ALGORITHM: Joi.string().required(),
    REFRESH_TOKEN_SECRET: Joi.string().required(),
    REFRESH_TOKEN_EXPIRES_IN: Joi.string().required(),
    FRONTEND_URL: Joi.string().required(),
})