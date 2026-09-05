# API Contracts: Merchant Growth Autopilot

This document defines the REST APIs, Server-Sent Events (SSE) stream, and Webhook notification payloads for the Merchant Growth Autopilot backend.

## 1. Authentication
All endpoints must be authenticated using a JWT token passed in the `Authorization` header:
```http
Authorization: Bearer <JWT_TOKEN>
```
The payload of this JWT contains:
```json
{
  "merchantId": "mer_673e51240a1b",
  "email": "owner@merchant.com",
  "role": "admin"
}
```
All queries strictly append `merchantId` at the database level.

---

## 2. REST Endpoints

### 2.1 Submit Business Goal
Start a new agent execution loop by defining a high-level target and spending constraints.

- **URL**: `/api/goals`
- **Method**: `POST`
- **Request Body**:
```typescript
interface SubmitGoalRequest {
  metric: 'successful_payments' | 'average_order_value' | 'customer_retention';
  targetUpliftPercent: number; // e.g. 10.0 for 10% uplift
  timeframeDays: number;       // e.g. 30
  budgetCap: number;           // e.g. 50000 (INR)
  scenarioSeed?: string;       // Optional: "upi_failure_spike", "aov_decline" etc. for testing
}
```
- **Response** (Status `202 Accepted`):
```json
{
  "success": true,
  "runId": "run_8b12f45c92e1",
  "message": "Agent execution cycle initiated.",
  "createdAt": "2026-08-24T10:25:00Z"
}
```

---

### 2.2 Retrieve Agent Runs
Fetch execution history or current status.

- **URL**: `/api/runs`
- **Method**: `GET`
- **Response** (Status `200 OK`):
```json
[
  {
    "runId": "run_8b12f45c92e1",
    "goal": {
      "metric": "successful_payments",
      "targetUpliftPercent": 10,
      "timeframeDays": 30,
      "budgetCap": 50000
    },
    "status": "investigating",
    "createdAt": "2026-08-24T10:25:00Z"
  }
]
```

---

### 2.3 Get Root Cause Diagnosis
Fetch structured business problem identification.

- **URL**: `/api/runs/:runId/diagnosis`
- **Method**: `GET`
- **Response** (Status `200 OK`):
```json
{
  "runId": "run_8b12f45c92e1",
  "rootCauseCode": "UPI_GATEWAY_TIMEOUT_SPIKE",
  "description": "SBI UPI gateway success rate dropped from 91.2% to 42.5% starting 2026-08-23T18:00:00Z.",
  "affectedCohort": {
    "segmentKey": "high_value_upi_users",
    "segmentSize": 4500,
    "criteria": "Order amount >= 1000 INR and payment method = UPI"
  },
  "diagnosedAt": "2026-08-24T10:25:12Z"
}
```

---

### 2.4 Get Simulated Strategies
Get details of generated strategies and simulation metrics before approval.

- **URL**: `/api/runs/:runId/strategies`
- **Method**: `GET`
- **Response** (Status `200 OK`):
```json
{
  "runId": "run_8b12f45c92e1",
  "strategies": [
    {
      "strategyId": "strat_card_fallback_01",
      "type": "payment_method_fallback",
      "name": "UPI fallback to Card/NetBanking Discount",
      "parameters": {
        "discountPercentage": 5,
        "maxDiscountAmount": 100,
        "applicableMethods": ["card", "netbanking"]
      },
      "simulation": {
        "expectedUpliftPercent": 7.2,
        "expectedRevenueUplift": 81000,
        "expectedCampaignCost": 32000,
        "netProfitImpact": 49000,
        "roi": 1.53,
        "confidenceInterval": {
          "lower": 5.4,
          "upper": 9.0
        },
        "riskLevel": "low"
      },
      "policyValidation": {
        "passed": true,
        "violations": []
      }
    }
  ]
}
```

---

### 2.5 Submit Human Approval
Execute or reject a policy-compliant proposed action.

- **URL**: `/api/approvals/:approvalId`
- **Method**: `POST`
- **Request Body**:
```json
{
  "status": "approved", // or "rejected"
  "comments": "Proceeding with card fallback incentive."
}
```
- **Response** (Status `200 OK`):
```json
{
  "success": true,
  "approvalId": "app_5d1a89c20f4b",
  "status": "approved",
  "executionId": "exec_fa9128cd37b0",
  "action": {
    "type": "razorpay_offer_creation",
    "razorpayOfferId": "ofr_test_9c12a84d",
    "timestamp": "2026-08-24T10:26:05Z"
  }
}
```

---

### 2.6 Fetch Live Telemetry (Monitoring)
Retrieve conversion rates, metrics and target comparisons for active campaigns.

- **URL**: `/api/monitoring`
- **Method**: `GET`
- **Response** (Status `200 OK`):
```json
{
  "activeCampaignId": "ofr_test_9c12a84d",
  "metrics": {
    "baselineConversion": 84.1,
    "predictedConversion": 91.3,
    "actualConversion": 89.8,
    "predictionError": -1.5,
    "predictedRevenue": 81000,
    "actualRevenue": 76500,
    "spendLimit": 50000,
    "actualSpend": 30200,
    "roi": 1.53
  },
  "historicalSeries": [
    { "timestamp": "2026-08-24T10:30:00Z", "predicted": 84.1, "actual": 84.1 },
    { "timestamp": "2026-08-24T11:00:00Z", "predicted": 91.3, "actual": 89.8 }
  ]
}
```

---

## 3. Server-Sent Events (SSE) Stream

- **URL**: `/api/runs/:runId/stream`
- **Method**: `GET`
- **Headers**:
  - `Content-Type: text/event-stream`
  - `Cache-Control: no-cache`
  - `Connection: keep-alive`

### SSE Event Formats
Every message emitted contains a JSON string in the `data` block.

#### Event: `trace`
Emitted as the agent goes through reasoning steps.
```json
{
  "event": "trace",
  "timestamp": "2026-08-24T10:25:04Z",
  "node": {
    "type": "decision",
    "decision": "Fetch customer segments to identify high-value UPI users.",
    "evidence": "UPI success rate has crashed from 90% to 40%. Segment filtering necessary.",
    "nextAction": "get_customer_segments"
  }
}
```

#### Event: `tool_execution`
Emitted when a tool is called, and once it returns.
```json
{
  "event": "tool_execution",
  "timestamp": "2026-08-24T10:25:05Z",
  "tool": "get_customer_segments",
  "status": "executing",
  "payload": { "merchantId": "mer_673e51240a1b" }
}
```
```json
{
  "event": "tool_execution",
  "timestamp": "2026-08-24T10:25:06Z",
  "tool": "get_customer_segments",
  "status": "completed",
  "result": { "segments": [{ "key": "high_value_upi_users", "size": 4500 }] }
}
```

#### Event: `state_change`
Emitted when the agent moves from one state to another.
```json
{
  "event": "state_change",
  "timestamp": "2026-08-24T10:25:12Z",
  "fromState": "investigating",
  "toState": "diagnosing"
}
```

---

## 4. Webhook Contract (Razorpay Sandbox Simulator)
The system exposes a public webhook endpoint to receive notifications from Razorpay Sandbox.

- **URL**: `/api/webhooks/razorpay`
- **Method**: `POST`
- **Headers**:
  - `X-Razorpay-Signature`: HMAC-SHA256 signature calculated over the raw body using `RAZORPAY_WEBHOOK_SECRET`.
- **Payload**:
```json
{
  "entity": "event",
  "account_id": "acc_7e12f9827cd1",
  "event": "payment.captured",
  "contains": ["payment"],
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_FN7e289ac120",
        "amount": 120000,
        "currency": "INR",
        "status": "captured",
        "order_id": "order_EKc8f921dsa",
        "invoice_id": null,
        "international": false,
        "method": "card",
        "amount_refunded": 0,
        "refund_status": null,
        "captured": true,
        "bank": "HDFC",
        "wallet": null,
        "vpa": null,
        "email": "customer@gmail.com",
        "contact": "+919876543210",
        "notes": {
          "merchantId": "mer_673e51240a1b",
          "offer_id": "ofr_test_9c12a84d"
        },
        "fee": 2400,
        "tax": 432,
        "error_code": null,
        "error_description": null,
        "created_at": 1787569800
      }
    }
  },
  "created_at": 1787569801
}
```
If signature verification fails, returns `401 Unauthorized`. If verified, returns `200 OK`.
