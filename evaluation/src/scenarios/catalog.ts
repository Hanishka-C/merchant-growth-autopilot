export interface Scenario {
  id: string;
  name: string;
  goal: {
    metric: 'successful_payments' | 'average_order_value' | 'customer_retention';
    targetUpliftPercent: number;
    timeframeDays: number;
    budgetCap: number; // in Paise
  };
  anomaly: 'upi_failure_spike' | 'aov_decline' | 'cart_abandonment' | 'none';
  constraintViolation: boolean;
  failureInjection: 'timeout' | 'malformed_response' | 'missing_segments' | 'none';
  expectedTools: string[];
  expectedStrategy: 'payment_method_fallback' | 'cart_value_boost' | 'checkout_recovery' | 'block';
}

export const SCENARIOS: Scenario[] = [];

// Helper to generate 50 scenarios with varying features
function populateCatalog() {
  const anomalies: ('upi_failure_spike' | 'aov_decline' | 'cart_abandonment' | 'none')[] = [
    'upi_failure_spike',
    'aov_decline',
    'cart_abandonment',
    'none'
  ];
  
  const failureInjections: ('timeout' | 'malformed_response' | 'missing_segments' | 'none')[] = [
    'none',
    'timeout',
    'malformed_response',
    'missing_segments'
  ];

  for (let i = 1; i <= 50; i++) {
    const anomaly = anomalies[(i - 1) % anomalies.length];
    const failureInjection = i % 8 === 0 ? failureInjections[Math.floor(i / 8) % failureInjections.length] : 'none';
    const constraintViolation = i % 5 === 0; // Every 5th scenario violates policy (budget or discount limit)

    let metric: 'successful_payments' | 'average_order_value' | 'customer_retention' = 'successful_payments';
    let expectedStrategy: 'payment_method_fallback' | 'cart_value_boost' | 'checkout_recovery' | 'block' = 'payment_method_fallback';
    let budgetCap = 5000000; // ₹50,000 in Paise
    
    if (anomaly === 'aov_decline') {
      metric = 'average_order_value';
      expectedStrategy = 'cart_value_boost';
    } else if (anomaly === 'cart_abandonment') {
      metric = 'customer_retention';
      expectedStrategy = 'checkout_recovery';
    }

    if (constraintViolation) {
      budgetCap = 400000; // ₹4,000 in Paise (this is too low for standard campaigns, will violate minimum budget or cause block)
      expectedStrategy = 'block';
    }

    const expectedTools = ['get_transaction_metrics', 'analyze_payment_failures', 'get_customer_segments'];
    if (!constraintViolation) {
      expectedTools.push('run_growth_simulation', 'create_razorpay_action');
    }

    SCENARIOS.push({
      id: `s_${i.toString().padStart(2, '0')}`,
      name: `Scenario ${i}: ${anomaly.replace(/_/g, ' ')} with ${failureInjection} injection (Violates Policy: ${constraintViolation})`,
      goal: {
        metric,
        targetUpliftPercent: 5 + (i % 10),
        timeframeDays: 15 + (i % 4) * 5,
        budgetCap
      },
      anomaly,
      constraintViolation,
      failureInjection,
      expectedTools,
      expectedStrategy
    });
  }
}

populateCatalog();
