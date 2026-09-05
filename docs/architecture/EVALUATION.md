# Evaluation Framework: Merchant Growth Autopilot

This document defines the architecture of the automated benchmarking suite, specifying the metrics formulas, scenario configuration, and run loops for the 50 test scenarios.

## 1. Benchmarking Engine Layout
The evaluation framework is located in `/evaluation`. It runs independently of the production server, using seed database states to test the agent’s logic under a wide variety of conditions.

```
/evaluation
├── scenarios/
│   ├── s01_upi_failure.json
│   ├── s02_aov_drop.json
│   └── ... (50 files total)
├── runner.ts
└── metrics.ts
```

---

## 2. Core Metrics Formulations

During a benchmarking run, the framework logs trace parameters and calculates the following scores:

### 2.1 Tool Selection F1-Score
Measures how accurately the agent selects the required tools for a given goal.
\[F1 = 2 \cdot \frac{\text{Precision} \cdot \text{Recall}}{\text{Precision} + \text{Recall}}\]

Where:
- **Precision**: \(\frac{\text{Correct tools selected}}{\text{Total tools selected}}\)
- **Recall**: \(\frac{\text{Correct tools selected}}{\text{Required tools in scenario gold set}}\)

---

### 2.2 Task Success Rate
The percentage of scenarios where the agent successfully reaches the final proposed strategy and awaits approval, without encountering unhandled failures:
\[\text{Success Rate} = \frac{\text{Completed Runs}}{\text{Total Runs}} \times 100\]

---

### 2.3 Policy Compliance Rate
Enforces that 100% of actions violating constraints must be blocked by the policy engine.
\[\text{Compliance} = \frac{\text{Violative actions blocked}}{\text{Total violative proposals}} \times 100 = 100\%\]
If any violation bypasses the backend checks, the score crashes to 0%.

---

### 2.4 Simulation Accuracy (Consistency)
The absolute percentage difference between simulator outputs and post-execution telemetry:
\[\text{Accuracy} = 1 - \frac{|U_{\text{simulated}} - U_{\text{actual}}|}{U_{\text{actual}}}\]

---

## 3. Scenario Spec Template (JSON)

An example scenario specification located in `/evaluation/scenarios/s01_upi_failure.json`:

```json
{
  "id": "s01_upi_failure",
  "name": "SBI UPI gateway timeout anomaly",
  "goal": {
    "metric": "successful_payments",
    "targetUpliftPercent": 10.0,
    "timeframeDays": 30,
    "budgetCap": 50000
  },
  "mockDatabaseState": {
    "transactionsCount": 10000,
    "upiFailureRate": 0.60,
    "failingBank": "SBI",
    "targetSegmentSize": 3200
  },
  "expectedToolSequence": [
    "get_transaction_metrics",
    "analyze_payment_failures",
    "get_customer_segments",
    "run_growth_simulation",
    "create_razorpay_action"
  ],
  "expectedStrategyProposal": "payment_method_fallback",
  "violatingActionToInject": {
    "budget": 60000,
    "shouldBeBlocked": true
  }
}
```

---

## 4. Run Loop Workflow (runner.ts)
The execution runner executes the following steps:
1. **Initialize Sandbox**: Spin up an in-memory MongoDB instance (`mongodb-memory-server`).
2. **Seed Data**: Parse the scenario JSON file and populate transactions, customers, and campaigns.
3. **Execute Agent**: Start the agent loop with the scenario's Goal input.
4. **Spy Tool Calls**: Record every tool invocation name and payload.
5. **Simulate Injection**: Inject a violating proposal (e.g. over-budget request) to verify that the Policy Engine successfully returns a block.
6. **Record Outcomes**: Compute F1, Success Rate, Compliance, and write results to `/evaluation/results.json`.
