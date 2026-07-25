import { Field, InputType } from '@nestjs/graphql';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Admin composes a broadcast campaign. `htmlBody` is admin-authored HTML that is
 * injected verbatim into the `newsletter_campaign` wrapper template at send time
 * (which supplies the header/footer + unsubscribe link). Only newsletter:send
 * holders can create/send (see NewsletterCampaignResolver).
 */
@InputType()
export class CreateNewsletterCampaignInput {
  @Field(() => String)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject: string;

  @Field(() => String)
  @IsString()
  @MinLength(1)
  @MaxLength(100_000)
  htmlBody: string;
}
