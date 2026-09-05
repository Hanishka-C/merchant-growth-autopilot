"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const tenant_1 = require("./utils/tenant");
const models_1 = require("./models");
const agent_1 = require("./agent");
const razorpay_1 = require("./razorpay");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/merchant_growth';
const JWT_SECRET = process.env.JWT_SECRET || 'jwt_secret_dev';
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Active Agent Orchestrators cache to stream events
const activeOrchestrators = {};
// 1. Tenant Context Middleware
app.use((req, res, next) => {
    // Pull tenant from Header or JWT token
    let merchantId = req.headers['x-merchant-id'];
    if (req.headers.authorization) {
        try {
            const token = req.headers.authorization.split(' ')[1];
            const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
            merchantId = decoded.merchantId;
        }
        catch (err) {
            // Allow it to fall back to header for easy manual test runs
        }
    }
    // Fallback to demo merchant ID for easy testing
    if (!merchantId) {
        merchantId = 'mer_673e51240a1b';
    }
    // Bind tenant to local storage
    tenant_1.tenantStore.run(merchantId, () => {
        req.merchantId = merchantId;
        next();
    });
});
// Mock Auth Endpoint
app.post('/api/auth/login', async (req, res) => {
    const { email } = req.body;
    const merchant = await models_1.Merchant.findOne({ email });
    if (!merchant) {
        return res.status(401).json({ error: 'Merchant not found.' });
    }
    const token = jsonwebtoken_1.default.sign({ merchantId: merchant.merchantId, email: merchant.email }, JWT_SECRET);
    res.json({ token, merchantId: merchant.merchantId, businessName: merchant.businessName });
});
app.post('/api/goals', async (req, res) => {
    const { metric, targetUpliftPercent, timeframeDays } = req.body;
    const budgetCap = req.body.budgetCap !== undefined ? Number(req.body.budgetCap) : undefined;
    const merchantId = req.merchantId;
    if (metric === undefined || targetUpliftPercent === undefined || timeframeDays === undefined || budgetCap === undefined) {
        return res.status(400).json({ error: 'Missing metric, target, timeframe, or budget cap.' });
    }
    const runId = `run_${Math.random().toString(36).substr(2, 9)}`;
    // Create database entry for Agent Run
    await models_1.AgentRun.create({
        runId,
        merchantId,
        goal: { metric, targetUpliftPercent, timeframeDays, budgetCap },
        status: 'investigating',
        traces: [],
        toolCalls: []
    });
    // Spawn and run orchestrator asynchronously
    const orchestrator = new agent_1.AgentOrchestrator(runId, merchantId);
    activeOrchestrators[runId] = orchestrator;
    // Fire and forget control loop execution
    orchestrator.executeCycle({ metric, targetUpliftPercent, timeframeDays, budgetCap });
    res.status(202).json({ success: true, runId });
});
// 3. SSE Endpoint: Stream traces
app.get('/api/runs/:runId/stream', (req, res) => {
    const { runId } = req.params;
    const orchestrator = activeOrchestrators[runId];
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (!orchestrator) {
        // If agent run is finished, stream what is stored in DB
        models_1.AgentRun.findOne({ runId }).then((run) => {
            if (run) {
                run.traces.forEach((t) => {
                    res.write(`event: trace\ndata: ${JSON.stringify({ node: t })}\n\n`);
                });
                res.write(`event: state_change\ndata: ${JSON.stringify({ toState: run.status })}\n\n`);
            }
            res.end();
        });
        return;
    }
    orchestrator.registerSseClient(res);
    req.on('close', () => {
        // client disconnected
    });
});
// 4. GET Endpoint: Retrieve Strategy proposals
app.get('/api/runs/:runId/strategies', async (req, res) => {
    const { runId } = req.params;
    const run = await models_1.AgentRun.findOne({ runId });
    if (!run) {
        return res.status(404).json({ error: 'Agent run not found.' });
    }
    res.json({
        runId,
        diagnoses: run.diagnoses
    });
});
// 5. REST Route: Submit human approval
app.post('/api/approvals/:approvalId', async (req, res) => {
    const { approvalId } = req.params;
    const { status } = req.body; // "approved" or "rejected"
    const merchantId = req.merchantId;
    const approval = await models_1.Approval.findOne({ approvalId, merchantId });
    if (!approval) {
        return res.status(404).json({ error: 'Approval record not found.' });
    }
    if (approval.status !== 'pending') {
        return res.status(400).json({ error: `Approval already resolved as ${approval.status}.` });
    }
    approval.status = status;
    approval.resolvedAt = new Date();
    await approval.save();
    if (status === 'rejected') {
        await models_1.AgentRun.updateOne({ runId: approval.runId }, { status: 'failed' });
        return res.json({ success: true, message: 'Proposal rejected by user.' });
    }
    // 6. Action Execution (Approved)
    await models_1.AgentRun.updateOne({ runId: approval.runId }, { status: 'executing' });
    const payload = approval.actionDetails.payload;
    // Initialize Razorpay client wrapper
    const rzp = new razorpay_1.RazorpayClientWrapper();
    // Create Offer in sandbox
    const offer = await rzp.createOffer({
        name: 'AutoFallback Incentive Campaign',
        discountPercentage: payload.parameters.discountPercentage,
        maxDiscountAmount: payload.parameters.maxDiscountAmount,
        minOrderAmount: payload.parameters.minOrderAmount,
        applicableMethods: payload.parameters.applicableMethods || ['card']
    });
    // Create Campaign in local database
    const campaignId = `camp_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + 30);
    await models_1.Campaign.create({
        campaignId,
        merchantId,
        name: 'UPI Fallback Reward Offers',
        status: 'active',
        type: payload.strategyType,
        razorpayOfferId: offer.id,
        parameters: payload.parameters,
        segmentKey: payload.segmentKey,
        budgetCap: payload.budget,
        amountSpent: 0,
        startedAt: now,
        endsAt
    });
    await models_1.AgentRun.updateOne({ runId: approval.runId }, { status: 'completed' });
    // 7. Adapt Strategy Weights after simulated duration (Outcome simulation)
    // To simulate closed-loop outcomes on the buildathon demo screen immediately,
    // we trigger a simulated monitoring outcome 3 seconds after campaign creation.
    setTimeout(async () => {
        await tenant_1.tenantStore.run(merchantId, async () => {
            const predictedUplift = approval.simulationSummary.expectedUpliftPercent / 100;
            // Simulate outcome: target conversion achieves 7.5% uplift (predicted 8.2%)
            const actualUplift = 0.075;
            const error = Math.abs(actualUplift - predictedUplift) / Math.max(predictedUplift, 0.01);
            // Decay weight: weight_(t+1) = weight_t * exp(-0.5 * error)
            const prevMemory = await models_1.StrategyMemory.findOne({
                strategyType: payload.strategyType,
                segmentKey: payload.segmentKey
            });
            const currentWeight = prevMemory ? prevMemory.weightModifier : 1.0;
            const updatedWeight = Number((currentWeight * Math.exp(-0.5 * error)).toFixed(3));
            await models_1.StrategyMemory.create({
                merchantId,
                strategyType: payload.strategyType,
                segmentKey: payload.segmentKey,
                contextFeatures: {
                    baselineConversion: 0.841,
                    averageOrderValue: 120000
                },
                predictedUplift: predictedUplift,
                actualUplift: actualUplift,
                predictionError: error,
                cost: 3150000,
                roi: 1.48,
                weightModifier: updatedWeight
            });
            console.log(`[Adaptation] Closed-loop weight adjustment completed for ${payload.strategyType}. New Weight: ${updatedWeight}`);
        });
    }, 3000);
    res.json({
        success: true,
        approvalId,
        campaignId,
        offerId: offer.id
    });
});
// 8. REST Route: Fetch active campaigns & Live Telemetry
app.get('/api/monitoring', async (req, res) => {
    const merchantId = req.merchantId;
    const campaign = await models_1.Campaign.findOne({ merchantId, status: 'active' });
    if (!campaign) {
        return res.json({ active: false });
    }
    // Calculate live mock outcomes based on database
    res.json({
        active: true,
        campaignId: campaign.campaignId,
        metrics: {
            baselineConversion: 84.1,
            predictedConversion: 91.3,
            actualConversion: 89.8,
            predictionError: -1.5,
            predictedRevenue: 81000,
            actualRevenue: 76500,
            spendLimit: campaign.budgetCap / 100,
            actualSpend: 31500,
            roi: 1.48
        },
        historicalSeries: [
            { timestamp: '09:00', predicted: 84.1, actual: 84.1 },
            { timestamp: '10:00', predicted: 91.3, actual: 89.8 }
        ]
    });
});
// 9. REST Route: Fetch Strategy Memory log
app.get('/api/learning/memory', async (req, res) => {
    const memories = await models_1.StrategyMemory.find().sort({ recordedAt: -1 });
    res.json(memories);
});
// 10. REST Route: Fetch Evaluation Metrics
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
app.get('/api/evaluation/metrics', (req, res) => {
    const resultsPath = path_1.default.join(__dirname, '..', '..', 'evaluation', 'results.json');
    if (fs_1.default.existsSync(resultsPath)) {
        const raw = fs_1.default.readFileSync(resultsPath, 'utf-8');
        res.json(JSON.parse(raw));
    }
    else {
        res.json({
            metrics: {
                scenariosRun: 0,
                taskSuccessRate: 0,
                policyComplianceRate: 100,
                toolSelectionF1: 0,
                failureRecoveryRate: 0,
                adaptationScore: 0
            },
            runs: []
        });
    }
});
// Mongoose connection & server initiation
mongoose_1.default.connect(MONGODB_URI)
    .then(() => {
    console.log('Connected to MongoDB database.');
    app.listen(PORT, () => {
        console.log(`Express server running on http://localhost:${PORT}`);
    });
})
    .catch((err) => {
    console.error('MongoDB database connection error:', err);
});
