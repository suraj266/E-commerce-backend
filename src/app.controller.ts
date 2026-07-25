import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  /** GET / — root fallback returning a "no route found" JSON stub. Public. */
  @Get()
  getHello(): object {
    return this.appService.getHello();
  }
}
