import {
  Injectable,
  Logger,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateSubscriptionDto } from './dto/CreateSubscription.dto';
import { UpdatePaymentDto } from './dto/update-subscription.dto';
import { Payment, PaymentStatus } from './entities/payment.entity';

@Injectable()
export class PaymentService {
  private stripe: Stripe;
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly configService: ConfigService,
  ) {
    const stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      this.logger.error('STRIPE_SECRET_KEY is not defined in .env');
      throw new InternalServerErrorException('Stripe API key is missing');
    }
    this.stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2025-02-24.acacia',
    });
  }

  private async createStripeCustomer(email: string): Promise<Stripe.Customer> {
    try {
      const customer = await this.stripe.customers.create({
        email,
      });

      return customer;
    } catch (error) {
      this.logger.error(`Error creating Stripe customer: ${error.message}`);
      throw new InternalServerErrorException(
        'Failed to create Stripe customer',
      );
    }
  }

  async create(createPaymentDto: CreateSubscriptionDto) {
    const { email, priceId } = createPaymentDto;

    try {
      const customer = await this.createStripeCustomer(email);

      const payment = this.paymentRepository.create({
        customerId: customer.id,
        priceId: priceId,
        payment_status: PaymentStatus.Pending,
      });

      await this.paymentRepository.save(payment);

      const subscription = await this.stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent'],
      });

      let paymentAmount = 0;
      let transactionId = null;

      if (
        subscription.latest_invoice &&
        typeof subscription.latest_invoice !== 'string'
      ) {
        const invoice = subscription.latest_invoice;
        if (
          invoice.payment_intent &&
          typeof invoice.payment_intent !== 'string'
        ) {
          const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent;
          paymentAmount = paymentIntent.amount / 100;
          transactionId = paymentIntent.id;
        }
      }

      payment.amount = paymentAmount;
      payment.transaction_id = transactionId;
      payment.payment_status = PaymentStatus.Pending;

      await this.paymentRepository.save(payment);

      return { subscription, payment };
    } catch (error) {
      this.logger.error(`Error creating subscription: ${error.message}`);
      throw new InternalServerErrorException('Failed to create subscription');
    }
  }

  async findAll(): Promise<Payment[]> {
    return await this.paymentRepository.find();
  }

  async findOne(id: number): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({ where: { id } });
    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }
    return payment;
  }

  async update(
    id: number,
    updatePaymentDto: UpdatePaymentDto,
  ): Promise<Payment> {
    const result = await this.paymentRepository.update(id, updatePaymentDto);
    if (result.affected === 0) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }
    return this.paymentRepository.findOne({ where: { id } });
  }

  async remove(id: number): Promise<void> {
    const result = await this.paymentRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }
  }
}
