import { z } from 'zod';

export const SimulatorInputSchema = z.object({
  segmentSize: z.number().min(1),
  sampleSize: z.number().min(1), // N_s: historical count
  baselineConversion: z.number().min(0).max(1), // p_0
  averageOrderValue: z.number().min(1), // AOV in Paise
  expectedUplift: z.number().min(0).max(1), // delta p (uplift)
  discountPercentage: z.number().min(0).max(100).optional(),
  maxDiscountAmount: z.number().min(0).optional(), // in Paise
  minOrderAmount: z.number().min(0).optional(), // in Paise
  budgetCap: z.number().min(0) // in Paise
});

export const SimulatorOutputSchema = z.object({
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

export type SimulatorInput = z.infer<typeof SimulatorInputSchema>;
export type SimulatorOutput = z.infer<typeof SimulatorOutputSchema>;

export function runSimulation(input: SimulatorInput): SimulatorOutput {
  const {
    segmentSize,
    sampleSize,
    baselineConversion,
    averageOrderValue,
    expectedUplift,
    discountPercentage = 0,
    maxDiscountAmount = 0,
    budgetCap
  } = input;

  // 1. Calculate Expected Revenue Uplift: (S * delta_p) * AOV
  const expectedRevenueUplift = Math.round(segmentSize * expectedUplift * averageOrderValue);

  // 2. Calculate average unit discount: D = min(maxDiscountAmount, AOV * discountPercentage)
  let unitDiscount = 0;
  if (discountPercentage > 0) {
    const rawDiscount = Math.round(averageOrderValue * (discountPercentage / 100));
    unitDiscount = maxDiscountAmount > 0 ? Math.min(maxDiscountAmount, rawDiscount) : rawDiscount;
  }

  // 3. Expected Campaign Cost: [S * (p_0 + delta_p)] * Redemption_Rate * unitDiscount
  const redemptionRate = 0.8; // 80% redemption rate
  const redemptionCount = segmentSize * (baselineConversion + expectedUplift) * redemptionRate;
  const rawCampaignCost = Math.round(redemptionCount * unitDiscount);
  // Cost cannot exceed the budgetCap
  const expectedCampaignCost = Math.min(budgetCap, rawCampaignCost);

  // 4. Net Profit Impact = (Expected Revenue * Gross Margin) - Campaign Cost (Default gross margin 40%)
  const grossMargin = 0.4;
  const netProfitImpact = Math.round((expectedRevenueUplift * grossMargin) - expectedCampaignCost);

  // 5. ROI = NetProfitImpact / Cost
  const rawRoi = expectedCampaignCost > 0 ? Number((netProfitImpact / expectedCampaignCost).toFixed(2)) : 0;
  const roi = isFinite(rawRoi) && !isNaN(rawRoi) ? rawRoi : 0;

  // 6. Confidence Interval bounds for uplift: delta_p +/- 1.96 * SE * (1 + 100 / N_s)
  const p0 = baselineConversion;
  const standardError = Math.sqrt((p0 * (1 - p0)) / sampleSize);
  const samplePenalty = 1 + (100 / sampleSize);
  const marginOfError = 1.96 * standardError * samplePenalty;

  const expectedUpliftPercent = expectedUplift * 100;
  const rawLowerBound = Math.max(0, Number((expectedUpliftPercent - marginOfError * 100).toFixed(2)));
  const rawUpperBound = Number((expectedUpliftPercent + marginOfError * 100).toFixed(2));

  const lowerBound = isFinite(rawLowerBound) && !isNaN(rawLowerBound) ? rawLowerBound : 0;
  const upperBound = isFinite(rawUpperBound) && !isNaN(rawUpperBound) ? rawUpperBound : 0;

  // Risk classification
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  const uncertaintyRange = upperBound - lowerBound;
  if (uncertaintyRange > 5 || expectedCampaignCost > budgetCap * 0.8) {
    riskLevel = 'high';
  } else if (uncertaintyRange > 2 || expectedCampaignCost > budgetCap * 0.4) {
    riskLevel = 'medium';
  }

  return {
    expectedUpliftPercent: isFinite(expectedUpliftPercent) && !isNaN(expectedUpliftPercent) ? Number(expectedUpliftPercent.toFixed(2)) : 0,
    expectedRevenueUplift: isFinite(expectedRevenueUplift) && !isNaN(expectedRevenueUplift) ? expectedRevenueUplift : 0,
    expectedCampaignCost: isFinite(expectedCampaignCost) && !isNaN(expectedCampaignCost) ? expectedCampaignCost : 0,
    netProfitImpact: isFinite(netProfitImpact) && !isNaN(netProfitImpact) ? netProfitImpact : 0,
    roi,
    confidenceInterval: {
      lower: lowerBound,
      upper: upperBound
    },
    riskLevel
  };
}
