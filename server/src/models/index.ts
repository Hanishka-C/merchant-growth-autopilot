import { Schema, model, Document, Query } from 'mongoose';
import { getTenantId } from '../utils/tenant';

// Helper to apply tenant isolation middleware to a schema
function applyTenantIsolation(schema: Schema) {
  const queryMethods = [
    'find',
    'findOne',
    'countDocuments',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'findOneAndUpdate',
    'findOneAndDelete'
  ];
  
  queryMethods.forEach((method) => {
    schema.pre(method as any, function (this: Query<any, any>, next) {
      const merchantId = getTenantId();
      if (merchantId) {
        this.where({ merchantId });
      }
      next();
    });
  });

  // Also intercept raw documents during validate to ensure merchantId is set
  schema.pre('validate', function (next) {
    const merchantId = getTenantId();
    if (merchantId && !this.get('merchantId')) {
      this.set('merchantId', merchantId);
    }
    next();
  });
}

// 1. Merchant Schema
export interface IMerchant extends Document {
  merchantId: string;
  businessName: string;
  email: string;
  apiKeyId: string | null;
  apiKeySecret: string | null;
  webhookSecret: string | null;
  createdAt: Date;
}

const MerchantSchema = new Schema<IMerchant>({
  merchantId: { type: String, required: true, unique: true, index: true },
  businessName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  apiKeyId: { type: String, default: null },
  apiKeySecret: { type: String, default: null },
  webhookSecret: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

export const Merchant = model<IMerchant>('Merchant', MerchantSchema);

// 2. Transaction Schema
export interface ITransaction extends Document {
  transactionId: string;
  merchantId: string;
  customerId: string;
  amount: number;
  currency: string;
  method: 'upi' | 'card' | 'netbanking' | 'wallet';
  bank: string | null;
  status: 'created' | 'authorized' | 'captured' | 'failed';
  errorCode: string | null;
  errorDescription: string | null;
  offerId: string | null;
  paymentLinkId: string | null;
  timestamp: Date;
}

const TransactionSchema = new Schema<ITransaction>({
  transactionId: { type: String, required: true, unique: true },
  merchantId: { type: String, required: true, index: true },
  customerId: { type: String, required: true, index: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true, default: 'INR' },
  method: { type: String, required: true, enum: ['upi', 'card', 'netbanking', 'wallet'] },
  bank: { type: String, default: null },
  status: { type: String, required: true, enum: ['created', 'authorized', 'captured', 'failed'] },
  errorCode: { type: String, default: null },
  errorDescription: { type: String, default: null },
  offerId: { type: String, default: null, index: true },
  paymentLinkId: { type: String, default: null },
  timestamp: { type: Date, required: true, index: true }
});

TransactionSchema.index({ merchantId: 1, timestamp: -1 });
TransactionSchema.index({ method: 1, bank: 1, status: 1 });
applyTenantIsolation(TransactionSchema);

export const Transaction = model<ITransaction>('Transaction', TransactionSchema);

// 3. Customer Schema
export interface ICustomer extends Document {
  customerId: string;
  merchantId: string;
  email: string;
  phone: string | null;
  segments: string[];
  aov: number;
  successfulTxCount: number;
  createdAt: Date;
}

const CustomerSchema = new Schema<ICustomer>({
  customerId: { type: String, required: true, unique: true },
  merchantId: { type: String, required: true, index: true },
  email: { type: String, required: true },
  phone: { type: String, default: null },
  segments: { type: [String], default: [] },
  aov: { type: Number, default: 0 },
  successfulTxCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

CustomerSchema.index({ merchantId: 1, segments: 1 });
applyTenantIsolation(CustomerSchema);

export const Customer = model<ICustomer>('Customer', CustomerSchema);

// 4. Campaign Schema
export interface ICampaign extends Document {
  campaignId: string;
  merchantId: string;
  name: string;
  status: 'active' | 'paused' | 'completed';
  type: 'payment_method_fallback' | 'cart_value_boost' | 'checkout_recovery';
  razorpayOfferId: string | null;
  parameters: {
    discountPercentage?: number;
    maxDiscountAmount?: number;
    minOrderAmount?: number;
    applicableMethods?: string[];
  };
  segmentKey: string;
  budgetCap: number;
  amountSpent: number;
  startedAt: Date;
  endsAt: Date;
}

const CampaignSchema = new Schema<ICampaign>({
  campaignId: { type: String, required: true, unique: true },
  merchantId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  status: { type: String, required: true, enum: ['active', 'paused', 'completed'] },
  type: { type: String, required: true, enum: ['payment_method_fallback', 'cart_value_boost', 'checkout_recovery'] },
  razorpayOfferId: { type: String, default: null },
  parameters: {
    discountPercentage: { type: Number },
    maxDiscountAmount: { type: Number },
    minOrderAmount: { type: Number },
    applicableMethods: { type: [String] }
  },
  segmentKey: { type: String, required: true },
  budgetCap: { type: Number, required: true },
  amountSpent: { type: Number, default: 0 },
  startedAt: { type: Date, required: true },
  endsAt: { type: Date, required: true }
});

applyTenantIsolation(CampaignSchema);

export const Campaign = model<ICampaign>('Campaign', CampaignSchema);

// 5. AgentRun Schema
export interface IAgentRun extends Document {
  runId: string;
  merchantId: string;
  goal: {
    metric: string;
    targetUpliftPercent: number;
    timeframeDays: number;
    budgetCap: number;
  };
  status: 'investigating' | 'diagnosing' | 'simulating' | 'awaiting_approval' | 'executing' | 'completed' | 'failed';
  traces: {
    timestamp: Date;
    type: 'decision' | 'warning' | 'error';
    decision: string;
    evidence: string;
    nextAction: string;
  }[];
  toolCalls: {
    timestamp: Date;
    toolName: string;
    inputs: any;
    outputs: any;
    error: string | null;
  }[];
  diagnoses: any;
  createdAt: Date;
}

const AgentRunSchema = new Schema<IAgentRun>({
  runId: { type: String, required: true, unique: true },
  merchantId: { type: String, required: true, index: true },
  goal: {
    metric: { type: String, required: true },
    targetUpliftPercent: { type: Number, required: true },
    timeframeDays: { type: Number, required: true },
    budgetCap: { type: Number, required: true }
  },
  status: { type: String, required: true, enum: ['investigating', 'diagnosing', 'simulating', 'awaiting_approval', 'executing', 'completed', 'failed'] },
  traces: [{
    timestamp: { type: Date, default: Date.now },
    type: { type: String, enum: ['decision', 'warning', 'error'] },
    decision: { type: String },
    evidence: { type: String },
    nextAction: { type: String }
  }],
  toolCalls: [{
    timestamp: { type: Date, default: Date.now },
    toolName: { type: String },
    inputs: { type: Schema.Types.Mixed },
    outputs: { type: Schema.Types.Mixed },
    error: { type: String, default: null }
  }],
  diagnoses: { type: Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now }
});

AgentRunSchema.index({ merchantId: 1, createdAt: -1 });
applyTenantIsolation(AgentRunSchema);

export const AgentRun = model<IAgentRun>('AgentRun', AgentRunSchema);

// 6. Approval Schema
export interface IApproval extends Document {
  approvalId: string;
  merchantId: string;
  runId: string;
  status: 'pending' | 'approved' | 'rejected';
  actionDetails: {
    type: string;
    payload: any;
  };
  simulationSummary: {
    expectedUpliftPercent: number;
    expectedRevenueUplift: number;
    expectedCampaignCost: number;
    roi: number;
    confidenceLowerBound: number;
    confidenceUpperBound: number;
  };
  policyChecks: {
    ruleName: string;
    status: 'PASSED' | 'FAILED';
    limit: any;
    value: any;
  }[];
  requestedAt: Date;
  resolvedAt: Date | null;
}

const ApprovalSchema = new Schema<IApproval>({
  approvalId: { type: String, required: true, unique: true },
  merchantId: { type: String, required: true, index: true },
  runId: { type: String, required: true, index: true },
  status: { type: String, required: true, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  actionDetails: {
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true }
  },
  simulationSummary: {
    expectedUpliftPercent: { type: Number },
    expectedRevenueUplift: { type: Number },
    expectedCampaignCost: { type: Number },
    roi: { type: Number },
    confidenceLowerBound: { type: Number },
    confidenceUpperBound: { type: Number }
  },
  policyChecks: [{
    ruleName: { type: String },
    status: { type: String, enum: ['PASSED', 'FAILED'] },
    limit: { type: Schema.Types.Mixed },
    value: { type: Schema.Types.Mixed }
  }],
  requestedAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null }
});

applyTenantIsolation(ApprovalSchema);

export const Approval = model<IApproval>('Approval', ApprovalSchema);

// 7. StrategyMemory Schema
export interface IStrategyMemory extends Document {
  merchantId: string;
  strategyType: 'payment_method_fallback' | 'cart_value_boost' | 'checkout_recovery';
  segmentKey: string;
  contextFeatures: {
    baselineConversion: number;
    averageOrderValue: number;
  };
  predictedUplift: number;
  actualUplift: number | null;
  predictionError: number | null;
  cost: number;
  roi: number;
  weightModifier: number;
  recordedAt: Date;
}

const StrategyMemorySchema = new Schema<IStrategyMemory>({
  merchantId: { type: String, required: true, index: true },
  strategyType: { type: String, required: true, enum: ['payment_method_fallback', 'cart_value_boost', 'checkout_recovery'] },
  segmentKey: { type: String, required: true },
  contextFeatures: {
    baselineConversion: { type: Number },
    averageOrderValue: { type: Number }
  },
  predictedUplift: { type: Number, required: true },
  actualUplift: { type: Number, default: null },
  predictionError: { type: Number, default: null },
  cost: { type: Number, required: true },
  roi: { type: Number, required: true },
  weightModifier: { type: Number, default: 1.0 },
  recordedAt: { type: Date, default: Date.now }
});

StrategyMemorySchema.index({ strategyType: 1, segmentKey: 1 });
StrategyMemorySchema.index({ merchantId: 1, recordedAt: -1 });
applyTenantIsolation(StrategyMemorySchema);

export const StrategyMemory = model<IStrategyMemory>('StrategyMemory', StrategyMemorySchema);
