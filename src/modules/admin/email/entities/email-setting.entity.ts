import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';

export enum EmailMailer {
  SMTP = 'SMTP',
}
registerEnumType(EmailMailer, { name: 'EmailMailer' });

export enum EmailEncryption {
  NONE = 'NONE',
  TLS = 'TLS',
  SSL = 'SSL',
}
registerEnumType(EmailEncryption, { name: 'EmailEncryption' });

/**
 * Public-safe shape — `passwordEnc` is NEVER exposed. Instead the resolver
 * returns `hasPassword: boolean` and (optionally) a masked hint.
 */
@ObjectType()
export class EmailSetting {
  @Field(() => ID)
  id: string;

  @Field(() => EmailMailer)
  mailer: EmailMailer;

  @Field(() => String)
  host: string;

  @Field(() => Int)
  port: number;

  @Field(() => String)
  username: string;

  @Field(() => EmailEncryption)
  encryption: EmailEncryption;

  @Field(() => String)
  senderName: string;

  @Field(() => String)
  senderEmail: string;

  @Field(() => String, { nullable: true })
  localDomain?: string | null;

  /** True once host + username + sender are populated AND password is set. */
  @Field(() => Boolean)
  isConfigured: boolean;

  /** True if a password ciphertext is on file. Plaintext is never returned. */
  @Field(() => Boolean)
  hasPassword: boolean;

  @Field(() => Date)
  updatedAt: Date;
}
