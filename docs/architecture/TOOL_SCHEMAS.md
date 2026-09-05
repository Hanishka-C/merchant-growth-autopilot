# Tool Schemas: Merchant Growth Autopilot

This document specifies the TypeScript interfaces and Zod validation schemas for the 7 tools available to the Agent.

---

## 1. get_transaction_metrics
Retrieves high-level transaction conversion metrics for a given timeframe.

### Input Schema (Zod)
```typescript
import { z } from 'zod';

export const GetTransactionMetricsInput = z.object({
  timeframeDays: z.number().min(1).max(90).default(30),
  method: z.enum(['upi', 'card', 'netbanking', 'wallet']).optional()
});
```

### Output Schema (Zod)
```typescript
export const GetTransactionMetricsOutput = z.object({
  totalAttempts: z.number(),
  successCount: z.number(),
  failedCount: z.number(),
  successRate: z.number(), // 0.0 to 100.0
  averageOrderValue: z.number(), // in Paise
  totalRevenue: z.number() // in Paise
});
```

---

## 2. analyze_payment_failures
Identifies error code distributions and pinpoints high-rate payment failure root causes.

### Input Schema (Zod)
```typescript
export const AnalyzePaymentFailuresInput = z.object({
  timeframeDays: z.number().min(1).max(30).default(7)
});
```

### Output Schema (Zod)
```typescript
export const AnalyzePaymentFailuresOutput = z.object({
  failures: z.array(z.object({
    method: z.enum(['upi', 'card', 'netbanking', 'wallet']),
    bank: z.string().nullable(),
    errorCode: z.string(),
    errorDescription: z.string(),
    count: z.number(),
    failureRate: z.number() // Share of total failures
  })),
  anomaliesDetected: z.array(z.object({
    gateway: z.string(),
    method: z.string(),
    failureSpikeRate: z.number(),
    severity: z.enum(['low', 'medium', 'high'])
  }))
});
```

---

## 3. get_customer_segments
Fetches active customer segment distributions, sizes, and baselines.

### Input Schema (Zod)
```typescript
export const GetCustomerSegmentsInput = z.object({});
```

### Output Schema (Zod)
```typescript
export const GetCustomerSegmentsOutput = z.object({
  segments: z.array(z.object({
    segmentKey: z.string(),
    name: z.string(),
    size: z.number(),
    averageOrderValue: z.number(), // in Paise
    baselineConversionRate: z.number() // 0.0 to 100.0
  }))
});
```

---

## 4. get_campaign_history
Fetches outcomes of previously executed campaign strategies on target segments to establish baseline benchmarks.

### Input Schema (Zod)
```typescript
export const GetCampaignHistoryInput = z.object({
  strategyType: z.enum(['payment_method_fallback', 'cart_value_boost', 'checkout_recovery']).optional()
});
```

### Output Schema (Zod)
```typescript
export const GetCampaignHistoryOutput = z.object({
  campaigns: z.array(z.object({
    campaignId: z.string(),
    name: z.string(),
    strategyType: z.string(),
    segmentKey: z.string(),
    expectedUpliftPercent: z.number(),
    actualUpliftPercent: z.number().nullable(),
    budget: z.number(),
    spend: z.number(),
    netRevenueUplift: z.number().nullable(),
    roi: z.number().nullable(),
    status: z.enum(['active', 'completed'])
  }))
});
```

---

## 5. run_growth_simulation
Executes the deterministic simulator. Can project outcomes for multiple strategy scenarios side-by-side.

### Input Schema (Zod)
```typescript
export const RunGrowthSimulationInput = z.object({
  strategyType: z.enum(['payment_method_fallback', 'cart_value_boost', 'checkout_recovery']),
  segmentKey: z.string(),
  parameters: z.object({
    discountPercentage: z.number().min(1).max(50).optional(),
    maxDiscountAmount: z.number().min(0).optional(),
    minOrderAmount: z.number().min(0).optional(),
    applicableMethods: z.array(z.string()).optional()
  }),
  budget: z.number().min(0)
});
```

### Output Schema (Zod)
```typescript
export const RunGrowthSimulationOutput = z.object({
  expectedUpliftPercent: z.number(),
  expectedRevenueUplift: z.number(), // in Paise
  expectedCampaignCost: z.number(), // in Paise
  netProfitImpact: z.number(), // in Paise
  roi: z.number(),
  confidenceInterval: z.object({
    lower: z.number(),
    upper: z.number()
  }),
  riskLevel: z.enum(['low', 'medium', 'high'])
});
```

---

## 6. create_razorpay_action
Proposes a campaign action structure. Generates a pending approval record (does NOT immediately execute).

### Input Schema (Zod)
```typescript
export const CreateRazorpayActionInput = z.object({
  strategyType: z.enum(['payment_method_fallback', 'cart_value_boost', 'checkout_recovery']),
  segmentKey: z.string(),
  parameters: z.object({
    discountPercentage: z.number().optional(),
    maxDiscountAmount: z.number().optional(),
    minOrderAmount: z.number().optional(),
    applicableMethods: z.array(z.string()).optional()
  }),
  budget: z.number(),
  simulationSummary: z.object({
    expectedUpliftPercent: z.number(),
    expectedRevenueUplift: z.number(),
    expectedCampaignCost: z.number(),
    roi: z.number()
  })
});
```

### Output Schema (Zod)
```typescript
export const CreateRazorpayActionOutput = z.object({
  approvalId: z.string(),
  status: z.enum(['pending']),
  policyResult: z.object({
    passed: z.boolean(),
    violations: z.array(z.string())
  })
});
```

---

## 7. get_action_performance
Queries performance telemetry of an executing or finished campaign.

### Input Schema (Zod)
```typescript
export const GetActionPerformanceInput = z.object({
  campaignId: z.string()
});
```

### Output Schema (Zod)
```typescript
export const GetActionPerformanceOutput = z.object({
  campaignId: z.string(),
  status: z.string(),
  activeDays: z.number(),
  telemetry: z.object({
    attempts: z.number(),
    successes: z.number(),
    failures: z.number(),
    conversionRate: z.number(),
    costIncurred: z.number(), // in Paise
    revenueGenerated: z.number() // in Paise
  })
});
```
