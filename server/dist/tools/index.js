"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetActionPerformanceSchema = exports.CreateRazorpayActionSchema = exports.RunGrowthSimulationSchema = exports.GetCampaignHistorySchema = exports.GetCustomerSegmentsSchema = exports.AnalyzePaymentFailuresSchema = exports.GetTransactionMetricsSchema = void 0;
exports.get_transaction_metrics = get_transaction_metrics;
exports.analyze_payment_failures = analyze_payment_failures;
exports.get_customer_segments = get_customer_segments;
exports.get_campaign_history = get_campaign_history;
exports.run_growth_simulation = run_growth_simulation;
exports.create_razorpay_action = create_razorpay_action;
exports.get_action_performance = get_action_performance;
const models_1 = require("../models");
const simulator_1 = require("../simulator");
const zod_1 = require("zod");
// Define execution timeout wrapper helper
async function runWithTimeout(promise, timeoutMs = 3000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: Execution exceeded ${timeoutMs}ms`)), timeoutMs))
    ]);
}
// 1. Tool 1: get_transaction_metrics
exports.GetTransactionMetricsSchema = zod_1.z.object({
    timeframeDays: zod_1.z.number().min(1).max(90).default(30),
    method: zod_1.z.enum(['upi', 'card', 'netbanking', 'wallet']).optional()
});
async function get_transaction_metrics(merchantId, args) {
    return runWithTimeout((async () => {
        const validated = exports.GetTransactionMetricsSchema.parse(args);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - validated.timeframeDays);
        const query = {
            merchantId,
            timestamp: { $gte: startDate }
        };
        if (validated.method) {
            query.method = validated.method;
        }
        const txs = await models_1.Transaction.find(query);
        const totalAttempts = txs.length;
        const successCount = txs.filter(t => t.status === 'captured').length;
        const failedCount = totalAttempts - successCount;
        const successRate = totalAttempts > 0 ? Number(((successCount / totalAttempts) * 100).toFixed(2)) : 0;
        const successfulTxs = txs.filter(t => t.status === 'captured');
        const totalRevenue = successfulTxs.reduce((sum, t) => sum + t.amount, 0);
        const averageOrderValue = successfulTxs.length > 0 ? Math.round(totalRevenue / successfulTxs.length) : 0;
        return {
            totalAttempts,
            successCount,
            failedCount,
            successRate,
            averageOrderValue,
            totalRevenue
        };
    })());
}
// 2. Tool 2: analyze_payment_failures
exports.AnalyzePaymentFailuresSchema = zod_1.z.object({
    timeframeDays: zod_1.z.number().min(1).max(30).default(7)
});
async function analyze_payment_failures(merchantId, args) {
    return runWithTimeout((async () => {
        const validated = exports.AnalyzePaymentFailuresSchema.parse(args);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - validated.timeframeDays);
        const txs = await models_1.Transaction.find({
            merchantId,
            timestamp: { $gte: startDate }
        });
        const failedTxs = txs.filter(t => t.status === 'failed');
        const totalFailures = failedTxs.length;
        // Aggregate failures by method + bank + errorCode
        const failureGroups = {};
        failedTxs.forEach((t) => {
            const key = `${t.method}_${t.bank || 'none'}_${t.errorCode || 'UNKNOWN'}`;
            if (!failureGroups[key]) {
                failureGroups[key] = {
                    method: t.method,
                    bank: t.bank,
                    errorCode: t.errorCode || 'UNKNOWN',
                    errorDescription: t.errorDescription || 'Unknown failure',
                    count: 0
                };
            }
            failureGroups[key].count++;
        });
        const failuresList = Object.values(failureGroups)
            .map(group => ({
            ...group,
            failureRate: totalFailures > 0 ? Number(((group.count / totalFailures) * 100).toFixed(2)) : 0
        }))
            .sort((a, b) => b.count - a.count);
        // Dynamic anomaly detection (e.g. UPI failures spikes)
        const anomaliesDetected = [];
        const upiTxs = txs.filter(t => t.method === 'upi');
        const upiAttempts = upiTxs.length;
        const upiFailed = upiTxs.filter(t => t.status === 'failed');
        // Group UPI fails by bank
        const upiFailsByBank = {};
        upiTxs.forEach((t) => {
            const bank = t.bank || 'Unknown';
            if (!upiFailsByBank[bank]) {
                upiFailsByBank[bank] = { failed: 0, total: 0 };
            }
            upiFailsByBank[bank].total++;
            if (t.status === 'failed') {
                upiFailsByBank[bank].failed++;
            }
        });
        for (const [bank, stats] of Object.entries(upiFailsByBank)) {
            const bankFailureRate = stats.total > 0 ? (stats.failed / stats.total) : 0;
            if (stats.total >= 10 && bankFailureRate > 0.45) {
                anomaliesDetected.push({
                    gateway: bank,
                    method: 'upi',
                    failureSpikeRate: Number((bankFailureRate * 100).toFixed(2)),
                    severity: bankFailureRate > 0.6 ? 'high' : 'medium'
                });
            }
        }
        return {
            failures: failuresList,
            anomaliesDetected
        };
    })());
}
// 3. Tool 3: get_customer_segments
exports.GetCustomerSegmentsSchema = zod_1.z.object({});
async function get_customer_segments(merchantId, args) {
    return runWithTimeout((async () => {
        // Standard static segments seeded
        const customers = await models_1.Customer.find({ merchantId });
        // Group segments
        const segmentCounts = {
            high_value_upi_users: { size: 0, totalAmount: 0, successTx: 0, attemptsTx: 0 },
            returning_customers: { size: 0, totalAmount: 0, successTx: 0, attemptsTx: 0 }
        };
        customers.forEach(cust => {
            cust.segments.forEach(seg => {
                if (segmentCounts[seg] !== undefined) {
                    segmentCounts[seg].size++;
                    const txCount = cust.successfulTxCount > 0 ? cust.successfulTxCount : 1;
                    segmentCounts[seg].totalAmount += (cust.aov * txCount);
                    segmentCounts[seg].successTx += txCount;
                    // approximate attempts
                    segmentCounts[seg].attemptsTx += Math.round(txCount / 0.85);
                }
            });
        });
        const segmentsList = [
            {
                segmentKey: 'high_value_upi_users',
                name: 'High-Value UPI Users',
                size: 4500, // benchmark cohort size
                averageOrderValue: segmentCounts.high_value_upi_users.successTx > 0
                    ? Math.round(segmentCounts.high_value_upi_users.totalAmount / segmentCounts.high_value_upi_users.successTx)
                    : 120000,
                baselineConversionRate: 84.1
            },
            {
                segmentKey: 'returning_customers',
                name: 'Returning Customers',
                size: 8000, // benchmark cohort size
                averageOrderValue: segmentCounts.returning_customers.successTx > 0
                    ? Math.round(segmentCounts.returning_customers.totalAmount / segmentCounts.returning_customers.successTx)
                    : 85000,
                baselineConversionRate: 78.2
            }
        ];
        return {
            segments: segmentsList
        };
    })());
}
// 4. Tool 4: get_campaign_history
exports.GetCampaignHistorySchema = zod_1.z.object({
    strategyType: zod_1.z.enum(['payment_method_fallback', 'cart_value_boost', 'checkout_recovery']).optional()
});
async function get_campaign_history(merchantId, args) {
    return runWithTimeout((async () => {
        const validated = exports.GetCampaignHistorySchema.parse(args);
        const filter = { merchantId };
        if (validated.strategyType) {
            filter.type = validated.strategyType;
        }
        const campaigns = await models_1.Campaign.find(filter);
        return {
            campaigns: campaigns.map(c => ({
                campaignId: c.campaignId,
                name: c.name,
                strategyType: c.type,
                segmentKey: c.segmentKey,
                expectedUpliftPercent: c.parameters.discountPercentage || 5, // fallback representation
                actualUpliftPercent: c.status === 'completed' ? (c.parameters.discountPercentage ? c.parameters.discountPercentage - 0.5 : 4.5) : null,
                budget: c.budgetCap,
                spend: c.amountSpent,
                netRevenueUplift: c.status === 'completed' ? Math.round(c.amountSpent * 1.5) : null,
                roi: c.status === 'completed' ? 1.5 : null,
                status: c.status
            }))
        };
    })());
}
// 5. Tool 5: run_growth_simulation
exports.RunGrowthSimulationSchema = zod_1.z.object({
    strategyType: zod_1.z.enum(['payment_method_fallback', 'cart_value_boost', 'checkout_recovery']),
    segmentKey: zod_1.z.string(),
    parameters: zod_1.z.object({
        discountPercentage: zod_1.z.number().min(0).max(100).default(0),
        maxDiscountAmount: zod_1.z.number().min(0).default(0),
        minOrderAmount: zod_1.z.number().min(0).default(0),
        applicableMethods: zod_1.z.array(zod_1.z.string()).optional()
    }),
    budget: zod_1.z.number().min(0).default(0)
});
async function run_growth_simulation(merchantId, args) {
    return runWithTimeout((async () => {
        const validated = exports.RunGrowthSimulationSchema.parse(args);
        // Fetch segment context
        const segmentsData = await get_customer_segments(merchantId, {});
        const segment = segmentsData.segments.find(s => s.segmentKey === validated.segmentKey);
        if (!segment) {
            throw new Error(`Customer segment ${validated.segmentKey} not found.`);
        }
        // Set simulator variables
        let expectedUplift = 0.06; // default 6% base projection
        if (validated.strategyType === 'payment_method_fallback') {
            expectedUplift = 0.082; // standard fallback uplift
        }
        else if (validated.strategyType === 'cart_value_boost') {
            expectedUplift = 0.072;
        }
        else if (validated.strategyType === 'checkout_recovery') {
            expectedUplift = 0.045;
        }
        const simResult = (0, simulator_1.runSimulation)({
            segmentSize: segment.size,
            sampleSize: Math.max(200, Math.round(segment.size * 0.1)),
            baselineConversion: segment.baselineConversionRate / 100,
            averageOrderValue: segment.averageOrderValue,
            expectedUplift,
            discountPercentage: validated.parameters.discountPercentage,
            maxDiscountAmount: validated.parameters.maxDiscountAmount,
            minOrderAmount: validated.parameters.minOrderAmount,
            budgetCap: validated.budget
        });
        return simResult;
    })());
}
// 6. Tool 6: create_razorpay_action
exports.CreateRazorpayActionSchema = zod_1.z.object({
    strategyType: zod_1.z.enum(['payment_method_fallback', 'cart_value_boost', 'checkout_recovery']),
    segmentKey: zod_1.z.string(),
    parameters: zod_1.z.object({
        discountPercentage: zod_1.z.number().min(0).max(100).default(0),
        maxDiscountAmount: zod_1.z.number().min(0).default(0),
        minOrderAmount: zod_1.z.number().min(0).default(0),
        applicableMethods: zod_1.z.array(zod_1.z.string()).optional()
    }),
    budget: zod_1.z.number().min(0).default(0),
    simulationSummary: zod_1.z.object({
        expectedUpliftPercent: zod_1.z.number().min(0),
        expectedRevenueUplift: zod_1.z.number().min(0),
        expectedCampaignCost: zod_1.z.number().min(0),
        roi: zod_1.z.number().min(0)
    })
});
// Import Policy Engine inside handler to enforce rules
const policy_1 = require("../policy");
async function create_razorpay_action(merchantId, args, runId) {
    return runWithTimeout((async () => {
        const validated = exports.CreateRazorpayActionSchema.parse(args);
        // Fetch active goal budgetCap from DB
        const activeRun = await models_1.AgentRun.findOne({ runId });
        const dynamicBudgetLimit = activeRun?.goal.budgetCap !== undefined ? activeRun.goal.budgetCap : undefined;
        // Enforce Policy Engine
        const policyEngine = new policy_1.DeterministicPolicyEngine();
        const policyResult = policyEngine.evaluate({
            strategyType: validated.strategyType,
            segmentKey: validated.segmentKey,
            segmentSize: 1000, // mock placeholder for check
            budget: validated.budget,
            maxBudget: dynamicBudgetLimit,
            parameters: validated.parameters
        });
        // Generate approval document (pending)
        const approvalId = `app_${Math.random().toString(36).substr(2, 9)}`;
        await models_1.Approval.create({
            approvalId,
            merchantId,
            runId,
            status: 'pending',
            actionDetails: {
                type: 'razorpay_offer_creation',
                payload: validated
            },
            simulationSummary: {
                expectedUpliftPercent: validated.simulationSummary.expectedUpliftPercent,
                expectedRevenueUplift: validated.simulationSummary.expectedRevenueUplift,
                expectedCampaignCost: validated.simulationSummary.expectedCampaignCost,
                roi: validated.simulationSummary.roi,
                confidenceLowerBound: validated.simulationSummary.expectedUpliftPercent - 1.5,
                confidenceUpperBound: validated.simulationSummary.expectedUpliftPercent + 1.5
            },
            policyChecks: policyResult.rulesChecked
        });
        return {
            approvalId,
            status: 'pending',
            policyResult: {
                passed: policyResult.passed,
                violations: policyResult.violations
            }
        };
    })());
}
// 7. Tool 7: get_action_performance
exports.GetActionPerformanceSchema = zod_1.z.object({
    campaignId: zod_1.z.string()
});
async function get_action_performance(merchantId, args) {
    return runWithTimeout((async () => {
        const validated = exports.GetActionPerformanceSchema.parse(args);
        const campaign = await models_1.Campaign.findOne({ merchantId, campaignId: validated.campaignId });
        if (!campaign) {
            throw new Error(`Campaign ${validated.campaignId} not found.`);
        }
        // Dynamic stats aggregation based on transactions having campaignId as offerId
        const txs = await models_1.Transaction.find({ merchantId, offerId: validated.campaignId });
        const attempts = txs.length;
        const successes = txs.filter(t => t.status === 'captured').length;
        const failures = attempts - successes;
        const conversionRate = attempts > 0 ? Number(((successes / attempts) * 100).toFixed(2)) : 0;
        const revenueGenerated = txs.filter(t => t.status === 'captured').reduce((sum, t) => sum + t.amount, 0);
        return {
            campaignId: validated.campaignId,
            status: campaign.status,
            activeDays: 2,
            telemetry: {
                attempts,
                successes,
                failures,
                conversionRate,
                costIncurred: campaign.amountSpent,
                revenueGenerated
            }
        };
    })());
}
