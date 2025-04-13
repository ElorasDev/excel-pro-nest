import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { addDays, isBefore, isAfter, format } from 'date-fns';
import Stripe from 'stripe';
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

  // Configuration for the first-time fee
  private readonly firstTimeSubscriptionFee = 70; // $70 first-time subscription fee
  private readonly firstTimeFeeProductId = 'prod_first_time_fee';

  constructor(
    @InjectRepository(Payment)
    private paymentRepository: Repository<Payment>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private configService: ConfigService,
  ) {
    const secretKey = configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) throw new Error('Stripe secret key not configured.');
    this.stripe = new Stripe(secretKey, { apiVersion: '2025-02-24.acacia' }); // Using a valid API version
  }

  async createSubscription(
    dto: CreateSubscriptionDto,
  ): Promise<SubscriptionResponseDto> {
    const { priceId, userId, paymentMethodId, email } = dto;

    this.logger.log(
      `Creating subscription with priceId: ${priceId}, userId: ${userId || 'Not provided'}, paymentMethodId: ${paymentMethodId || 'Not provided'}`,
    );

    // Validation
    if (!priceId) {
      this.logger.error('PriceId is missing');
      throw new BadRequestException('PriceId is required');
    }

    try {
      // Variables needed
      let user = null;
      let customerId = null;
      let isFirstTimeSubscription = false;

      // Determine final Stripe price ID
      let stripePriceId = priceId;

      // If priceId is one of the mapping keys, convert it to Stripe ID
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

      // If userId is provided, try to find the user
      if (userId) {
        this.logger.log(`Attempting to find user with ID: ${userId}`);
        user = await this.userRepository.findOne({
          where: { email },
        });

        console.log(`User found: ${user}`);
        

        if (user) {
          this.logger.log(`User found: ${user.id}`);

          // Check if the user has any previous ACTIVE or CANCELED payments in the database
          // This indicates they had a subscription in the past
          const previousPayments = await this.paymentRepository.count({
            where: [
              { user: { id: user.id }, status: PaymentStatus.ACTIVE },
              { user: { id: user.id }, status: PaymentStatus.CANCELED },
            ],
          });

          // If no previous ACTIVE or CANCELED payments, this is their first time subscribing
          isFirstTimeSubscription = previousPayments === 0;
          this.logger.log(
            `Is first time subscription for user: ${isFirstTimeSubscription} (found ${previousPayments} previous payments)`,
          );

          // If user exists, use their Stripe customer or create a new one
          const customer = await this.getOrCreateStripeCustomer(user);
          customerId = customer.id;
        } else {
          this.logger.log(
            `User with ID ${userId} not found - will proceed without user`,
          );
          isFirstTimeSubscription = true; // Assume new users are first-time subscribers
        }
      } else {
        // No user ID provided, assume it's a first-time subscription
        isFirstTimeSubscription = true;
      }

      // If no user is found or no userId provided, create a temporary Stripe customer
      if (!customerId) {
        this.logger.log(
          'Creating temporary Stripe customer without linked user',
        );
        const tempCustomer = await this.stripe.customers.create({
          metadata: { isTemporary: 'true' },
        });
        customerId = tempCustomer.id;
        this.logger.log(
          `Created temporary Stripe customer with ID: ${customerId}`,
        );
      }

      // Handle payment method
      let finalPaymentMethodId = paymentMethodId;
      if (!finalPaymentMethodId) {
        this.logger.log(
          'No payment method provided, creating test payment method',
        );
        const testPaymentMethod = await this.createTestPaymentMethod();
        finalPaymentMethodId = testPaymentMethod.id;
        this.logger.log(
          `Created test payment method with ID: ${finalPaymentMethodId}`,
        );
      }

      // Create subscription with proper error handling
      try {
        // IMPORTANT: Attach payment method to customer before creating subscription
        if (finalPaymentMethodId) {
          try {
            this.logger.log(
              `Attaching payment method ${finalPaymentMethodId} to customer ${customerId}`,
            );
            await this.stripe.paymentMethods.attach(finalPaymentMethodId, {
              customer: customerId,
            });

            this.logger.log(
              `Setting ${finalPaymentMethodId} as default payment method for customer ${customerId}`,
            );
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

        // Create subscription params
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

        // Add setup fee for first-time subscribers
        if (isFirstTimeSubscription) {
          try {
            // First get the subscription price to determine the currency
            const subscriptionPrice =
              await this.stripe.prices.retrieve(stripePriceId);
            const currency = subscriptionPrice.currency || 'cad'; // Default to CAD if not specified

            this.logger.log(
              `Adding setup fee of ${this.firstTimeSubscriptionFee} ${currency.toUpperCase()} for first-time subscriber`,
            );

            // Get or create the price ID for the first-time fee in the same currency
            const priceId = await this.getOrCreateFirstTimeFeeProduct(currency);

            // Add the fee as a line item to the first invoice
            subscriptionParams.add_invoice_items = [
              {
                price: priceId,
                quantity: 1,
              },
            ];
            this.logger.log(
              `Added one-time registration fee using price: ${priceId} with currency: ${currency.toUpperCase()}`,
            );
          } catch (feeError) {
            this.logger.error(
              `Failed to add first-time fee: ${feeError.message}`,
            );
            // Continue without the fee rather than failing the entire subscription
          }
        }

        this.logger.log(
          `Creating Stripe subscription for customer ${customerId}`,
        );
        const subscription =
          await this.stripe.subscriptions.create(subscriptionParams);

        this.logger.log(`Subscription created with ID: ${subscription.id}`);

        // Get payment intent
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

        // Calculate total amount (subscription + one-time fee if applicable)
        let amount = (subscription.items.data[0].price.unit_amount || 0) / 100;
        if (isFirstTimeSubscription) {
          amount += this.firstTimeSubscriptionFee;
        }

        // Calculate subscription end date
        const subscriptionEndDate = new Date(
          subscription.current_period_end * 1000,
        );
        this.logger.log(
          `Subscription will end on: ${subscriptionEndDate.toISOString()}`,
        );

        // Save payment record - with detailed logging
        this.logger.log(
          `Saving payment record with amount: ${amount}, isFirstTimePayment: ${isFirstTimeSubscription}, endDate: ${subscriptionEndDate.toISOString()}`,
        );
        const payment = this.paymentRepository.create({
          amount: amount,
          currency: subscription.items.data[0].price.currency,
          status: PaymentStatus.PENDING,
          plan: this.determinePlanFromPrice(stripePriceId),
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: customerId,
          user: await this.userRepository.findOneBy({ id: user.id }),
          isFirstTimePayment: isFirstTimeSubscription,
          subscriptionEndDate: subscriptionEndDate,
          reminderSent: false,
          expiredReminderCount: 0,
        });

        const savedPayment = await this.paymentRepository.save(payment);
        this.logger.log(
          `Payment record saved successfully with ID: ${savedPayment.id}`,
        );

        // If we have a user, update their subscription information
        if (user) {
          await this.userRepository.update(user.id, {
            activePlan: this.determinePlanFromPrice(stripePriceId).toString(),
            currentSubscriptionEndDate: subscriptionEndDate,
          });
          this.logger.log(
            `Updated user ${user.id} with active plan and subscription end date`,
          );
        }

        return {
          clientSecret: paymentIntent.client_secret,
          subscriptionId: subscription.id,
          currentPeriodEnd: subscriptionEndDate,
          userId: user?.id,
          stripeCustomerId: customerId,
          totalAmount: amount,
          currency: subscription.items.data[0].price.currency,
          isFirstTimeSubscription: isFirstTimeSubscription,
        };
      } catch (stripeError) {
        this.logger.error(
          `Stripe subscription creation failed: ${stripeError.message}`,
          stripeError.stack,
        );

        // Return a more specific error based on Stripe's error type
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

      // Re-throw specific NestJS exceptions
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
   * Gets or creates the first-time fee product with a one-time price in the specified currency
   */
  private async getOrCreateFirstTimeFeeProduct(
    currency: string = 'cad',
  ): Promise<string> {
    try {
      let product: Stripe.Product | null = null;
      let priceId: string | null = null;

      // First check if the product already exists
      try {
        product = await this.stripe.products.retrieve(
          this.firstTimeFeeProductId,
        );
        this.logger.log(
          `Retrieved existing one-time fee product: ${product.id}`,
        );
      } catch (error) {
        // Product doesn't exist, create it
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

      // Now check if we have an existing price for this product with the right currency
      const prices = await this.stripe.prices.list({
        product: product.id,
        active: true,
      });

      // Look for a price with matching currency
      const matchingPrices = prices.data.filter(
        (price) => price.currency === currency.toLowerCase(),
      );

      if (matchingPrices.length > 0) {
        // Use existing price with the right currency
        priceId = matchingPrices[0].id;
        this.logger.log(
          `Using existing price: ${priceId} with currency ${currency} for product: ${product.id}`,
        );
      } else {
        // Create a new price for the product with the specified currency
        this.logger.log(
          `No active price found for product ${product.id} with currency ${currency}, creating new price...`,
        );
        const newPrice = await this.stripe.prices.create({
          product: product.id,
          unit_amount: this.firstTimeSubscriptionFee * 100, // Convert to cents
          currency: currency.toLowerCase(),
        });
        priceId = newPrice.id;
        this.logger.log(
          `Created new one-time fee price with ID: ${priceId} and currency ${currency}`,
        );
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
    // First check our internal mapping (backwards)
    for (const [planKey, price] of Object.entries(this.priceMapping)) {
      if (price === stripePriceId) {
        return this.mapPriceIdToPlan(price);
      }
    }

    // If it's not in our mapping, use a default or derive from the price ID
    if (stripePriceId.includes('basic')) {
      return SubscriptionPlan.FREE;
    } else if (stripePriceId.includes('pro')) {
      return SubscriptionPlan.PRO;
    } else if (stripePriceId.includes('premium')) {
      return SubscriptionPlan.PREMIUM;
    }

    // Default fallback
    return SubscriptionPlan.FREE;
  }

  private async createTestPaymentMethod(): Promise<Stripe.PaymentMethod> {
    try {
      return await this.stripe.paymentMethods.create({
        type: 'card',
        card: {
          number: '4242424242424242',
          exp_month: 12,
          exp_year: 2026,
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
        this.logger.log(
          `Retrieving existing Stripe customer: ${user.stripeCustomerId}`,
        );
        return (await this.stripe.customers.retrieve(
          user.stripeCustomerId,
        )) as Stripe.Customer;
      }

      this.logger.log(`Creating new Stripe customer for user: ${user.id}`);
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

  private mapPriceIdToPlan(priceId: string): SubscriptionPlan {
    const planMap: Record<string, SubscriptionPlan> = {
      price_basic_monthly: SubscriptionPlan.FREE,
      price_pro_monthly: SubscriptionPlan.PRO,
      price_premium_yearly: SubscriptionPlan.PREMIUM,
    };
    return planMap[priceId] || SubscriptionPlan.FREE;
  }

  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    const webhookSecret = this.configService.get('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) throw new Error('Webhook secret is not configured');

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
        // Handle checkout session completed event - can be used for one-time payments
        await this.handleCheckoutSessionCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
    }
  }

  private async handleCheckoutSessionCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    this.logger.log(`Processing checkout session completed: ${session.id}`);

    // Get customer ID from the session
    const customerId = session.customer as string;
    if (!customerId) {
      this.logger.error('No customer ID found in checkout session');
      return;
    }

    // Find user by customer ID
    const user = await this.userRepository.findOne({
      where: { stripeCustomerId: customerId },
    });

    if (!user) {
      this.logger.error(`User not found for customer ID: ${customerId}`);
      return;
    }

    // Update user record to indicate they've made a payment
    // This could be used to track that they've paid the first-time fee
    // if you need to implement this separately from subscriptions
    this.logger.log(`User ${user.id} has completed a checkout session`);
  }

  private async handlePaymentSuccess(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = invoice.subscription as string;
    this.logger.log(
      `Processing successful payment for subscription: ${subscriptionId}`,
    );

    // Get customer from Stripe
    const customerId = invoice.customer as string;
    const customer = (await this.stripe.customers.retrieve(
      customerId,
    )) as Stripe.Customer;

    // Find payment and update status
    const payment = await this.paymentRepository.findOne({
      where: { stripeSubscriptionId: subscriptionId },
      relations: ['user'], // Make sure to load the user relation
    });

    if (!payment) {
      this.logger.error(
        `Payment with subscriptionId ${subscriptionId} not found`,
      );
      throw new NotFoundException(
        `Payment with subscriptionId ${subscriptionId} not found`,
      );
    }

    // Check if user exists
    let user = payment.user;

    // If no user, try to find one by stripeCustomerId
    if (!user) {
      user = await this.userRepository.findOne({
        where: { stripeCustomerId: customerId },
      });
    }

    // If still no user and customer has an email, create a new user
    if (!user && customer.email) {
      this.logger.log(
        `Creating new user from successful payment with email: ${customer.email}`,
      );
      try {
        // Note: You need to fill in all required fields of your User model here
        user = this.userRepository.create({
          email: customer.email,
          fullname: customer.name || 'New Customer',
          stripeCustomerId: customerId,
          age: 25, // Default value for required age field
          // Add other required fields with default values
        });

        await this.userRepository.save(user);
        this.logger.log(`Created new user with ID: ${user.id}`);
      } catch (error) {
        this.logger.error(
          `Failed to create user from payment: ${error.message}`,
        );
        // Continue without throwing to at least update payment status
      }
    }

    // Get latest subscription details to update end date
    const subscription =
      await this.stripe.subscriptions.retrieve(subscriptionId);
    const subscriptionEndDate = new Date(
      subscription.current_period_end * 1000,
    );

    // Update payment status and associate with user if exists
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

      // Also update user's active plan and subscription end date
      if (user) {
        await this.userRepository.update(user.id, {
          activePlan: payment.plan.toString(),
          currentSubscriptionEndDate: subscriptionEndDate,
        });
        this.logger.log(
          `Updated user ${user.id} with active plan and subscription end date: ${subscriptionEndDate.toISOString()}`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to update payment status: ${error.message}`);
    }
  }

  private async handleSubscriptionCancellation(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    this.logger.log(`Processing subscription cancellation: ${subscription.id}`);

    const payment = await this.paymentRepository.findOne({
      where: { stripeSubscriptionId: subscription.id },
      relations: ['user'],
    });

    if (!payment) {
      this.logger.error(
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

    // If there's a user, update their subscription status too
    if (payment.user) {
      await this.userRepository.update(payment.user.id, {
        activePlan: null,
        currentSubscriptionEndDate: null,
      });
      this.logger.log(`Updated user ${payment.user.id} to remove active plan`);
    }
  }

  /**
   * Run daily at midnight to check for subscriptions that are close to expiring or have expired
   */
  @Cron('0 0 * * *')
  async handleSubscriptionReminders() {
    this.logger.log('Starting daily subscription reminder check');

    await this.sendPreExpirationReminders();
    await this.sendExpiredSubscriptionReminders();

    this.logger.log('Completed daily subscription reminder check');
  }

  /**
   * Send reminders to users whose subscriptions are about to expire in 2 days
   */
  private async sendPreExpirationReminders() {
    const twoDaysFromNow = new Date();
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);

    // Beginning and end of the target day
    const startOfDay = new Date(twoDaysFromNow.setHours(0, 0, 0, 0));
    const endOfDay = new Date(twoDaysFromNow.setHours(23, 59, 59, 999));

    this.logger.log(
      `Checking for subscriptions expiring between ${format(startOfDay, 'yyyy-MM-dd HH:mm:ss')} and ${format(endOfDay, 'yyyy-MM-dd HH:mm:ss')}`,
    );

    try {
      // Find active subscriptions that expire in 2 days
      const expiringPayments = await this.paymentRepository.find({
        where: {
          status: PaymentStatus.ACTIVE,
          reminderSent: false,
        },
        relations: ['user'],
      });

      // Filter for payments with subscriptionEndDate in the target range
      const remindPayments = expiringPayments.filter((payment) => {
        const endDate = payment.subscriptionEndDate;
        if (!endDate) return false;

        return endDate >= startOfDay && endDate <= endOfDay;
      });

      this.logger.log(
        `Found ${remindPayments.length} subscriptions expiring in 2 days`,
      );

      // Send reminders for each subscription
      for (const payment of remindPayments) {
        if (payment.user) {
          const { email, fullname, phone_number } = payment.user;

          this.logger.log(
            `🔔 REMINDER: Hi ${fullname}, your ${payment.plan} subscription will expire in 2 days on ${format(payment.subscriptionEndDate, 'yyyy-MM-dd')}. Please renew to continue enjoying our services.`,
          );

          // Mark as reminder sent
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
        error.stack,
      );
    }
  }

  /**
   * Send reminders to users whose subscriptions have already expired
   */
  private async sendExpiredSubscriptionReminders() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    this.logger.log(
      `Checking for expired subscriptions as of ${format(today, 'yyyy-MM-dd')}`,
    );

    try {
      // Find active subscriptions that have expired
      const expiredPayments = await this.paymentRepository.find({
        where: {
          status: PaymentStatus.ACTIVE,
        },
        relations: ['user'],
      });

      // Filter for payments that have expired
      const remindPayments = expiredPayments.filter((payment) => {
        const endDate = payment.subscriptionEndDate;
        if (!endDate) return false;

        // Check if it's expired (end date is before today)
        return endDate < today;
      });

      this.logger.log(`Found ${remindPayments.length} expired subscriptions`);

      // Send reminders for each expired subscription
      for (const payment of remindPayments) {
        if (payment.user) {
          const { email, fullname, phone_number } = payment.user;

          // Only send a reminder if we haven't sent too many already (limit to 7 reminders)
          if (payment.expiredReminderCount < 7) {
            this.logger.log(
              `🚨 EXPIRED: Hi ${fullname}, your ${payment.plan} subscription expired on ${format(payment.subscriptionEndDate, 'yyyy-MM-dd')}. Please renew now to continue enjoying our services without interruption.`,
            );

            // Increment the reminder count
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
        error.stack,
      );
    }
  }

  /**
   * Get a user's subscription history
   */
  async getUserSubscriptionHistory(userId: number): Promise<Payment[]> {
    try {
      return await this.paymentRepository.find({
        where: { user: { id: userId } },
        order: { createdAt: 'DESC' },
      });
    } catch (error) {
      this.logger.error(
        `Error fetching subscription history for user ${userId}: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Check if a user's subscription is active
   */
  async isSubscriptionActive(userId: number): Promise<boolean> {
    try {
      const activeSubscription = await this.paymentRepository.findOne({
        where: {
          user: { id: userId },
          status: PaymentStatus.ACTIVE,
        },
      });

      return !!activeSubscription;
    } catch (error) {
      this.logger.error(
        `Error checking active subscription for user ${userId}: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Get details about a user's active subscription
   */
  async getActiveSubscription(userId: number): Promise<Payment | null> {
    try {
      return await this.paymentRepository.findOne({
        where: {
          user: { id: userId },
          status: PaymentStatus.ACTIVE,
        },
        relations: ['user'],
      });
    } catch (error) {
      this.logger.error(
        `Error fetching active subscription for user ${userId}: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Send a test reminder for debugging purposes
   */
  async sendTestReminder(userId: number): Promise<void> {
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
  }
}