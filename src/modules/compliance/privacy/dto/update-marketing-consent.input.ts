import { InputType, Field } from '@nestjs/graphql';

/**
 * Customer toggles their marketing-email consent on /account/privacy. Every
 * toggle appends a new (immutable) ConsentRecord — there is no "edit"; the
 * latest row is the current state.
 */
@InputType()
export class UpdateMarketingConsentInput {
  @Field(() => Boolean)
  granted: boolean;
}
