# Policy Engine: Merchant Growth Autopilot

This document specifies the rule sets, design implementation, and JSON structures for the server-side deterministic Policy Engine.

## 1. Safety Boundaries
The LLM is highly cognitive but behaves non-deterministically. To safeguard the merchant's financial capital and client relationships, the Policy Engine resides strictly on the Node.js backend.
- The Agent **cannot** override policies.
- If a policy check fails, the execution is blocked immediately on the server.
- The Engine outputs structured, typed explanations outlining exactly which rule parameters were violated.

---

## 2. Standard Rules Catalog

| Rule Code | Name | Default Limit | Description |
|---|---|---|---|
| `MAX_CAMPAIGN_BUDGET` | Maximum Campaign Budget | ₹50,000 | Total budget cap for a single growth action. |
| `MAX_DISCOUNT_PERCENT` | Maximum Discount Percentage | 25% | Maximum percentage discount allowed on an item/order. |
| `MAX_DISCOUNT_AMOUNT` | Maximum Discount Amount | ₹500 | Absolute discount limit per transaction. |
| `MIN_AOV_FLOOR_FACTOR` | Margin Floor Factor | 3.0 | Minimum order value must be at least 3x the discount value. |
| `REQUIRE_HITL_APPROVAL` | Human Approval Required | True | All mutating actions (e.g. creating offers) require merchant sign-off. |
| `REFUNDS_PROHIBITED` | Automated Refunds Blocked | Prohibited | Automated agent cannot issue refunds. |
| `COHORT_SIZE_FLOOR` | Cohort Size Floor | 100 users | Minimum target segment size to prevent hyper-specific target spamming. |

---

## 3. Evaluation Signature (TypeScript)

The Policy Engine implements a simple validator interface:

```typescript
export interface PolicyRule {
  code: string;
  name: string;
  validate(action: ProposedAction, merchantSettings: MerchantSettings): RuleResult;
}

export interface ProposedAction {
  strategyType: 'payment_method_fallback' | 'cart_value_boost' | 'checkout_recovery';
  segmentKey: string;
  segmentSize: number;
  budget: number;
  parameters: {
    discountPercentage?: number;
    maxDiscountAmount?: number;
    minOrderAmount?: number;
    applicableMethods?: string[];
  };
}

export interface RuleResult {
  code: string;
  status: 'PASSED' | 'FAILED';
  limit: any;
  value: any;
  message?: string;
}

export interface PolicyReport {
  passed: boolean;
  violations: string[];
  rulesChecked: RuleResult[];
}
```

---

## 4. Policy Engine Execution Example

```typescript
export class DeterministicPolicyEngine {
  private rules: PolicyRule[] = [
    {
      code: 'MAX_CAMPAIGN_BUDGET',
      name: 'Maximum Campaign Budget Check',
      validate: (action) => ({
        code: 'MAX_CAMPAIGN_BUDGET',
        status: action.budget <= 50000 ? 'PASSED' : 'FAILED',
        limit: 50000,
        value: action.budget
      })
    },
    {
      code: 'MAX_DISCOUNT_PERCENT',
      name: 'Maximum Discount Percentage Check',
      validate: (action) => ({
        code: 'MAX_DISCOUNT_PERCENT',
        status: !action.parameters.discountPercentage || action.parameters.discountPercentage <= 25 ? 'PASSED' : 'FAILED',
        limit: 25,
        value: action.parameters.discountPercentage || 0
      })
    },
    {
      code: 'MIN_AOV_FLOOR_FACTOR',
      name: 'Minimum Margin Floor Check',
      validate: (action) => {
        const discount = action.parameters.maxDiscountAmount || 0;
        const minOrder = action.parameters.minOrderAmount || 0;
        const passed = minOrder >= 3 * discount;
        return {
          code: 'MIN_AOV_FLOOR_FACTOR',
          status: passed ? 'PASSED' : 'FAILED',
          limit: `minOrder >= 3 * discount`,
          value: `minOrder: ${minOrder}, discount: ${discount}`
        };
      }
    }
  ];

  public evaluate(action: ProposedAction): PolicyReport {
    const results = this.rules.map(rule => rule.validate(action, {}));
    const violations = results
      .filter(r => r.status === 'FAILED')
      .map(r => `${r.code} violation: value ${r.value} exceeded limit ${r.limit}`);

    return {
      passed: violations.length === 0,
      violations,
      rulesChecked: results
    };
  }
}
```

---

## 5. Security & Isolation Guarantee
The policy checks are triggered in Express route controllers right before saving the Approval record:
1. Express receives `POST /api/approvals`.
2. Controller calls `policyEngine.evaluate(action)`.
3. If check returns `{ passed: false }`, the request returns `400 Bad Request` with the `violations` array.
4. Database write is prevented, shielding database and downstream APIs from prompt injection manipulations.
