import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';

import { EmailConfigService } from './email-config.service';
import { EmailTemplateService } from './email-template.service';
import { EmailService } from './email.service';

import { EmailSetting } from './entities/email-setting.entity';
import { EmailTemplate } from './entities/email-template.entity';
import { SendTestResult } from './entities/email-log.entity';

import { UpdateEmailSettingInput } from './dto/update-email-setting.input';
import { UpdateEmailTemplateInput } from './dto/update-email-template.input';
import { SendTestEmailInput } from './dto/send-test-email.input';

import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';

@Resolver()
export class EmailResolver {
  constructor(
    private readonly configSvc: EmailConfigService,
    private readonly templateSvc: EmailTemplateService,
    private readonly emailSvc: EmailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('email:read')
  @Query(() => EmailSetting, { name: 'emailSetting' })
  emailSetting() {
    return this.configSvc.getSafe();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('email:update')
  @Mutation(() => EmailSetting)
  updateEmailSetting(
    @Args('input') input: UpdateEmailSettingInput,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    return this.configSvc.update(input, user?.userId);
  }

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('email:read')
  @Query(() => [EmailTemplate], { name: 'emailTemplates' })
  emailTemplates() {
    return this.templateSvc.list();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('email:read')
  @Query(() => EmailTemplate, { name: 'emailTemplate' })
  emailTemplate(@Args('id', { type: () => ID }) id: string) {
    return this.templateSvc.getById(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('email:update')
  @Mutation(() => EmailTemplate)
  updateEmailTemplate(
    @Args('input') input: UpdateEmailTemplateInput,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    return this.templateSvc.update(input, user?.userId);
  }

  // ---------------------------------------------------------------------------
  // Send test
  // ---------------------------------------------------------------------------
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('email:update')
  @Mutation(() => SendTestResult)
  async sendTestEmail(
    @Args('input') input: SendTestEmailInput,
  ): Promise<SendTestResult> {
    if (input.templateKey) {
      const result = await this.emailSvc.send(input.templateKey, input.to, {
        // Sample context — admin sees a rendered preview for these fields.
        customerName: 'Test Customer',
        sellerName: 'Test Seller',
        orderNumber: 'ORD-TEST-12345',
        resetLink: 'https://example.com/reset?token=test',
        verificationLink: 'https://example.com/verify?token=test',
        shopName: 'Your Store',
      });
      return {
        success: result.sent,
        message:
          result.message ??
          (result.sent
            ? `Test email sent to ${input.to}.`
            : 'Send failed for an unknown reason.'),
      };
    }

    const result = await this.emailSvc.sendRaw({
      to: input.to,
      subject: 'SMTP test from Admin',
      html:
        '<p>This is a test email from your admin panel. ' +
        'If you can read this, your SMTP credentials are working. 🎉</p>',
    });
    return {
      success: result.sent,
      message:
        result.message ??
        (result.sent
          ? `Test email sent to ${input.to}.`
          : 'Send failed for an unknown reason.'),
    };
  }
}
