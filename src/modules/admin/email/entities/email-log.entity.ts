import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';

export enum EmailLogStatus {
  SENT = 'SENT',
  FAILED = 'FAILED',
  QUEUED = 'QUEUED',
}
registerEnumType(EmailLogStatus, { name: 'EmailLogStatus' });

@ObjectType()
export class EmailLog {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  templateKey: string;

  @Field(() => String)
  toAddress: string;

  @Field(() => String)
  subject: string;

  @Field(() => EmailLogStatus)
  status: EmailLogStatus;

  @Field(() => String, { nullable: true })
  errorMessage?: string | null;

  @Field(() => Date)
  sentAt: Date;
}

@ObjectType()
export class SendTestResult {
  @Field(() => Boolean)
  success: boolean;

  @Field(() => String, { nullable: true })
  message?: string | null;
}
