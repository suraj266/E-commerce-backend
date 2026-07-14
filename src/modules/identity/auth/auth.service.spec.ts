import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep } from 'jest-mock-extended';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    // useMocker auto-provides a deep mock for every dependency (PrismaService,
    // JwtService, EmailService) so DI resolves without wiring real modules.
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService],
    })
      .useMocker(() => mockDeep())
      .compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
