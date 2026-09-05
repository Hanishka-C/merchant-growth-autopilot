import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Merchant, Customer, Transaction, Campaign, StrategyMemory } from './models';
import { runWithTenant } from './utils/tenant';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/merchant_growth';
const MERCHANT_ID = 'mer_673e51240a1b';

async function seed() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.');

  // Clear existing collections
  await Merchant.deleteMany({});
  await Customer.deleteMany({});
  await Transaction.deleteMany({});
  await Campaign.deleteMany({});
  await StrategyMemory.deleteMany({});

  console.log('Cleared existing data.');

  // 1. Seed Merchant
  const merchant = await Merchant.create({
    merchantId: MERCHANT_ID,
    businessName: 'GrowShop India',
    email: 'owner@growshop.in',
    apiKeyId: 'rzp_test_5d1a89c20f4b',
    apiKeySecret: 'rzp_test_secret_abc123',
    webhookSecret: 'rzp_webhook_secret_xyz'
  });
  console.log('Seeded Merchant:', merchant.businessName);

  // Use runWithTenant to bypass manual tenant setting or let middleware handle it
  await runWithTenant(MERCHANT_ID, async () => {
    // 2. Seed Customer segments and Customer profiles
    const customerData = [
      { customerId: 'cust_101', email: 'arjun.sharma@gmail.com', phone: '+919876543210', segments: ['high_value_upi_users', 'returning_customers'], aov: 120000 },
      { customerId: 'cust_102', email: 'priya.patel@yahoo.com', phone: '+919988776655', segments: ['high_value_upi_users'], aov: 150000 },
      { customerId: 'cust_103', email: 'rahul.verma@gmail.com', phone: '+919812345678', segments: ['returning_customers'], aov: 80000 },
      { customerId: 'cust_104', email: 'sneha.reddy@gmail.com', phone: '+919700112233', segments: ['returning_customers'], aov: 90000 },
      { customerId: 'cust_105', email: 'amit.singh@outlook.com', phone: '+919655443322', segments: ['high_value_upi_users', 'returning_customers'], aov: 110000 }
    ];

    for (let i = 6; i <= 100; i++) {
      customerData.push({
        customerId: `cust_${i}`,
        email: `customer${i}@example.com`,
        phone: `+919600000${i.toString().padStart(3, '0')}`,
        segments: i % 2 === 0 ? ['high_value_upi_users'] : ['returning_customers'],
        aov: i % 2 === 0 ? 130000 : 75000
      });
    }

    await Customer.create(customerData);
    console.log(`Seeded ${customerData.length} customers.`);

    // 3. Seed Transactions
    const transactions = [];
    const now = new Date();

    // Generate normal baseline transactions (30 days ago to 3 days ago)
    for (let i = 0; i < 400; i++) {
      const timestamp = new Date(now.getTime() - (3 + Math.random() * 27) * 24 * 60 * 60 * 1000);
      const isUpi = Math.random() < 0.6; // 60% UPI, 30% card, 10% netbanking
      const method = isUpi ? 'upi' : (Math.random() < 0.75 ? 'card' : 'netbanking');
      const bank = method === 'upi' || method === 'netbanking' ? (Math.random() < 0.5 ? 'HDFC' : 'SBI') : null;
      
      // High baseline success rate (90%)
      const status = Math.random() < 0.9 ? 'captured' : 'failed';
      const errorCode = status === 'failed' ? 'BAD_REQUEST_PAYMENT_DECLINED' : null;
      const errorDescription = status === 'failed' ? 'Payment declined by bank' : null;

      transactions.push({
        transactionId: `tx_normal_${i}`,
        merchantId: MERCHANT_ID,
        customerId: `cust_${Math.floor(Math.random() * 100) + 1}`,
        amount: method === 'upi' ? 120000 : 85000,
        currency: 'INR',
        method,
        bank,
        status,
        errorCode,
        errorDescription,
        timestamp
      });
    }

    // Generate UPI Anomaly Transactions (last 48 hours)
    // HDFC UPI gate success rate drops to 30% due to gateway timeouts
    for (let i = 0; i < 150; i++) {
      const timestamp = new Date(now.getTime() - Math.random() * 48 * 60 * 60 * 1000);
      const method = 'upi';
      const bank = 'HDFC';
      
      const isFailed = Math.random() < 0.7; // 70% failure rate
      const status = isFailed ? 'failed' : 'captured';
      const errorCode = isFailed ? 'BAD_REQUEST_PAYMENT_TIMED_OUT' : null;
      const errorDescription = isFailed ? 'HDFC bank gateway timeout' : null;

      transactions.push({
        transactionId: `tx_anomaly_hdfc_${i}`,
        merchantId: MERCHANT_ID,
        customerId: `cust_${Math.floor(Math.random() * 100) + 1}`,
        amount: 140000, // UPI high order values
        currency: 'INR',
        method,
        bank,
        status,
        errorCode,
        errorDescription,
        timestamp
      });
    }

    // SBI UPI also has minor issues (50% failure rate)
    for (let i = 0; i < 100; i++) {
      const timestamp = new Date(now.getTime() - Math.random() * 48 * 60 * 60 * 1000);
      const method = 'upi';
      const bank = 'SBI';
      
      const isFailed = Math.random() < 0.5; // 50% failure rate
      const status = isFailed ? 'failed' : 'captured';
      const errorCode = isFailed ? 'BAD_REQUEST_PAYMENT_TIMED_OUT' : null;
      const errorDescription = isFailed ? 'SBI bank gateway timeout' : null;

      transactions.push({
        transactionId: `tx_anomaly_sbi_${i}`,
        merchantId: MERCHANT_ID,
        customerId: `cust_${Math.floor(Math.random() * 100) + 1}`,
        amount: 110000,
        currency: 'INR',
        method,
        bank,
        status,
        errorCode,
        errorDescription,
        timestamp
      });
    }

    // Normal non-UPI transactions during anomaly period
    for (let i = 0; i < 50; i++) {
      const timestamp = new Date(now.getTime() - Math.random() * 48 * 60 * 60 * 1000);
      const method = 'card';
      const status = Math.random() < 0.92 ? 'captured' : 'failed'; // stable cards success rate

      transactions.push({
        transactionId: `tx_anomaly_card_${i}`,
        merchantId: MERCHANT_ID,
        customerId: `cust_${Math.floor(Math.random() * 100) + 1}`,
        amount: 95000,
        currency: 'INR',
        method,
        bank: null,
        status,
        errorCode: status === 'failed' ? 'BAD_REQUEST_INSUFFICIENT_FUNDS' : null,
        errorDescription: status === 'failed' ? 'Insufficient funds' : null,
        timestamp
      });
    }

    await Transaction.create(transactions);
    console.log(`Seeded ${transactions.length} transactions.`);

    // 4. Seed Historical Campaign & Strategy Memory
    const historicalCampaign = await Campaign.create({
      campaignId: 'camp_old_01',
      merchantId: MERCHANT_ID,
      name: 'UPI Fallback Promo July',
      status: 'completed',
      type: 'payment_method_fallback',
      razorpayOfferId: 'ofr_old_fallback_99',
      parameters: {
        discountPercentage: 5,
        maxDiscountAmount: 10000,
        minOrderAmount: 100000,
        applicableMethods: ['card', 'netbanking']
      },
      segmentKey: 'high_value_upi_users',
      budgetCap: 2500000, // 25k INR in Paise
      amountSpent: 2200000,
      startedAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
      endsAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    });

    // Seed Strategy Memory with weight modifiers to simulate a previous campaign execution
    await StrategyMemory.create({
      merchantId: MERCHANT_ID,
      strategyType: 'payment_method_fallback',
      segmentKey: 'high_value_upi_users',
      contextFeatures: {
        baselineConversion: 0.841,
        averageOrderValue: 120000
      },
      predictedUplift: 0.08,
      actualUplift: 0.075, // performed well
      predictionError: 0.0625,
      cost: 2200000,
      roi: 1.45,
      weightModifier: 1.05, // slightly boosted
      recordedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    });

    console.log('Seeded Campaign and Strategy Memory.');
  });

  await mongoose.disconnect();
  console.log('Seed completed successfully.');
}

seed().catch((err) => {
  console.error('Error seeding data:', err);
  process.exit(1);
});
