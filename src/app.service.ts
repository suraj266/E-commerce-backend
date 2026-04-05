import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): object {
    return {
      success: false,
      message: 'No route found for this request',
    };
  }
}
