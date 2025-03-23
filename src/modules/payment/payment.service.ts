import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import { User } from '../users/entities/user.entity';
import { Payment } from './entities/payment.entity';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { ConfigService } from '@nestjs/config';
import { CreateSubscriptionDto } from './dto/CreateSubscription.dto';
import { PaymentStatus } from './entities/enums/payment-status.enum';
import { SubscriptionPlan } from '../users/entities/enums/enums';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

@Injectable()
export class PaymentsService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(PaymentsService.name);
  private readonly priceMapping: Record<string, string> = {
    basic: 'price_1234567890abcdef',
    pro: 'price_abcdef1234567890',
    premium: 'price_9876543210fedcba',
  };
  constructor(
    @InjectRepository(Payment)
    private paymentRepository: Repository<Payment>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private configService: ConfigService,
  ) {
    this.stripe = new Stripe(configService.get('STRIPE_SECRET_KEY'), {
      apiVersion: '2025-02-24.acacia',
    });
  }

  async createSubscription(
    createSubscriptionDto: CreateSubscriptionDto,
  ): Promise<SubscriptionResponseDto> {
    const { priceId, userId, paymentMethodId } = createSubscriptionDto;

    const validPlans = Object.keys(this.priceMapping);
    if (!validPlans.includes(priceId)) {
      throw new BadRequestException(`Invalid priceId: ${priceId}`);
    }

    console.log(
      'Stripe Secret Key:',
      this.configService.get('STRIPE_SECRET_KEY'),
    );

    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException(`User with ID ${userId} not found`);
      }

      const customer = await this.getOrCreateStripeCustomer(user);

      let finalPaymentMethodId = paymentMethodId;
      if (!finalPaymentMethodId) {
        const paymentMethod = await this.createPaymentMethod();
        finalPaymentMethodId = paymentMethod.id;
        console.log(finalPaymentMethodId);
      }

      const subscription = await this.stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId }],
        default_payment_method: finalPaymentMethodId,
        payment_settings: {
          payment_method_types: ['card'],
          save_default_payment_method: 'on_subscription',
        },
        expand: ['latest_invoice.payment_intent'],
      });

      const latestInvoice = subscription.latest_invoice as Stripe.Invoice;
      const paymentIntent =
        latestInvoice.payment_intent as Stripe.PaymentIntent;

      if (!paymentIntent?.client_secret) {
        throw new Error('Failed to get client secret');
      }

      const payment = this.paymentRepository.create({
        amount: (subscription.items.data[0].price.unit_amount || 0) / 100,
        currency: subscription.items.data[0].price.currency,
        status: PaymentStatus.ACTIVE,
        plan: this.mapPriceIdToPlan(priceId),
        stripeSubscriptionId: subscription.id,
        user,
      });

      await this.paymentRepository.save(payment);

      return {
        clientSecret: paymentIntent.client_secret,
        subscriptionId: subscription.id,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      };
    } catch (error) {
      this.logger.error(`Subscription failed: ${error.message}`, error.stack);
      console.error('Stripe Error:', error);
      throw new InternalServerErrorException('Subscription creation failed');
    }
  }

  // create payment methode for development and test (for production you should use Stripe Elements)
  private async createPaymentMethod(): Promise<Stripe.PaymentMethod> {
    try {
      const paymentMethod = await this.stripe.paymentMethods.create({
        type: 'card',
        card: {
          number: '4242424242424242', // test stripe card number
          exp_month: 12,
          exp_year: 2026,
          cvc: '123',
        },
      });
      console.log('PaymentMethod created:', paymentMethod.id);
      return paymentMethod;
    } catch (error) {
      console.error('Error creating PaymentMethod:', error.message);
      throw new InternalServerErrorException('Failed to create PaymentMethod');
    }
  }

  private async getOrCreateStripeCustomer(
    user: User,
  ): Promise<Stripe.Customer> {
    if (user.stripeCustomerId) {
      return this.stripe.customers.retrieve(
        user.stripeCustomerId,
      ) as Promise<Stripe.Customer>;
    }

    const customer = await this.stripe.customers
      .create(
        {
          email: user.email,
          name: user.fullname,
        },
        {
          apiKey: this.configService.get('STRIPE_SECRET_KEY'),
          apiVersion: '2025-02-24.acacia',
        },
      )
      .catch((error) => {
        console.error('Stripe error:', error);
        throw error;
      });

    await this.userRepository.update(user.id, {
      stripeCustomerId: customer.id,
    });

    return customer;
  }

  private mapPriceIdToPlan(priceId: string): SubscriptionPlan {
    const priceMapping: Record<string, SubscriptionPlan> = {
      price_basic_monthly: SubscriptionPlan.BASIC,
      price_premium_yearly: SubscriptionPlan.PREMIUM,
    };

    return priceMapping[priceId] || SubscriptionPlan.FREE;
  }

  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    const event = this.stripe.webhooks.constructEvent(
      payload,
      signature,
      this.configService.get('STRIPE_WEBHOOK_SECRET'),
    );

    switch (event.type) {
      case 'invoice.payment_succeeded':
        await this.handlePaymentSuccess(event.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionCancellation(
          event.data.object as Stripe.Subscription,
        );
        break;
    }
  }

  private async handlePaymentSuccess(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = invoice.subscription as string;

    await this.paymentRepository.update(
      { stripeSubscriptionId: subscriptionId },
      {
        status: PaymentStatus.ACTIVE,
      },
    );
  }

  private async handleSubscriptionCancellation(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    await this.paymentRepository.update(
      { stripeSubscriptionId: subscription.id },
      {
        status: PaymentStatus.CANCELED,
      },
    );
  }
}
