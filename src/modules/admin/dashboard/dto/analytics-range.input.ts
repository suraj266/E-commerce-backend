import { InputType, Field, Int, registerEnumType } from '@nestjs/graphql';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Time-bucket granularity for the admin GMV / revenue series. Maps 1:1 to the
 * Postgres `date_trunc` unit used by the aggregation ('day' | 'week' | 'month').
 */
export enum AnalyticsBucket {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}

registerEnumType(AnalyticsBucket, {
  name: 'AnalyticsBucket',
  description: 'Granularity of a time-bucketed analytics series.',
});

/**
 * Bounded date-range + shaping controls for `adminAnalytics`. Every field is
 * optional; the service defaults to the last 30 days at DAY granularity and
 * clamps the span (max ~366 days) and top-N (1..20) so the aggregation can
 * never scan unbounded.
 */
@InputType()
export class AnalyticsRangeInput {
  /** Inclusive lower bound. Defaults to `to − 30 days` when omitted. */
  @Field(() => Date, { nullable: true })
  @IsOptional()
  from?: Date;

  /** Exclusive upper bound. Defaults to "now" when omitted. */
  @Field(() => Date, { nullable: true })
  @IsOptional()
  to?: Date;

  /** Series bucket size. Defaults to DAY. */
  @Field(() => AnalyticsBucket, { nullable: true })
  @IsOptional()
  @IsEnum(AnalyticsBucket)
  granularity?: AnalyticsBucket;

  /** Top-N cap for the product / seller leaderboards. Defaults to 5; clamped 1..20. */
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  topLimit?: number;
}
