import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private logger = new Logger('HTTP');
  use(req: Request, res: Response, next: (err?: any) => void) {
    const { ip, method, baseUrl } = req;
    const userAgent = req.get('user-agent') || '';
    const startAt = process.hrtime();
    res.on('finish', () => {
      const { statusCode } = res;
      const conentLength = res.get('content-length');
      const dif = process.hrtime(startAt);
      const resTime = dif[0] * 1e3 + dif[1] * 1e-6;
      this.logger.log(
        `
        Method is: ${method}
        BaseUrl: ${baseUrl}
        status code: ${statusCode}
        content length: ${conentLength}kb
        response time: ${resTime.toFixed(2)}ms
        user-agent: ${userAgent}
         ip: ${ip}
        `,
      );
    });
    next();
  }
}
