"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StrategyMemory = exports.Approval = exports.AgentRun = exports.Campaign = exports.Customer = exports.Transaction = exports.Merchant = void 0;
const mongoose_1 = require("mongoose");
const tenant_1 = require("../utils/tenant");
// Helper to apply tenant isolation middleware to a schema
function applyTenantIsolation(schema) {
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
        schema.pre(method, function (next) {
            const merchantId = (0, tenant_1.getTenantId)();
            if (merchantId) {
                this.where({ merchantId });
            }
            next();
        });
    });
    // Also intercept raw documents during validate to ensure merchantId is set
    schema.pre('validate', function (next) {
        const merchantId = (0, tenant_1.getTenantId)();
        if (merchantId && !this.get('merchantId')) {
            this.set('merchantId', merchantId);
        }
        next();
    });
}
const MerchantSchema = new mongoose_1.Schema({
    merchantId: { type: String, required: true, unique: true, index: true },
    businessName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    apiKeyId: { type: String, default: null },
    apiKeySecret: { type: String, default: null },
    webhookSecret: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});
exports.Merchant = (0, mongoose_1.model)('Merchant', MerchantSchema);
const TransactionSchema = new mongoose_1.Schema({
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
exports.Transaction = (0, mongoose_1.model)('Transaction', TransactionSchema);
const CustomerSchema = new mongoose_1.Schema({
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
exports.Customer = (0, mongoose_1.model)('Customer', CustomerSchema);
const CampaignSchema = new mongoose_1.Schema({
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
exports.Campaign = (0, mongoose_1.model)('Campaign', CampaignSchema);
const AgentRunSchema = new mongoose_1.Schema({
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
            inputs: { type: mongoose_1.Schema.Types.Mixed },
            outputs: { type: mongoose_1.Schema.Types.Mixed },
            error: { type: String, default: null }
        }],
    diagnoses: { type: mongoose_1.Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now }
});
AgentRunSchema.index({ merchantId: 1, createdAt: -1 });
applyTenantIsolation(AgentRunSchema);
exports.AgentRun = (0, mongoose_1.model)('AgentRun', AgentRunSchema);
const ApprovalSchema = new mongoose_1.Schema({
    approvalId: { type: String, required: true, unique: true },
    merchantId: { type: String, required: true, index: true },
    runId: { type: String, required: true, index: true },
    status: { type: String, required: true, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    actionDetails: {
        type: { type: String, required: true },
        payload: { type: mongoose_1.Schema.Types.Mixed, required: true }
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
            limit: { type: mongoose_1.Schema.Types.Mixed },
            value: { type: mongoose_1.Schema.Types.Mixed }
        }],
    requestedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date, default: null }
});
applyTenantIsolation(ApprovalSchema);
exports.Approval = (0, mongoose_1.model)('Approval', ApprovalSchema);
const StrategyMemorySchema = new mongoose_1.Schema({
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
exports.StrategyMemory = (0, mongoose_1.model)('StrategyMemory', StrategyMemorySchema);
