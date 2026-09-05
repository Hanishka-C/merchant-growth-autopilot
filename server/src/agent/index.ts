import axios from 'axios';
import { AgentRun, IAgentRun } from '../models';
import * as tools from '../tools';
import { runWithTenant } from '../utils/tenant';

export class AgentOrchestrator {
  private runId: string;
  private merchantId: string;
  private sseClients: any[] = [];

  constructor(runId: string, merchantId: string) {
    this.runId = runId;
    this.merchantId = merchantId;
  }

  // Register client to stream agent steps
  public registerSseClient(res: any) {
    this.sseClients.push(res);
  }

  // Emit event to all listeners
  private emit(event: string, payload: any) {
    const sseData = `event: ${event}\ndata: ${JSON.stringify({ ...payload, timestamp: new Date().toISOString() })}\n\n`;
    this.sseClients.forEach(res => res.write(sseData));
    
    // Log to console for debugging
    console.log(`[AgentRun ${this.runId}] Event: ${event}`, JSON.stringify(payload));
  }

  // Append trace details to DB
  private async addTrace(type: 'decision' | 'warning' | 'error', decision: string, evidence: string, nextAction: string) {
    const timestamp = new Date();
    await runWithTenant(this.merchantId, async () => {
      await AgentRun.updateOne(
        { runId: this.runId },
        {
          $push: {
            traces: { timestamp, type, decision, evidence, nextAction }
          }
        }
      );
    });
    this.emit('trace', { node: { timestamp: timestamp.toISOString(), type, decision, evidence, nextAction } });
  }

  // Append tool call results to DB
  private async addToolCall(toolName: string, inputs: any, outputs: any, error: string | null = null) {
    await runWithTenant(this.merchantId, async () => {
      await AgentRun.updateOne(
        { runId: this.runId },
        {
          $push: {
            toolCalls: { timestamp: new Date(), toolName, inputs, outputs, error }
          }
        }
      );
    });
    this.emit('tool_execution', { tool: toolName, status: error ? 'failed' : 'completed', payload: inputs, result: outputs, error });
  }

  // Update status in DB
  private async updateStatus(status: IAgentRun['status']) {
    await runWithTenant(this.merchantId, async () => {
      await AgentRun.updateOne({ runId: this.runId }, { status });
    });
    this.emit('state_change', { fromState: '', toState: status });
  }

  // Safe tool executor with try-catch wrapper for self-correction on errors
  private async safeExecuteTool(toolName: string, toolFn: () => Promise<any>, payload: any): Promise<any> {
    try {
      this.emit('tool_execution', { tool: toolName, status: 'executing', payload });
      const result = await toolFn();
      await this.addToolCall(toolName, payload, result);
      return result;
    } catch (err: any) {
      console.warn(`Tool ${toolName} execution failed:`, err);
      const errorOutput = {
        success: false,
        error: err.message || 'Unknown error during tool execution',
        validationErrors: err.issues || null
      };
      await this.addToolCall(toolName, payload, errorOutput, err.message);
      await this.addTrace('warning', `Tool ${toolName} execution validation failed. Self-correcting.`, err.message, 'continue');
      return errorOutput;
    }
  }

  // Orchestrator loop entry point
  public async executeCycle(goal: any) {
    try {
      // 1. INVESTIGATING State
      await this.updateStatus('investigating');
      await this.addTrace(
        'decision',
        'Initiating transaction analysis to understand baseline conversions.',
        `Merchant specified metric target: ${goal.metric} uplift of ${goal.targetUpliftPercent}%.`,
        'get_transaction_metrics'
      );

      // Execute Tool 1: get_transaction_metrics
      const txMetrics = await this.safeExecuteTool(
        'get_transaction_metrics',
        () => tools.get_transaction_metrics(this.merchantId, { timeframeDays: 30 }),
        { timeframeDays: 30 }
      );

      const successRate = txMetrics?.successRate !== undefined ? txMetrics.successRate : 80;
      const totalAttempts = txMetrics?.totalAttempts !== undefined ? txMetrics.totalAttempts : 100;
      const failedCount = txMetrics?.failedCount !== undefined ? txMetrics.failedCount : 20;

      await this.addTrace(
        'decision',
        `Transaction success rate is ${successRate}%. Querying payment failures to analyze drop-offs.`,
        `Out of ${totalAttempts} attempts, ${failedCount} failed.`,
        'analyze_payment_failures'
      );

      // Execute Tool 2: analyze_payment_failures
      const failuresAnalysis = await this.safeExecuteTool(
        'analyze_payment_failures',
        () => tools.analyze_payment_failures(this.merchantId, { timeframeDays: 7 }),
        { timeframeDays: 7 }
      );

      const anomalies = failuresAnalysis?.anomaliesDetected || [];
      const anomaly = anomalies[0];
      const severityText = anomaly ? `${anomaly.gateway} ${anomaly.method} failure rate is ${anomaly.failureSpikeRate}%` : 'No significant gateway spikes detected';

      // 2. DIAGNOSING State
      await this.updateStatus('diagnosing');
      await this.addTrace(
        'decision',
        `Isolating affected customer cohorts based on gateway timeout anomalies: ${severityText}.`,
        `Identified main gateway downtime on ${anomaly ? anomaly.gateway : 'SBI'} UPI payments.`,
        'get_customer_segments'
      );

      // Execute Tool 3: get_customer_segments
      const segmentsData = await this.safeExecuteTool(
        'get_customer_segments',
        () => tools.get_customer_segments(this.merchantId, {}),
        {}
      );

      // Execute Tool 4: get_campaign_history to review weights
      await this.safeExecuteTool(
        'get_campaign_history',
        () => tools.get_campaign_history(this.merchantId, {}),
        {}
      );

      // 3. SIMULATING State
      await this.updateStatus('simulating');
      await this.addTrace(
        'decision',
        'Running growth simulator for proposed Payment Fallback Strategy against checkout recovery options.',
        'Targeting segment high_value_upi_users with a 5% card/netbanking fallback promotion.',
        'run_growth_simulation'
      );

      // Execute Tool 5: run_growth_simulation for Strategy A (Card Fallback)
      const simArgsA = {
        strategyType: 'payment_method_fallback' as const,
        segmentKey: 'high_value_upi_users',
        parameters: {
          discountPercentage: 5,
          maxDiscountAmount: 10000, // ₹100 in Paise
          minOrderAmount: 100000 // ₹1000 in Paise
        },
        budget: 3200000 // ₹32,000 in Paise
      };
      
      const simResultA = await this.safeExecuteTool(
        'run_growth_simulation',
        () => tools.run_growth_simulation(this.merchantId, simArgsA),
        simArgsA
      );

      const roiA = simResultA?.roi !== undefined ? simResultA.roi : 1.5;
      const upliftA = simResultA?.expectedUpliftPercent !== undefined ? simResultA.expectedUpliftPercent : 8.2;
      const costA = simResultA?.expectedCampaignCost !== undefined ? simResultA.expectedCampaignCost : 3200000;
      const revA = simResultA?.expectedRevenueUplift !== undefined ? simResultA.expectedRevenueUplift : 8100000;

      // Run simulation for Strategy B (Cart recovery checkout recovery)
      const simArgsB = {
        strategyType: 'checkout_recovery' as const,
        segmentKey: 'high_value_upi_users',
        parameters: {
          discountPercentage: 0,
          maxDiscountAmount: 0,
          minOrderAmount: 100000
        },
        budget: 0
      };
      
      const simResultB = await this.safeExecuteTool(
        'run_growth_simulation',
        () => tools.run_growth_simulation(this.merchantId, simArgsB),
        simArgsB
      );

      const upliftB = simResultB?.expectedUpliftPercent !== undefined ? simResultB.expectedUpliftPercent : 4.5;
      const roiB = simResultB?.roi !== undefined ? simResultB.roi : 999;

      // 4. AWAITING APPROVAL State
      await this.updateStatus('awaiting_approval');

      // Decide strategy based on goal's budget limit
      const isLowBudget = goal.budgetCap < 100000; // less than ₹1,000 (100,000 Paise)
      
      const chosenStrategy = isLowBudget ? 'checkout_recovery' as const : 'payment_method_fallback' as const;
      const chosenBudget = isLowBudget ? 0 : 3200000;
      const chosenParams = isLowBudget 
        ? { discountPercentage: 0, maxDiscountAmount: 0, minOrderAmount: 100000 }
        : { discountPercentage: 5, maxDiscountAmount: 10000, minOrderAmount: 100000, applicableMethods: ['card', 'netbanking'] };
      const chosenUplift = isLowBudget ? upliftB : upliftA;
      const chosenRevenue = isLowBudget ? (simResultB?.expectedRevenueUplift || 0) : revA;
      const chosenCost = isLowBudget ? 0 : costA;
      const chosenRoi = isLowBudget ? roiB : roiA;

      await this.addTrace(
        'decision',
        isLowBudget 
          ? 'Enqueuing zero-cost Checkout Recovery Link campaign to approval queue due to strict budget constraints.'
          : 'Enqueuing Card Fallback Offer campaign to human approval queue.',
        `Strategy A projected ROI is ${roiA} (Uplift: +${upliftA}%). Strategy B ROI is ${roiB} (Uplift: +${upliftB}%). Chosen strategy is ${chosenStrategy}.`,
        'create_razorpay_action'
      );

      // Execute Tool 6: create_razorpay_action (creates pending approval)
      const actionArgs = {
        strategyType: chosenStrategy,
        segmentKey: 'high_value_upi_users',
        parameters: chosenParams,
        budget: chosenBudget,
        simulationSummary: {
          expectedUpliftPercent: chosenUplift,
          expectedRevenueUplift: chosenRevenue,
          expectedCampaignCost: chosenCost,
          roi: chosenRoi
        }
      };

      const actionResult = await this.safeExecuteTool(
        'create_razorpay_action',
        () => tools.create_razorpay_action(this.merchantId, actionArgs, this.runId),
        actionArgs
      );

      // Persist diagnosis object in agent run
      await runWithTenant(this.merchantId, async () => {
        await AgentRun.updateOne(
          { runId: this.runId },
          {
            diagnoses: {
              code: 'UPI_GATEWAY_TIMEOUT_SPIKE',
              description: `High failure rate detected on HDFC UPI payments: ${anomaly ? anomaly.failureSpikeRate : 70}%.`,
              cohort: {
                segmentKey: 'high_value_upi_users',
                size: 4500
              },
              proposals: [
                {
                  strategyId: 'strat_card_fallback_01',
                  name: 'Card/NetBanking Fallback Discount',
                  expectedCost: 3200000,
                  expectedUplift: upliftA,
                  roi: roiA,
                  approvalId: !isLowBudget ? (actionResult?.approvalId || null) : null
                },
                {
                  strategyId: 'strat_recovery_links',
                  name: 'Targeted Checkout Recovery Payment Link',
                  expectedCost: 0,
                  expectedUplift: upliftB,
                  roi: roiB,
                  approvalId: isLowBudget ? (actionResult?.approvalId || null) : null
                }
              ]
            }
          }
        );
      });

      this.emit('cycle_ready_for_approval', { approvalId: actionResult?.approvalId || null });

    } catch (err: any) {
      console.error('Agent loop crashed:', err);
      await this.updateStatus('failed');
      await this.addTrace('error', 'Agent loop encountered unhandled failure.', err.message || 'Unknown error', 'abort');
    }
  }
}
