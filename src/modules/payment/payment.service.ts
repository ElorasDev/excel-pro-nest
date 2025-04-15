import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { LessThan, Repository } from 'typeorm';
import { format } from 'date-fns';
import { User } from '../users/entities/user.entity';
import { Payment } from './entities/payment.entity';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { ConfigService } from '@nestjs/config';
import { CreateSubscriptionDto } from './dto/CreateSubscription.dto';
import { PaymentStatus } from './entities/enums/payment-status.enum';
import { SubscriptionPlan } from '../users/entities/enums/enums';

@Injectable()
export class PaymentsService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(PaymentsService.name);
  private readonly priceMapping: Record<string, string> = {
    basic: 'price_basic_monthly',
    pro: 'price_pro_monthly',
    premium: 'price_premium_yearly',
  };

  // تنظیم هزینه اشتراک اولیه
  private readonly firstTimeSubscriptionFee = 70; // $70 هزینه اشتراک اولیه
  private readonly firstTimeFeeProductId = 'prod_first_time_fee';

  // ارز پیش‌فرض - دلار کانادا
  private readonly defaultCurrency = 'cad';

  constructor(
    @InjectRepository(Payment)
    private paymentRepository: Repository<Payment>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private configService: ConfigService,
  ) {
    const secretKey = configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) throw new Error('Stripe secret key not configured.');
    // استفاده از نسخه API معتبر و به‌روز
    this.stripe = new Stripe(secretKey, { apiVersion: '2025-02-24.acacia' });
  }

  async createSubscription(
    dto: CreateSubscriptionDto,
  ): Promise<SubscriptionResponseDto> {
    const { priceId, userId, paymentMethodId, email, phone_number } = dto;

    this.logger.log(
      `Creating subscription with priceId: ${priceId}, userId: ${userId || 'Not provided'}`,
    );

    // اعتبارسنجی
    if (!priceId) {
      this.logger.error('PriceId is missing');
      throw new BadRequestException('PriceId is required');
    }

    try {
      // متغیرهای مورد نیاز
      let user = null;
      let customerId = null;
      let isFirstTimeSubscription = false;

      // تعیین شناسه قیمت Stripe
      let stripePriceId = priceId;

      // اگر priceId یکی از کلیدهای نگاشت است، آن را به شناسه Stripe تبدیل کنید
      if (this.priceMapping[priceId]) {
        stripePriceId = this.priceMapping[priceId];
        this.logger.log(
          `Mapped price key ${priceId} to Stripe price ID: ${stripePriceId}`,
        );
      } else {
        this.logger.log(
          `Using directly provided Stripe price ID: ${stripePriceId}`,
        );
      }

      // اگر userId ارائه شده است، سعی کنید کاربر را پیدا کنید
      if (userId) {
        this.logger.log(`Attempting to find user with ID: ${userId}`);
        user = await this.userRepository.findOne({
          where: { email },
        });

        if (user) {
          this.logger.log(`User found: ${user.id}`);

          // بررسی کنید آیا کاربر پرداخت‌های ACTIVE یا CANCELED قبلی در پایگاه داده دارد
          // این نشان می‌دهد که آنها در گذشته اشتراک داشته‌اند
          const previousPayments = await this.paymentRepository.count({
            where: [
              { user: { id: user.id }, status: PaymentStatus.ACTIVE },
              { user: { id: user.id }, status: PaymentStatus.CANCELED },
            ],
          });

          // اگر هیچ پرداخت ACTIVE یا CANCELED قبلی وجود نداشته باشد، این اولین بار آنها اشتراک است
          isFirstTimeSubscription = previousPayments === 0;
          this.logger.log(
            `Is first time subscription for user: ${isFirstTimeSubscription} (found ${previousPayments} previous payments)`,
          );

          // اگر کاربر وجود دارد، از مشتری Stripe آنها استفاده کنید یا جدید ایجاد کنید
          try {
            const customer = await this.getOrCreateStripeCustomer(user);
            customerId = customer.id;
          } catch (error) {
            this.logger.error(
              `Failed to get/create Stripe customer: ${error.message}`,
            );
            throw new InternalServerErrorException(
              'Failed to process customer information',
            );
          }
        } else {
          this.logger.log(
            `User with ID ${userId} not found - will proceed without user`,
          );
          isFirstTimeSubscription = true; // فرض کنید کاربران جدید مشترکان بار اول هستند
        }
      } else {
        // هیچ شناسه کاربری ارائه نشده است، فرض کنید اشتراک بار اول است
        isFirstTimeSubscription = true;
      }

      // اگر هیچ کاربری پیدا نشد یا هیچ userId ارائه نشده است، یک مشتری موقت Stripe ایجاد کنید
      if (!customerId) {
        this.logger.log(
          'Creating temporary Stripe customer without linked user',
        );
        try {
          const tempCustomer = await this.stripe.customers.create({
            metadata: { isTemporary: 'true' },
            email: email || undefined, // ارسال ایمیل اگر موجود باشد
          });
          customerId = tempCustomer.id;
          this.logger.log(
            `Created temporary Stripe customer with ID: ${customerId}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to create temporary customer: ${error.message}`,
          );
          throw new InternalServerErrorException(
            'Failed to create payment customer',
          );
        }
      }

      // مدیریت روش پرداخت
      let finalPaymentMethodId = paymentMethodId;
      if (!finalPaymentMethodId) {
        // فقط در محیط توسعه از روش پرداخت تست استفاده کنید
        if (this.configService.get<string>('NODE_ENV') !== 'production') {
          this.logger.log('Creating test payment method - NOT FOR PRODUCTION');
          const testPaymentMethod = await this.createTestPaymentMethod();
          finalPaymentMethodId = testPaymentMethod.id;
        } else {
          throw new BadRequestException(
            'Payment method is required in production environment',
          );
        }
      }

      // ایجاد اشتراک با مدیریت خطای مناسب
      try {
        // مهم: روش پرداخت را قبل از ایجاد اشتراک به مشتری متصل کنید
        if (finalPaymentMethodId) {
          try {
            this.logger.log(`Attaching payment method to customer`);
            await this.stripe.paymentMethods.attach(finalPaymentMethodId, {
              customer: customerId,
            });

            this.logger.log(`Setting payment method as default for customer`);
            await this.stripe.customers.update(customerId, {
              invoice_settings: {
                default_payment_method: finalPaymentMethodId,
              },
            });
          } catch (attachError) {
            this.logger.error(
              `Failed to attach payment method: ${attachError.message}`,
            );
            throw new BadRequestException(
              `Failed to attach payment method: ${attachError.message}`,
            );
          }
        }

        // ایجاد پارامترهای اشتراک
        const subscriptionParams: Stripe.SubscriptionCreateParams = {
          customer: customerId,
          items: [{ price: stripePriceId }],
          default_payment_method: finalPaymentMethodId,
          payment_settings: {
            payment_method_types: ['card'],
            save_default_payment_method: 'on_subscription',
          },
          expand: ['latest_invoice.payment_intent'],
        };

        // افزودن هزینه راه‌اندازی برای مشترکان بار اول
        if (isFirstTimeSubscription) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const subscriptionPrice =
              await this.stripe.prices.retrieve(stripePriceId);
            const currency = this.defaultCurrency;

            this.logger.log(
              `Adding setup fee of ${this.firstTimeSubscriptionFee} ${currency.toUpperCase()} for first-time subscriber`,
            );

            // دریافت یا ایجاد شناسه قیمت برای هزینه بار اول
            const priceId = await this.getOrCreateFirstTimeFeeProduct(currency);

            // افزودن هزینه به عنوان یک مورد خط به اولین فاکتور
            subscriptionParams.add_invoice_items = [
              {
                price: priceId,
                quantity: 1,
              },
            ];
            this.logger.log(
              `Added one-time registration fee using price: ${priceId}`,
            );
          } catch (feeError) {
            this.logger.error(
              `Failed to add first-time fee: ${feeError.message}`,
            );
            // ادامه بدون هزینه به جای شکست کل اشتراک
          }
        }

        this.logger.log(`Creating Stripe subscription for customer`);
        const subscription =
          await this.stripe.subscriptions.create(subscriptionParams);

        this.logger.log(`Subscription created with ID: ${subscription.id}`);

        // دریافت قصد پرداخت
        const invoice = subscription.latest_invoice as Stripe.Invoice;
        if (!invoice) {
          this.logger.error('No invoice found in subscription response');
          throw new Error('No invoice returned with subscription');
        }

        const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent;
        if (!paymentIntent) {
          this.logger.error('No payment intent found in invoice');
          throw new Error('No payment intent found in subscription invoice');
        }

        if (!paymentIntent.client_secret) {
          this.logger.error('No client secret found in payment intent');
          throw new Error('Stripe returned no client secret.');
        }

        // محاسبه مبلغ کل (اشتراک + هزینه یک‌بار اگر قابل اجرا باشد)
        let amount = (subscription.items.data[0].price.unit_amount || 0) / 100;
        if (isFirstTimeSubscription) {
          amount += this.firstTimeSubscriptionFee;
        }

        // محاسبه تاریخ پایان اشتراک
        const subscriptionEndDate = new Date(
          subscription.current_period_end * 1000,
        );
        this.logger.log(
          `Subscription will end on: ${subscriptionEndDate.toISOString()}`,
        );

        // ایجاد رکورد پرداخت
        const payment = this.paymentRepository.create({
          amount: amount,
          currency: this.defaultCurrency, // همیشه از CAD استفاده کنید
          status: PaymentStatus.ACTIVE,
          plan: this.determinePlanFromPrice(stripePriceId),
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: customerId,
          user: user ? user : null, // فقط اگر کاربر وجود داشته باشد
          isFirstTimePayment: isFirstTimeSubscription,
          subscriptionEndDate: subscriptionEndDate,
          reminderSent: false,
          expiredReminderCount: 0,
        });

        const savedPayment = await this.paymentRepository.save(payment);
        this.logger.log(
          `Payment record saved successfully with ID: ${savedPayment.id}`,
        );

        // اگر کاربری داریم، اطلاعات اشتراک آنها را به‌روز کنید
        if (user) {
          await this.userRepository.update(user.id, {
            activePlan: this.determinePlanFromPrice(stripePriceId),
            currentSubscriptionEndDate: subscriptionEndDate,
          });
          this.logger.log(
            `Updated user with active plan and subscription end date`,
          );
        }

        // ارسال پیامک به شماره موبایل کاربر در جهت خرید نهایی شده

        return {
          clientSecret: paymentIntent.client_secret,
          subscriptionId: subscription.id,
          currentPeriodEnd: subscriptionEndDate,
          userId: user?.id,
          stripeCustomerId: customerId,
          totalAmount: amount,
          currency: this.defaultCurrency,
          isFirstTimeSubscription: isFirstTimeSubscription,
        };
      } catch (stripeError) {
        this.logger.error(
          `Stripe subscription creation failed: ${stripeError.message}`,
          stripeError.stack,
        );

        // بازگرداندن خطای دقیق‌تر بر اساس نوع خطای Stripe
        if (stripeError.type === 'StripeCardError') {
          throw new BadRequestException(`Card error: ${stripeError.message}`);
        } else if (stripeError.type === 'StripeInvalidRequestError') {
          throw new BadRequestException(
            `Invalid request: ${stripeError.message}`,
          );
        }

        throw stripeError;
      }
    } catch (error) {
      this.logger.error(
        `Subscription creation failed: ${error.message}`,
        error.stack,
      );

      // بازپرتاب استثناهای خاص NestJS
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        `Subscription creation failed: ${error.message}`,
      );
    }
  }

  /**
   * دریافت یا ایجاد محصول هزینه اولیه با یک قیمت یک‌بار در ارز مشخص شده
   */
  private async getOrCreateFirstTimeFeeProduct(
    currency: string = 'cad', // پیش‌فرض به CAD
  ): Promise<string> {
    try {
      let product: Stripe.Product | null = null;
      let priceId: string | null = null;

      // ابتدا بررسی کنید که آیا محصول از قبل وجود دارد
      try {
        product = await this.stripe.products.retrieve(
          this.firstTimeFeeProductId,
        );
        this.logger.log(
          `Retrieved existing one-time fee product: ${product.id}`,
        );
      } catch {
        // محصول وجود ندارد، آن را ایجاد کنید
        this.logger.log(
          'One-time fee product not found, creating new product...',
        );
        product = await this.stripe.products.create({
          id: this.firstTimeFeeProductId,
          name: 'First-Time Registration Fee',
          description: 'One-time fee for new subscribers',
          active: true,
        });
        this.logger.log(
          `Created new one-time fee product with ID: ${product.id}`,
        );
      }

      // اکنون بررسی کنید که آیا قیمت موجود برای این محصول با ارز مناسب داریم
      const prices = await this.stripe.prices.list({
        product: product.id,
        active: true,
      });

      // به دنبال قیمتی با ارز منطبق باشید
      const matchingPrices = prices.data.filter(
        (price) => price.currency === currency.toLowerCase(),
      );

      if (matchingPrices.length > 0) {
        // از قیمت موجود با ارز مناسب استفاده کنید
        priceId = matchingPrices[0].id;
        this.logger.log(
          `Using existing price: ${priceId} with currency ${currency}`,
        );
      } else {
        // یک قیمت جدید برای محصول با ارز مشخص شده ایجاد کنید
        this.logger.log(
          `No active price found for product with currency ${currency}, creating new price...`,
        );
        const newPrice = await this.stripe.prices.create({
          product: product.id,
          unit_amount: this.firstTimeSubscriptionFee * 100, // تبدیل به سنت
          currency: currency.toLowerCase(),
        });
        priceId = newPrice.id;
        this.logger.log(`Created new one-time fee price with ID: ${priceId}`);
      }

      return priceId;
    } catch (error) {
      this.logger.error(
        `Failed to create/retrieve one-time fee product/price: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to create one-time fee product/price',
      );
    }
  }

  private determinePlanFromPrice(stripePriceId: string): SubscriptionPlan {
    // نگاشت معکوس: بررسی کنید آیا این یک شناسه قیمت از نگاشت داخلی ما است
    for (const [plan, priceId] of Object.entries(this.priceMapping)) {
      if (priceId === stripePriceId) {
        if (plan === 'basic') return SubscriptionPlan.FREE;
        if (plan === 'pro') return SubscriptionPlan.PRO;
        if (plan === 'premium') return SubscriptionPlan.PREMIUM;
      }
    }

    // اگر در نگاشت ما نیست، از شناسه قیمت استنتاج کنید
    if (stripePriceId.includes('basic')) {
      return SubscriptionPlan.FREE;
    } else if (stripePriceId.includes('pro')) {
      return SubscriptionPlan.PRO;
    } else if (stripePriceId.includes('premium')) {
      return SubscriptionPlan.PREMIUM;
    }

    // برگشت پیش‌فرض
    return SubscriptionPlan.FREE;
  }

  private async createTestPaymentMethod(): Promise<Stripe.PaymentMethod> {
    try {
      // فقط برای محیط‌های توسعه - هرگز در تولید استفاده نشود
      return await this.stripe.paymentMethods.create({
        type: 'card',
        card: {
          number: '4242424242424242',
          exp_month: 12,
          exp_year: new Date().getFullYear() + 2, // همیشه دو سال در آینده
          cvc: '123',
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create test PaymentMethod: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'Failed to create test PaymentMethod',
      );
    }
  }

  private async getOrCreateStripeCustomer(
    user: User,
  ): Promise<Stripe.Customer> {
    try {
      if (user.stripeCustomerId) {
        this.logger.log(`Retrieving existing Stripe customer`);
        const customer = await this.stripe.customers.retrieve(
          user.stripeCustomerId,
        );

        // بررسی کنید آیا مشتری حذف شده است
        if ((customer as any).deleted) {
          throw new Error('Customer was deleted');
        }

        return customer as Stripe.Customer;
      }

      this.logger.log(`Creating new Stripe customer for user`);
      const customer = await this.stripe.customers.create({
        email: user.email,
        name: user.fullname,
        metadata: { userId: user.id.toString() },
      });

      await this.userRepository.update(user.id, {
        stripeCustomerId: customer.id,
      });

      return customer;
    } catch (error) {
      this.logger.error(
        `Error in getOrCreateStripeCustomer: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    const webhookSecret = this.configService.get('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) throw new Error('Webhook secret is not configured');

    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret,
      );

      this.logger.log(`Received webhook event: ${event.type}`);

      switch (event.type) {
        case 'invoice.payment_succeeded':
          await this.handlePaymentSuccess(event.data.object as Stripe.Invoice);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionCancellation(
            event.data.object as Stripe.Subscription,
          );
          break;
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(
            event.data.object as Stripe.Checkout.Session,
          );
          break;
      }
    } catch (error) {
      this.logger.error(`Webhook error: ${error.message}`);
      throw new BadRequestException(`Webhook error: ${error.message}`);
    }
  }

  private async handleCheckoutSessionCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    this.logger.log(`Processing checkout session completed: ${session.id}`);

    // دریافت شناسه مشتری از جلسه
    const customerId = session.customer as string;
    if (!customerId) {
      this.logger.error('No customer ID found in checkout session');
      return;
    }

    // یافتن کاربر با شناسه مشتری
    const user = await this.userRepository.findOne({
      where: { stripeCustomerId: customerId },
    });

    if (!user) {
      this.logger.warn(`User not found for customer ID: ${customerId}`);
      return;
    }

    // به‌روزرسانی رکورد کاربر برای نشان دادن اینکه آنها پرداختی انجام داده‌اند
    this.logger.log(`User has completed a checkout session`);

    // اینجا می‌توانید پردازش‌های اضافی برای جلسه‌های تکمیل‌شده اضافه کنید
  }

  private async handlePaymentSuccess(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = invoice.subscription as string;
    this.logger.log(
      `Processing successful payment for subscription: ${subscriptionId}`,
    );

    // دریافت مشتری از Stripe
    const customerId = invoice.customer as string;
    if (!customerId) {
      this.logger.error('No customer ID found in invoice');
      return;
    }

    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      if ((customer as any).deleted) {
        this.logger.error('Customer was deleted');
        return;
      }

      // یافتن پرداخت و به‌روزرسانی وضعیت
      const payment = await this.paymentRepository.findOne({
        where: { stripeSubscriptionId: subscriptionId },
        relations: ['user'],
      });

      if (!payment) {
        this.logger.error(
          `Payment with subscriptionId ${subscriptionId} not found`,
        );
        return;
      }

      // بررسی اینکه آیا کاربر وجود دارد
      let user = payment.user;

      // اگر هیچ کاربری نیست، سعی کنید با stripeCustomerId پیدا کنید
      if (!user) {
        user = await this.userRepository.findOne({
          where: { stripeCustomerId: customerId },
        });
      }

      // اگر هنوز هیچ کاربری نیست و مشتری ایمیل دارد، کاربر جدیدی ایجاد کنید
      if (!user && (customer as Stripe.Customer).email) {
        this.logger.log(`Creating new user from successful payment`);
        try {
          const customerObj = customer as Stripe.Customer;
          // ایجاد کاربر با حداقل فیلدهای مورد نیاز
          user = this.userRepository.create({
            email: customerObj.email,
            fullname: customerObj.name || 'New Customer',
            stripeCustomerId: customerId,
            // سایر فیلدهای مورد نیاز را طبق مدل کاربر خود اضافه کنید
          });

          await this.userRepository.save(user);
          this.logger.log(`Created new user with ID: ${user.id}`);
        } catch (error) {
          this.logger.error(
            `Failed to create user from payment: ${error.message}`,
          );
          // بدون پرتاب ادامه دهید تا حداقل وضعیت پرداخت به‌روز شود
        }
      }

      // دریافت جزئیات اشتراک جدید برای به‌روزرسانی تاریخ پایان
      const subscription =
        await this.stripe.subscriptions.retrieve(subscriptionId);
      const subscriptionEndDate = new Date(
        subscription.current_period_end * 1000,
      );

      // به‌روزرسانی وضعیت پرداخت و ارتباط با کاربر در صورت وجود
      try {
        const updateData: any = {
          status: PaymentStatus.ACTIVE,
          subscriptionEndDate: subscriptionEndDate,
          reminderSent: false,
          expiredReminderCount: 0,
        };

        if (user) {
          updateData.user = user;
        }

        await this.paymentRepository.update(
          { stripeSubscriptionId: subscriptionId },
          updateData,
        );

        this.logger.log(
          `Updated payment status to ACTIVE for subscription: ${subscriptionId}`,
        );

        // همچنین به‌روزرسانی برنامه فعال کاربر و تاریخ پایان اشتراک
        if (user) {
          await this.userRepository.update(user.id, {
            activePlan: payment.plan,
            currentSubscriptionEndDate: subscriptionEndDate,
          });
          this.logger.log(
            `Updated user with active plan and subscription end date`,
          );
        }
      } catch (error) {
        this.logger.error(`Failed to update payment status: ${error.message}`);
      }
    } catch (error) {
      this.logger.error(`Error handling payment success: ${error.message}`);
    }
  }

  private async handleSubscriptionCancellation(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    this.logger.log(`Processing subscription cancellation: ${subscription.id}`);

    try {
      const payment = await this.paymentRepository.findOne({
        where: { stripeSubscriptionId: subscription.id },
        relations: ['user'],
      });

      if (!payment) {
        this.logger.warn(
          `Payment with subscriptionId ${subscription.id} not found`,
        );
        return;
      }

      await this.paymentRepository.update(
        { stripeSubscriptionId: subscription.id },
        { status: PaymentStatus.CANCELED },
      );

      this.logger.log(
        `Updated payment status to CANCELED for subscription: ${subscription.id}`,
      );

      // اگر کاربری وجود دارد، وضعیت اشتراک آنها را نیز به‌روز کنید
      if (payment.user) {
        await this.userRepository.update(payment.user.id, {
          activePlan: null,
          currentSubscriptionEndDate: null,
        });
        this.logger.log(`Updated user to remove active plan`);
      }
    } catch (error) {
      this.logger.error(
        `Error handling subscription cancellation: ${error.message}`,
      );
    }
  }

  /**
   * اجرای روزانه در نیمه‌شب برای بررسی اشتراک‌هایی که نزدیک به انقضا هستند یا منقضی شده‌اند
   */
  @Cron('0 9 * * *')
  async handleSubscriptionReminders() {
    this.logger.log('Starting daily subscription reminder check');

    try {
      await this.sendPreExpirationReminders();
      await this.sendExpiredSubscriptionReminders();
      this.logger.log('Completed daily subscription reminder check');
    } catch (error) {
      this.logger.error(`Error in subscription reminders: ${error.message}`);
    }
  }

  /**
   * ارسال یادآوری‌ها به کاربرانی که اشتراک‌شان در 2 روز آینده منقضی می‌شود
   */
  private async sendPreExpirationReminders() {
    const twoDaysFromNow = new Date();
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);

    // ابتدا و انتهای روز هدف
    const startOfDay = new Date(twoDaysFromNow.setHours(0, 0, 0, 0));
    const endOfDay = new Date(twoDaysFromNow.setHours(23, 59, 59, 999));

    this.logger.log(
      `Checking for subscriptions expiring between ${format(startOfDay, 'yyyy-MM-dd HH:mm:ss')} and ${format(endOfDay, 'yyyy-MM-dd HH:mm:ss')}`,
    );

    try {
      // یافتن اشتراک‌های فعالی که در 2 روز آینده منقضی می‌شوند
      const expiringPayments = await this.paymentRepository.find({
        where: {
          status: PaymentStatus.ACTIVE,
          reminderSent: false,
        },
        relations: ['user'],
      });

      // فیلتر کردن پرداخت‌ها با subscriptionEndDate در محدوده هدف
      const remindPayments = expiringPayments.filter((payment) => {
        const endDate = payment.subscriptionEndDate;
        if (!endDate) return false;

        return endDate >= startOfDay && endDate <= endOfDay;
      });

      this.logger.log(
        `Found ${remindPayments.length} subscriptions expiring in 2 days`,
      );

      // ارسال یادآوری برای هر اشتراک
      for (const payment of remindPayments) {
        if (payment.user && payment.user.id) {
          const { fullname } = payment.user;

          this.logger.log(
            `🔔 REMINDER: Hi ${fullname}, your ${payment.plan} subscription will expire in 2 days on ${format(payment.subscriptionEndDate, 'yyyy-MM-dd')}. Please renew to continue enjoying our services.`,
          );

          // در اینجا می‌توانید کد واقعی ارسال ایمیل یا پیامک را اضافه کنید

          // علامت‌گذاری به عنوان یادآوری ارسال شده
          await this.paymentRepository.update(payment.id, {
            reminderSent: true,
          });
          this.logger.log(
            `Marked pre-expiration reminder as sent for payment ${payment.id}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error sending pre-expiration reminders: ${error.message}`,
      );
      // ثبت خطا بدون شکست فرآیند
    }
  }

  /**
   * ارسال یادآوری‌ها به کاربرانی که اشتراک‌شان قبلاً منقضی شده است
   */
  private async sendExpiredSubscriptionReminders() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    this.logger.log(
      `Checking for expired subscriptions as of ${format(today, 'yyyy-MM-dd')}`,
    );

    try {
      // یافتن اشتراک‌های فعالی که منقضی شده‌اند
      const expiredPayments = await this.paymentRepository.find({
        where: {
          status: PaymentStatus.ACTIVE,
          expiredReminderCount: LessThan(7), // کمتر از 7 یادآوری ارسال شده
        },
        relations: ['user'],
      });

      // فیلتر کردن پرداخت‌هایی که منقضی شده‌اند
      const remindPayments = expiredPayments.filter((payment) => {
        const endDate = payment.subscriptionEndDate;
        if (!endDate) return false;

        // بررسی کنید که آیا منقضی شده است (تاریخ پایان قبل از امروز است)
        return endDate < today;
      });

      this.logger.log(`Found ${remindPayments.length} expired subscriptions`);

      // ارسال یادآوری برای هر اشتراک منقضی شده
      for (const payment of remindPayments) {
        if (payment.user && payment.user.id) {
          const { fullname } = payment.user;

          // فقط در صورتی یادآوری ارسال کنید که هنوز به حد مجاز نرسیده باشیم (محدود به 7 یادآوری)
          if (payment.expiredReminderCount < 7) {
            this.logger.log(
              `🚨 EXPIRED: Hi ${fullname}, your ${payment.plan} subscription expired on ${format(payment.subscriptionEndDate, 'yyyy-MM-dd')}. Please renew now to continue enjoying our services without interruption.`,
            );

            // در اینجا می‌توانید کد واقعی ارسال ایمیل یا پیامک را اضافه کنید

            // افزایش تعداد یادآوری
            await this.paymentRepository.update(payment.id, {
              expiredReminderCount: payment.expiredReminderCount + 1,
            });
            this.logger.log(
              `Sent expired reminder #${payment.expiredReminderCount + 1} for payment ${payment.id}`,
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Error sending expired subscription reminders: ${error.message}`,
      );
      // ثبت خطا بدون شکست فرآیند
    }
  }

  /**
   * دریافت تاریخچه اشتراک کاربر
   */
  async getUserSubscriptionHistory(userId: number): Promise<Payment[]> {
    try {
      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      return await this.paymentRepository.find({
        where: { user: { id: userId } },
        order: { createdAt: 'DESC' },
      });
    } catch (error) {
      this.logger.error(
        `Error fetching subscription history for user ${userId}: ${error.message}`,
      );
      if (error instanceof BadRequestException) {
        throw error;
      }
      return [];
    }
  }

  /**
   * بررسی اینکه آیا اشتراک کاربر فعال است
   */
  async isSubscriptionActive(userId: number): Promise<boolean> {
    try {
      if (!userId) {
        return false;
      }

      const activeSubscription = await this.paymentRepository.findOne({
        where: {
          user: { id: userId },
          status: PaymentStatus.ACTIVE,
        },
      });

      if (activeSubscription && activeSubscription.subscriptionEndDate) {
        // بررسی کنید که آیا تاریخ پایان اشتراک هنوز در آینده است
        const now = new Date();
        return activeSubscription.subscriptionEndDate > now;
      }

      return false;
    } catch (error) {
      this.logger.error(
        `Error checking active subscription for user ${userId}: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * دریافت جزئیات اشتراک فعال کاربر
   */
  async getActiveSubscription(userId: number): Promise<Payment | null> {
    try {
      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      const subscription = await this.paymentRepository.findOne({
        where: {
          user: { id: userId },
          status: PaymentStatus.ACTIVE,
        },
        relations: ['user'],
      });

      if (subscription && subscription.subscriptionEndDate) {
        // بررسی کنید که آیا تاریخ پایان اشتراک هنوز در آینده است
        const now = new Date();
        if (subscription.subscriptionEndDate <= now) {
          // اشتراک منقضی شده است، باید وضعیت را به‌روز کنیم
          await this.paymentRepository.update(subscription.id, {
            status: PaymentStatus.CANCELED,
          });
          return null;
        }
      }

      return subscription;
    } catch (error) {
      this.logger.error(
        `Error fetching active subscription for user ${userId}: ${error.message}`,
      );
      if (error instanceof BadRequestException) {
        throw error;
      }
      return null;
    }
  }

  /**
   * ارسال یادآوری آزمایشی برای اهداف اشکال‌زدایی
   */
  async sendTestReminder(userId: number): Promise<void> {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const subscription = await this.getActiveSubscription(userId);

    if (!subscription) {
      throw new NotFoundException(
        `No active subscription found for user ${userId}`,
      );
    }

    this.logger.log(
      `🔔 TEST REMINDER: Hi ${user.fullname}, this is a test reminder that your ${subscription.plan} subscription will expire on ${format(subscription.subscriptionEndDate, 'yyyy-MM-dd')}. Please renew to continue enjoying our services.`,
    );

    // در اینجا می‌توانید کد واقعی ارسال ایمیل یا پیامک را اضافه کنید
  }
}
