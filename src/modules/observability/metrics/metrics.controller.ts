/**
 * P3-04 — Secured /metrics controller.
 *
 * Passed to `PrometheusModule.register({ controller: MetricsController })`,
 * which mounts it at the configured base path (default `metrics`) IN PLACE of
 * the library's default (open) controller — so exposition is secured by
 * `MetricsAuthGuard`. Leaving `@Controller()` + `@Get()` bare lets `register`
 * apply that base path, yielding `GET /metrics`.
 *
 * CRITICAL: we write the response with a library-specific `@Res()` (NO
 * passthrough) and `res.end()`. The app installs a GLOBAL `ResponseInterceptor`
 * (main.ts) that wraps every non-GraphQL HTTP body in a `{ success, data, … }`
 * JSON envelope — which would corrupt the Prometheus text format. Handling the
 * response object directly bypasses that transform, so scrapers receive raw
 * `text/plain; version=0.0.4` exposition. We serialise the DEFAULT prom-client
 * registry, where all app metrics + the default Node/runtime metrics live.
 */

import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { register } from 'prom-client';
import { MetricsAuthGuard } from './metrics-auth.guard';

@Controller()
export class MetricsController {
  /** GET /metrics — raw Prometheus exposition (text/plain, bypasses the JSON envelope). Auth: MetricsAuthGuard scrape token. */
  @Get()
  @UseGuards(MetricsAuthGuard)
  async index(@Res() response: Response): Promise<void> {
    response.setHeader('Content-Type', register.contentType);
    response.end(await register.metrics());
  }
}
