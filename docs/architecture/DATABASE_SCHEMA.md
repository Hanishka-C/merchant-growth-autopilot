# Database Schema: Merchant Growth Autopilot

This document specifies the MongoDB database schemas, model fields, indexes, and validation rules utilizing Mongoose.

## 1. Schema Overview
Every collection (except global evaluation data) stores a `merchantId` field to guarantee absolute tenant isolation. Mongoose middleware is configured to intercept queries and automatically inject `merchantId` from the active request context.

```
+-----------------------------------+
|             Merchants             |
+-----------------------------------+
                  | (1:N)
                  v
+-----------------------------------+
|           Transactions            |<----+
+-----------------------------------+     |
                  | (1:1)                 |
                  v                       |
+-----------------------------------+     | (1:N)
|             Customers             |     |
+-----------------------------------+     |
                  | (1:N)                 |
                  v                       |
+-----------------------------------+     |
|             Campaigns             |-----+
+-----------------------------------+
```

---

## 2. Model Specifications

### 2.1 Merchant Model (`merchants`)
Stores merchant account profiles and credentials.

```typescript
const MerchantSchema = new Schema({
  merchantId: { type: String, required: true, unique: true, index: true },
  businessName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  apiKeyId: { type: String, default: null }, // Razorpay Sandboxed credentials
  apiKeySecret: { type: String, default: null },
  webhookSecret: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});
```

---

### 2.2 Transaction Model (`transactions`)
Logs order checkout payments and failures.

```typescript
const TransactionSchema = new Schema({
  transactionId: { type: String, required: true, unique: true },
  merchantId: { type: String, required: true, index: true },
  customerId: { type: String, required: true, index: true },
  amount: { type: Number, required: true }, // In Paise (e.g. 100000 = 1000 INR)
  currency: { type: String, required: true, default: 'INR' },
  method: { type: String, required: true, enum: ['upi', 'card', 'netbanking', 'wallet'] },
  bank: { type: String, default: null }, // Gateway identifier (e.g. HDFC, SBI, ICICI)
  status: { type: String, required: true, enum: ['created', 'authorized', 'captured', 'failed'] },
  errorCode: { type: String, default: null }, // e.g. BAD_REQUEST_PAYMENT_TIMED_OUT
  errorDescription: { type: String, default: null },
  offerId: { type: String, default: null, index: true }, // Link to campaign offer
  paymentLinkId: { type: String, default: null },
  timestamp: { type: Date, required: true, index: true }
});

// Compound Indexes for fast analytics queries
TransactionSchema.index({ merchantId: 1, timestamp: -1 });
TransactionSchema.index({ method: 1, bank: 1, status: 1 });
```

---

### 2.3 Customer Model (`customers`)
Stores shopper profiles and properties.

```typescript
const CustomerSchema = new Schema({
  customerId: { type: String, required: true, unique: true },
  merchantId: { type: String, required: true, index: true },
  email: { type: String, required: true },
  phone: { type: String, default: null },
  segments: { type: [String], default: [] }, // e.g. ["high_value", "inactive"]
  aov: { type: Number, default: 0 },          // Average order value in Paise
  successfulTxCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

CustomerSchema.index({ merchantId: 1, segments: 1 });
```

---

### 2.4 Campaign Model (`campaigns`)
Defines growth incentives created in Razorpay or simulated.

```typescript
const CampaignSchema = new Schema({
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
```

---

### 2.5 Agent Run Model (`agent_runs`)
Stores complete audit traces of agent actions.

```typescript
const AgentRunSchema = new Schema({
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
  proposals: [{ type: Schema.Types.ObjectId, ref: 'approvals' }],
  createdAt: { type: Date, default: Date.now }
});

AgentRunSchema.index({ merchantId: 1, createdAt: -1 });
```

---

### 2.6 Approval Model (`approvals`)
HITL approval records.

```typescript
const ApprovalSchema = new Schema({
  approvalId: { type: String, required: true, unique: true },
  merchantId: { type: String, required: true, index: true },
  runId: { type: String, required: true, index: true },
  status: { type: String, required: true, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  actionDetails: {
    type: { type: String, required: true }, // e.g. "razorpay_offer_creation"
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
```

---

### 2.7 Strategy Memory Model (`strategy_memory`)
Closed-loop learning weight persistent collections.

```typescript
const StrategyMemorySchema = new Schema({
  merchantId: { type: String, required: true, index: true },
  strategyType: { type: String, required: true }, // e.g. "payment_method_fallback"
  segmentKey: { type: String, required: true },   // e.g. "high_value_upi_users"
  contextFeatures: {
    baselineConversion: { type: Number },
    averageOrderValue: { type: Number }
  },
  predictedUplift: { type: Number, required: true },
  actualUplift: { type: Number, default: null },
  predictionError: { type: Number, default: null },
  cost: { type: Number, required: true },
  roi: { type: Number, required: true },
  weightModifier: { type: Number, default: 1.0 }, // Cumulative multiplier
  recordedAt: { type: Date, default: Date.now }
});

// Composite Index for rapid retrieval during prompt assembly
StrategyMemorySchema.index({ strategyType: 1, segmentKey: 1 });
StrategyMemorySchema.index({ merchantId: 1, recordedAt: -1 });
```
