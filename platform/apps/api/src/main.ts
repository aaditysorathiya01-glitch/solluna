import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './common/config';
import { BillingService } from './billing/billing.service';

async function bootstrap() {
  // rawBody is required to verify Razorpay webhook signatures byte-for-byte.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api');
  // Proxy hops in front of the API: 1 behind Caddy; 2 on Render (Render edge → web proxy → Render edge → API).
  app.getHttpAdapter().getInstance().set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.enableShutdownHooks();
  await app.listen(config.port);
  Logger.log(`SOLLUNA API listening on :${config.port}`, 'Bootstrap');

  if (config.sweepIntervalMs > 0) {
    const billing = app.get(BillingService);
    setInterval(() => billing.sweep().catch((e) => Logger.error(e, 'Sweep')), config.sweepIntervalMs).unref();
  }
}
bootstrap();
