# Security Model: Merchant Growth Autopilot

This document defines the security boundaries, tenant isolation mechanisms, prompt injection safeguards, and webhook validation protocols.

## 1. Security Architecture and Trust Boundaries

The core security principle is: **Never trust the cognitive agent as an authority.**
The trust boundaries are strictly configured to prevent the agent from performing unauthorized actions even if it is compromised or hallucinating.

```
       [ Client Dashboard / API Consumer ]
                      |
        JWT Verification & Tenant Filter (Express middleware)
                      v
       ================= TRUST BOUNDARY =================
                      |
           [ Express API Controller ]
            - Input validation (Zod)
            - Policy enforcement (Deterministic check)
            - Database tenant binding (Mongoose filter)
                      |
                      +-------------------+
                      |                   |
                      v                   v
               [ cognitive Agent ]  [ Execution Engine ]
                (Untrusted Layer)   - Sandbox execution
                                    - Webhook verification
```

---

## 2. Strict Tenant Isolation
To prevent leaks or data crossing between different merchant accounts:
1. Every MongoDB schema contains a `merchantId` string.
2. The authentication middleware extracts `merchantId` from the verified JWT and binds it to `req.user.merchantId`.
3. In Mongoose, we register pre-find and pre-save hooks to automatically inject `merchantId` filters:

```typescript
// Mongoose Tenant Middleware Example
schema.pre('find', function() {
  const currentMerchantId = TenantContext.getMerchantId();
  if (currentMerchantId) {
    this.where({ merchantId: currentMerchantId });
  }
});
```
This guarantees that even if the cognitive agent requests metrics without specifying the `merchantId`, the query is restricted to that merchant’s database partition.

---

## 3. Zod Input Validation
Every tool input is validated before being executed by the tool handler:
- Input parameters passed by the LLM are parsed using Zod's `.parse()` method.
- If schema validation fails, the tool returns a schema-validation-failed payload immediately, preventing execution of database queries or API operations.

---

## 4. Prompt Injection Safeguards
To prevent prompt injection from affecting execution:
- Tools **never** accept raw code blocks, database query queries, or scripting languages.
- Tools only accept highly typed, structured scalar values (e.g. `timeframeDays: number`, `discountPercentage: number`).
- The Agent prompt instructions declare that tool call payloads must match the schema exactly.

---

## 5. Webhook Signature Checking
Razorpay Sandbox webhook events must be validated using HMAC-SHA256 signature checking:
```typescript
import crypto from 'crypto';

export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}
```
If the header `X-Razorpay-Signature` does not match, the system discards the payload with a `401 Unauthorized` response to prevent spoofed payments from triggering adaptation rewards.
