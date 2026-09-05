# Failure Recovery & Graceful Degradation: Merchant Growth Autopilot

This document specifies how the system handles tool, API, network, and simulation failures without crashing or exposing corrupted metrics.

## 1. Retry and Fallback Framework

Every tool execution block is wrapped in a standardized execution envelope that manages:
1. **Timeout Enforcement**: Enforces a strict limit (<3000ms).
2. **Exponential Backoff**: Automates retries on network failures.
3. **Graceful Fallbacks**: Uses cached telemetry baselines if retries exhaust.
4. **Confidence Penalization**: Lowers confidence boundaries when data is degraded.

---

## 2. Standardized Tool Executor (TypeScript)

```typescript
export interface ExecutionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  retryCount: number;
  isFallback: boolean;
  confidencePenaltyApplied: boolean;
}

export async function executeWithRecovery<T>(
  toolName: string,
  fn: () => Promise<T>,
  fallbackValue: T,
  maxRetries = 2,
  timeoutMs = 3000
): Promise<ExecutionResult<T>> {
  let attempt = 0;
  let delay = 300; // ms

  while (attempt <= maxRetries) {
    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout: Tool ${toolName} exceeded ${timeoutMs}ms`)), timeoutMs)
        )
      ]);
      return {
        success: true,
        data: result,
        retryCount: attempt,
        isFallback: false,
        confidencePenaltyApplied: false
      };
    } catch (err: any) {
      attempt++;
      if (attempt > maxRetries) {
        break;
      }
      // Exponential backoff delay
      await new Promise(res => setTimeout(res, delay));
      delay *= 2;
    }
  }

  // If we reach here, all retries failed. Trigger fallback.
  return {
    success: true, // Mark true to allow agent execution to proceed, but flag as degraded
    data: fallbackValue,
    error: `Retries exhausted. Fallback loaded.`,
    retryCount: maxRetries,
    isFallback: true,
    confidencePenaltyApplied: true
  };
}
```

---

## 3. Degradation Matrix

| Failure Point | Direct Consequence | Immediate Action | Graceful Degradation |
|---|---|---|---|
| `get_campaign_history` timeout | Unable to compare previous strategy baselines. | Retry up to 2 times, then return static seed campaigns. | Penalize strategy confidence by 20%. Expose warning badge. |
| `get_transaction_metrics` 500 error | Cannot calculate current baseline conversion rate. | Fallback to cached merchant averages from the previous day. | Adjust simulator outputs to show wider confidence interval (+/- 5% additional uncertainty). |
| Razorpay Offers API timeout | Offer creation fails. Campaign cannot go live. | Log error, change execution record state to `failed_execution`. | Set Campaign status to `failed`. Send alert to user dashboard. Do not trigger telemetry. |
| Webhook receiver crash | Telemetry updates are blocked. Learning cycle breaks. | Polling queue activates. Queries transactions table every hour. | Switch monitoring display from "real-time" to "hourly-polled". |

---

## 4. Confidence Penalty Calculation
When a fallback is triggered, the Simulator outputs a penalty multiplier to reflect the higher uncertainty of the baseline:
\[CI_{\text{adjusted}} = CI \cdot 1.25\]
The uncertainty bounds are expanded by 25%. This prevents the cognitive agent from aggressively executing fallback-derived strategies unless they have extremely high margins.
