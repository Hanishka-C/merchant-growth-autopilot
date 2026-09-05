# Razorpay Test-Mode Integration: Merchant Growth Autopilot

This document specifies the Razorpay Sandbox integration endpoints, request structures, and simulated components used in Merchant Growth Autopilot.

## 1. Sandbox API Credentials
All integrations use sandbox mode credentials. Live credentials are never loaded or configured:
```env
RAZORPAY_KEY_ID=rzp_test_5d1a89c20f
RAZORPAY_KEY_SECRET=yourkeysecret
RAZORPAY_WEBHOOK_SECRET=yourwebhooksecret
```
The Express backend instantiates the client using:
```typescript
import Razorpay from 'razorpay';
export const razorpayClient = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});
```

---

## 2. API Endpoints Map

### 2.1 Razorpay Offers API (Creating Discount Campaigns)
Used to target customers with card fallback discounts or purchase-value bumps.
- **Endpoint**: `POST /v1/offers`
- **Request Payload**:
```json
{
  "name": "SBI Card Fallback Discount",
  "active": true,
  "display_offer_type": "discount",
  "payment_method": "card",
  "action": "discount",
  "amount_type": "percentage",
  "amount_value": 5,
  "max_amount": 50000, // in Paise (500 INR)
  "min_amount": 100000, // in Paise (1000 INR)
  "options": {
    "order": {
      "method": "card",
      "bank": "SBI"
    }
  }
}
```
- **Response Mapping**:
The API returns an Offer object. The system maps the returned `id` (e.g. `ofr_FN7e289ac120`) to `campaign.razorpayOfferId` in the database.

---

### 2.2 Razorpay Payment Links API (Checkout Recovery)
Used to send targeted cart recovery messages to shoppers whose checkout attempts failed.
- **Endpoint**: `POST /v1/payment_links`
- **Request Payload**:
```json
{
  "amount": 120000, // in Paise
  "currency": "INR",
  "accept_partial": false,
  "reference_id": "tx_fa9128cd37b0",
  "description": "Checkout Recovery Link - Merchant Autopilot",
  "customer": {
    "name": "Shopper Name",
    "email": "customer@gmail.com",
    "contact": "+919876543210"
  },
  "notify": {
    "sms": false,
    "email": true
  },
  "reminder_enable": true,
  "notes": {
    "merchantId": "mer_673e51240a1b",
    "campaignId": "camp_checkout_recovery_s01"
  }
}
```
- **Response Mapping**:
The API returns a payment link URL (e.g. `https://rzp.io/i/xyz`). The system saves this URL and simulates customer checkout on it.

---

## 3. Sandbox Webhook Payload Capture
The system listens to the following sandbox webhook events on `/api/webhooks/razorpay`:

1. **`payment.captured`**:
   - Triggered when a customer successfully pays.
   - The system checks if `notes.offer_id` or `notes.campaignId` exists.
   - If present, it attributes the payment capture to the active campaign, updates the conversion tracker, and records the discount spend.

2. **`payment.failed`**:
   - Triggered when a payment attempt fails.
   - Used by the monitoring telemetry engine to track SBI or HDFC gateway failure rate trends.

---

## 4. Razorpay Test-Mode API vs Application Simulation

Not all growth actions are natively supported by the Razorpay API. The system clearly distinguishes between real sandboxed API operations and database-level application simulation:

| Growth Action | Razorpay API | Sandbox Execution Details | Application Simulation |
|---|---|---|---|
| Card Fallback Discount | YES | Calls `POST /v1/offers` | None |
| Targeted Cart Recovery Link | YES | Calls `POST /v1/payment_links` | None |
| AOV Tiered Discount | YES | Calls `POST /v1/offers` | None |
| Cohort Email Campaign | NO | None | Simulates delivery logs in the `campaigns` database. Clearly marked `simulated_action: true`. |
| NetBanking Failover switch | NO | None | Simulates gateway redirect weight updates. |

This layout ensures that the merchant is informed of what is executing on Razorpay APIs versus what is simulated within our application boundaries.
