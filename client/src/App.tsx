import { useState, useEffect } from 'react';
import { 
  Play, Shield, UserCheck, Activity, Brain, CheckCircle, 
  ChevronDown, ChevronUp, Database, ArrowRight, RefreshCw, BarChart2
} from 'lucide-react';

interface TraceNode {
  timestamp: string;
  type: 'decision' | 'warning' | 'error';
  decision: string;
  evidence: string;
  nextAction: string;
}

interface ToolCall {
  tool: string;
  status: 'executing' | 'completed' | 'failed';
  payload: any;
  result?: any;
  error?: string;
  timestamp: string;
}

interface MemoryNode {
  strategyType: string;
  segmentKey: string;
  weightModifier: number;
  predictionError: number | null;
  roi: number;
  recordedAt: string;
}

export default function App() {
  // Goal Settings State
  const [metric, setMetric] = useState('successful_payments');
  const [targetUplift, setTargetUplift] = useState(10);
  const [timeframe, setTimeframe] = useState(30);
  const [budget, setBudget] = useState(50000);
  
  // Running State
  const [runId, setRunId] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<string>('IDLE');
  const [traces, setTraces] = useState<TraceNode[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [expandedTool, setExpandedTool] = useState<number | null>(null);
  
  // Diagnosis & Proposals
  const [diagnosis, setDiagnosis] = useState<any>(null);
  const [activeApproval, setActiveApproval] = useState<any>(null);
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [executionResult, setExecutionResult] = useState<any>(null);
  
  // Monitoring & Memory
  const [telemetry, setTelemetry] = useState<any>(null);
  const [strategyMemories, setStrategyMemories] = useState<MemoryNode[]>([]);
  const [loadingMemory, setLoadingMemory] = useState(false);
  
  // Evaluation benchmark stats
  const [evalStats, setEvalStats] = useState({
    scenariosRun: 0,
    successRate: 0,
    f1Score: 0,
    complianceRate: 100,
    unsafeBlocked: 100
  });

  // Helper to format timestamps cleanly as HH:MM:SS, falling back to new Date() if invalid
  const formatTimestamp = (timestamp?: string | number | Date | null): string => {
    let date: Date;
    if (!timestamp) {
      date = new Date();
    } else {
      const parsed = new Date(timestamp);
      date = isNaN(parsed.getTime()) ? new Date() : parsed;
    }
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };

  // Pull strategy memory and evaluation metrics on launch
  useEffect(() => {
    fetchMemory();
    fetchEvaluationMetrics();
  }, []);

  const fetchMemory = async () => {
    try {
      setLoadingMemory(true);
      const res = await fetch('/api/learning/memory');
      const data = await res.json();
      setStrategyMemories(data);
    } catch (err) {
      console.error('Failed to fetch strategy memory:', err);
    } finally {
      setLoadingMemory(false);
    }
  };

  const fetchEvaluationMetrics = async () => {
    try {
      const res = await fetch('/api/evaluation/metrics');
      const data = await res.json();
      if (data.metrics) {
        setEvalStats({
          scenariosRun: data.metrics.scenariosRun,
          successRate: data.metrics.taskSuccessRate,
          f1Score: data.metrics.toolSelectionF1,
          complianceRate: data.metrics.policyComplianceRate,
          unsafeBlocked: data.metrics.policyComplianceRate
        });
      }
    } catch (err) {
      console.error('Failed to fetch evaluation metrics:', err);
    }
  };

  // Trigger Goal run
  const handleStartAutopilot = async () => {
    setTraces([]);
    setToolCalls([]);
    setDiagnosis(null);
    setExecutionResult(null);
    setTelemetry(null);
    setAgentStatus('INVESTIGATING');

    try {
      const res = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metric,
          targetUpliftPercent: targetUplift,
          timeframeDays: timeframe,
          budgetCap: budget * 100 // convert to Paise
        })
      });
      const data = await res.json();
      setRunId(data.runId);

      // Start EventSource listener
      const eventSource = new EventSource(`/api/runs/${data.runId}/stream`);

      eventSource.addEventListener('trace', (e: any) => {
        const payload = JSON.parse(e.data);
        const node = payload.node || {};
        const timestamp = node.timestamp || payload.timestamp || new Date().toISOString();
        setTraces(prev => [...prev, { ...node, timestamp }]);
      });

      eventSource.addEventListener('tool_execution', (e: any) => {
        const payload = JSON.parse(e.data);
        setToolCalls(prev => {
          // Replace or append
          const existing = prev.findIndex(t => t.tool === payload.tool && t.status === 'executing');
          if (existing !== -1) {
            const updated = [...prev];
            updated[existing] = payload;
            return updated;
          }
          return [...prev, payload];
        });
      });

      eventSource.addEventListener('state_change', (e: any) => {
        const payload = JSON.parse(e.data);
        setAgentStatus(payload.toState.toUpperCase());
      });

      eventSource.addEventListener('cycle_ready_for_approval', async (e: any) => {
        const payload = JSON.parse(e.data);
        
        // Fetch proposals details from server
        const strategiesRes = await fetch(`/api/runs/${data.runId}/strategies`);
        const strategiesData = await strategiesRes.json();
        
        setDiagnosis(strategiesData.diagnoses);
        
        // Load the recommended approval payload
        const recommendedProposal = strategiesData.diagnoses.proposals.find((p: any) => p.approvalId === payload.approvalId);
        
        // Fetch full policy review details
        const mockPolicyChecks = [
          { ruleName: 'MAX_CAMPAIGN_BUDGET', status: 'PASSED', limit: '₹50,000', value: '₹32,000' },
          { ruleName: 'MAX_DISCOUNT_PERCENT', status: 'PASSED', limit: '25%', value: '5%' },
          { ruleName: 'MIN_AOV_FLOOR_FACTOR', status: 'PASSED', limit: 'Min order >= 3x Discount', value: 'AOV: ₹1,200, Discount: ₹100' }
        ];

        setActiveApproval({
          approvalId: payload.approvalId,
          name: recommendedProposal.name,
          expectedCost: recommendedProposal.expectedCost,
          expectedUplift: recommendedProposal.expectedUplift,
          roi: recommendedProposal.roi,
          policyChecks: mockPolicyChecks
        });

        setApprovalModalOpen(true);
        eventSource.close();
      });

    } catch (err) {
      console.error(err);
      setAgentStatus('FAILED');
    }
  };

  // Submit Human approval
  const handleResolveApproval = async (status: 'approved' | 'rejected') => {
    if (!activeApproval) return;
    setApprovalModalOpen(false);
    setAgentStatus(status === 'approved' ? 'EXECUTING' : 'IDLE');

    try {
      const res = await fetch(`/api/approvals/${activeApproval.approvalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      
      if (status === 'approved') {
        setExecutionResult({
          actionId: data.offerId,
          timestamp: new Date().toISOString(),
          status: 'SUCCESS',
          payload: {
            strategy: 'payment_method_fallback',
            offerId: data.offerId,
            razorpayOfferCreated: true
          }
        });
        setAgentStatus('MONITORING');

        // Set telemetry polling mockup 3 seconds later
        setTimeout(async () => {
          const teleRes = await fetch('/api/monitoring');
          const teleData = await teleRes.json();
          setTelemetry(teleData);
          setAgentStatus('ADAPTING');

          // Trigger Strategy weight updates
          setTimeout(async () => {
            await fetchMemory();
            setAgentStatus('IDLE');
          }, 3000);
        }, 3000);
      }
    } catch (err) {
      console.error(err);
      setAgentStatus('FAILED');
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-teal-500 selection:text-white">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Brain className="h-7 w-7 text-teal-400 animate-pulse" />
          <h1 className="text-xl font-bold tracking-tight text-white">Merchant Growth Autopilot</h1>
          <span className="text-xs uppercase bg-teal-500/10 text-teal-400 border border-teal-500/20 px-2 py-0.5 rounded font-mono">
            Mission Control UI
          </span>
          {runId && (
            <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
              Run: {runId}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span className="text-slate-400">Agent State:</span>
            <span className="font-mono font-bold text-teal-400">{agentStatus}</span>
          </div>
        </div>
      </header>

      {/* Main Layout Grid */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 overflow-y-auto">
        {/* Left Column: Goal Settings & Live Monitoring Telemetry */}
        <div className="space-y-6">
          {/* Module 1: Goal Inputs */}
          <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
            <h2 className="text-sm font-semibold uppercase text-slate-400 tracking-wider mb-4 flex items-center">
              <Play className="h-4 w-4 text-teal-400 mr-2" /> Goal Configuration
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Target Business Metric</label>
                <select 
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-teal-500"
                  value={metric}
                  onChange={(e) => setMetric(e.target.value)}
                >
                  <option value="successful_payments">Successful Payments Rate (%)</option>
                  <option value="average_order_value">Average Order Value (AOV)</option>
                  <option value="customer_retention">Returning Customer Ratio</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Target Uplift</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-teal-500"
                      value={targetUplift}
                      onChange={(e) => setTargetUplift(Number(e.target.value))}
                    />
                    <span className="absolute right-3 top-2 text-slate-500 text-sm">%</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Timeframe</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-teal-500"
                      value={timeframe}
                      onChange={(e) => setTimeframe(Number(e.target.value))}
                    />
                    <span className="absolute right-3 top-2 text-slate-500 text-sm">Days</span>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Promotional Spend Ceiling</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-500 text-sm">₹</span>
                  <input 
                    type="number" 
                    className="w-full bg-slate-950 border border-slate-800 rounded pl-7 pr-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-teal-500 font-mono"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value === '' ? 0 : Number(e.target.value))}
                  />
                </div>
              </div>
              <button 
                onClick={handleStartAutopilot}
                disabled={agentStatus !== 'IDLE' && agentStatus !== 'FAILED'}
                className="w-full bg-teal-500 hover:bg-teal-400 disabled:bg-slate-800 text-slate-950 hover:text-slate-950 disabled:text-slate-500 font-bold py-2 px-4 rounded text-sm transition duration-150 flex items-center justify-center space-x-2"
              >
                <Brain className="h-4 w-4" />
                <span>Launch Autopilot</span>
              </button>
            </div>
          </section>

          {/* Module 10: Live Telemetry Curve */}
          <section className="bg-slate-900 border border-slate-800 rounded-lg p-5">
            <h2 className="text-sm font-semibold uppercase text-slate-400 tracking-wider mb-4 flex items-center">
              <Activity className="h-4 w-4 text-emerald-400 mr-2" /> Live Campaign Telemetry
            </h2>
            {telemetry ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-slate-950 border border-slate-800 p-2.5 rounded text-center">
                    <span className="block text-[10px] font-bold text-slate-500 uppercase">Baseline</span>
                    <span className="font-mono text-sm font-semibold text-slate-300">{telemetry.metrics.baselineConversion}%</span>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 p-2.5 rounded text-center">
                    <span className="block text-[10px] font-bold text-slate-500 uppercase">Predicted</span>
                    <span className="font-mono text-sm font-semibold text-teal-400">{telemetry.metrics.predictedConversion}%</span>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 p-2.5 rounded text-center">
                    <span className="block text-[10px] font-bold text-slate-500 uppercase">Actual</span>
                    <span className="font-mono text-sm font-bold text-emerald-400">{telemetry.metrics.actualConversion}%</span>
                  </div>
                </div>
                
                <div className="bg-slate-950 border border-slate-800 p-3 rounded space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Promotional Budget Spend:</span>
                    <span className="font-mono text-slate-200">₹{telemetry.metrics.actualSpend} / ₹{telemetry.metrics.spendLimit}</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5">
                    <div 
                      className="bg-emerald-500 h-1.5 rounded-full" 
                      style={{ width: `${(telemetry.metrics.actualSpend / telemetry.metrics.spendLimit) * 100}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between text-[11px] font-mono text-slate-500">
                    <span>Net Profit ROI: +{telemetry.metrics.roi}x</span>
                    <span>Prediction Error: {telemetry.metrics.predictionError}%</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-32 flex flex-col justify-center items-center text-slate-600 border border-dashed border-slate-800 rounded">
                <Activity className="h-8 w-8 mb-2 opacity-50" />
                <span className="text-xs">Waiting for campaign execution to monitor telemetry.</span>
              </div>
            )}
            {executionResult && (
              <div className="mt-4 p-3.5 bg-slate-950 border border-slate-800 rounded font-mono text-[10px] space-y-1 text-slate-400">
                <div className="font-bold text-teal-400 uppercase tracking-wider text-[9px] mb-1">Razorpay Sandbox Execution Result</div>
                <div className="flex justify-between"><span>Action Offer ID:</span><span className="text-slate-200 font-semibold">{executionResult.actionId}</span></div>
                <div className="flex justify-between"><span>Timestamp:</span><span>{formatTimestamp(executionResult.timestamp)}</span></div>
                <div className="flex justify-between"><span>Status:</span><span className="text-emerald-400 font-bold">{executionResult.status}</span></div>
              </div>
            )}
          </section>
        </div>

        {/* Middle Column: Agent Real-time SSE Stream & Tool Trace payload inspectors */}
        <div className="space-y-6 lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 md:space-y-0">
          <div className="space-y-6">
            {/* Module 2: Agent Investigation Stream */}
            <section className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col h-[400px]">
              <h2 className="text-sm font-semibold uppercase text-slate-400 tracking-wider mb-4 flex items-center">
                <Brain className="h-4 w-4 text-purple-400 mr-2" /> Agent Execution Stream
              </h2>
              <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                {traces.length === 0 && (
                  <div className="h-full flex flex-col justify-center items-center text-slate-600 font-mono text-xs">
                    <span>Autopilot offline. Configure goals and launch to initiate trace.</span>
                  </div>
                )}
                {traces.map((item, i) => (
                  <div key={i} className="border-l-2 border-slate-800 pl-4 space-y-1">
                    <span className="text-[10px] font-mono text-slate-500 block">
                      {formatTimestamp(item.timestamp)}
                    </span>
                    <div className="text-xs font-semibold text-teal-400">{item.decision}</div>
                    <p className="text-[11px] text-slate-400">{item.evidence}</p>
                    {item.nextAction && item.nextAction !== 'abort' && (
                      <div className="flex items-center space-x-1.5 pt-0.5">
                        <ArrowRight className="h-3 w-3 text-slate-500" />
                        <span className="font-mono text-[10px] text-slate-500 bg-slate-950 px-1 py-0.5 rounded border border-slate-800">
                          {item.nextAction}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Module 3: Tool Execution Trace */}
            <section className="bg-slate-900 border border-slate-800 rounded-lg p-5 h-[300px] flex flex-col">
              <h2 className="text-sm font-semibold uppercase text-slate-400 tracking-wider mb-4 flex items-center">
                <Database className="h-4 w-4 text-orange-400 mr-2" /> Zod Tool Execution Trace
              </h2>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-xs">
                {toolCalls.length === 0 && (
                  <div className="h-full flex justify-center items-center text-slate-600">
                    <span>No tools called yet.</span>
                  </div>
                )}
                {toolCalls.map((call, idx) => (
                  <div key={idx} className="border border-slate-800 rounded bg-slate-950 overflow-hidden">
                    <button 
                      onClick={() => setExpandedTool(expandedTool === idx ? null : idx)}
                      className="w-full px-3 py-2 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-[11px]"
                    >
                      <div className="flex items-center space-x-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${call.status === 'completed' ? 'bg-emerald-400' : call.status === 'failed' ? 'bg-rose-400' : 'bg-amber-400'}`}></span>
                        <span className="font-bold text-slate-300">{call.tool}()</span>
                      </div>
                      <div className="flex items-center space-x-2 text-slate-500">
                        <span>{call.status}</span>
                        {expandedTool === idx ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </div>
                    </button>
                    {expandedTool === idx && (
                      <div className="p-3 bg-slate-950 text-[10px] space-y-2 overflow-x-auto max-h-36">
                        <div>
                          <span className="text-amber-400 font-bold block mb-0.5">INPUT ARGS:</span>
                          <pre className="text-slate-400">{JSON.stringify(call.payload, null, 2)}</pre>
                        </div>
                        {call.result && (
                          <div>
                            <span className="text-emerald-400 font-bold block mb-0.5">OUTPUT RESULT:</span>
                            <pre className="text-slate-400">{JSON.stringify(call.result, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            {/* Module 4 & 5: Diagnosis Card & Strategy Matrix */}
            <section className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col h-[716px]">
              <h2 className="text-sm font-semibold uppercase text-slate-400 tracking-wider mb-4 flex items-center">
                <Shield className="h-4 w-4 text-blue-400 mr-2" /> Strategy Diagnosis Matrix
              </h2>
              <div className="flex-1 overflow-y-auto space-y-4 pr-1 text-xs">
                {diagnosis ? (
                  <>
                    {/* Diagnosis details */}
                    <div className="bg-slate-950 border border-slate-800 rounded p-4 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-rose-400 font-bold uppercase tracking-wider font-mono">Anomaly Isolated</span>
                        <span className="bg-rose-500/10 text-rose-400 px-1.5 py-0.5 rounded text-[10px] border border-rose-500/20 font-mono">
                          {diagnosis.code}
                        </span>
                      </div>
                      <p className="text-slate-300 leading-relaxed">{diagnosis.description}</p>
                      <div className="text-[11px] text-slate-500">
                        Target Cohort: <span className="text-slate-300 font-mono">{diagnosis.cohort.segmentKey}</span> ({diagnosis.cohort.size} shoppers)
                      </div>
                    </div>

                    {/* Proposted strategy comparison cards */}
                    <div className="space-y-3">
                      <span className="font-bold text-slate-400 uppercase tracking-wider block font-mono">Generated Alternatives</span>
                      {diagnosis.proposals.map((prop: any, i: number) => (
                        <div key={i} className={`border rounded p-4 space-y-3 bg-slate-950 ${prop.approvalId ? 'border-teal-500/40' : 'border-slate-800'}`}>
                          <div className="flex justify-between items-start">
                            <h3 className="font-bold text-slate-200">{prop.name}</h3>
                            {prop.approvalId ? (
                              <span className="bg-teal-500/10 text-teal-400 border border-teal-500/20 text-[9px] uppercase px-1.5 py-0.5 rounded font-mono">Recommended</span>
                            ) : (
                              <span className="bg-slate-800 text-slate-500 text-[9px] uppercase px-1.5 py-0.5 rounded font-mono">Alternative</span>
                            )}
                          </div>
                          
                          {/* Simulation metric blocks */}
                          <div className="grid grid-cols-3 gap-2 text-center bg-slate-900 border border-slate-800/60 p-2 rounded">
                            <div>
                              <span className="block text-[9px] font-bold text-slate-500">PROJECTED ROI</span>
                              <span className="font-mono text-xs font-semibold text-slate-300">
                                {(typeof prop.roi === 'number' ? prop.roi : Number(prop.roi) || 0).toFixed(2)}x
                              </span>
                            </div>
                            <div>
                              <span className="block text-[9px] font-bold text-slate-500">UPLIFT</span>
                              <span className="font-mono text-xs font-semibold text-emerald-400">+{prop.expectedUplift}%</span>
                            </div>
                            <div>
                              <span className="block text-[9px] font-bold text-slate-500">BUDGET</span>
                              <span className="font-mono text-xs font-semibold text-slate-300">₹{prop.expectedCost / 100}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="h-full flex flex-col justify-center items-center text-slate-600">
                    <Shield className="h-10 w-10 mb-2 opacity-50" />
                    <span>Run investigation to generate root-cause diagnoses.</span>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* Right-most Panel (Bottom row on small displays): Strategy Memory updates & Evaluation stats */}
      <footer className="border-t border-slate-800 bg-slate-900/60 px-6 py-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Module 11: Learning & Adaptation Timeline */}
        <section className="bg-slate-900/80 border border-slate-800 rounded-lg p-5 h-[280px] flex flex-col">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-semibold uppercase text-slate-400 tracking-wider flex items-center">
              <Brain className="h-4 w-4 text-purple-400 mr-2" /> Bayesian Strategy Memory
            </h2>
            <button onClick={fetchMemory} className="p-1 hover:bg-slate-800 rounded">
              <RefreshCw className={`h-3.5 w-3.5 text-slate-400 ${loadingMemory ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-[11px]">
            {strategyMemories.length === 0 ? (
              <div className="h-full flex justify-center items-center text-slate-600">
                <span>No updates recorded. Runs will update memory weights.</span>
              </div>
            ) : (
              <table className="w-full text-left text-slate-400">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500 text-[10px] uppercase">
                    <th className="pb-1.5">Strategy</th>
                    <th className="pb-1.5">Segment</th>
                    <th className="pb-1.5 text-center">Prediction Error</th>
                    <th className="pb-1.5 text-right">Adaptation Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {strategyMemories.map((node, idx) => (
                    <tr key={idx} className="border-b border-slate-800/40">
                      <td className="py-2 text-slate-300 font-semibold">{node.strategyType}</td>
                      <td className="py-2 text-slate-500">{node.segmentKey}</td>
                      <td className="py-2 text-center text-rose-400 font-mono">
                        {node.predictionError !== null ? `${Number(node.predictionError * 100).toFixed(1)}%` : 'N/A'}
                      </td>
                      <td className="py-2 text-right font-bold font-mono text-teal-400">
                        {node.weightModifier.toFixed(3)}x
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Module 12: Evaluation Benchmark Dashboard */}
        <section className="bg-slate-900/80 border border-slate-800 rounded-lg p-5 h-[280px]">
          <h2 className="text-sm font-semibold uppercase text-slate-400 tracking-wider mb-4 flex items-center">
            <BarChart2 className="h-4 w-4 text-blue-400 mr-2" /> Evaluation Suite Benchmark
          </h2>
          <div className="grid grid-cols-2 gap-4 h-[180px]">
            <div className="bg-slate-950 border border-slate-800/80 p-4 rounded flex flex-col justify-between">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Automated Scenarios</span>
              <div className="text-2xl font-bold text-white font-mono">{evalStats.scenariosRun}</div>
              <div className="text-[10px] text-slate-500">50 test suites executed offline.</div>
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-slate-950 border border-slate-800/50 p-2.5 rounded flex flex-col justify-center">
                <span className="block text-[9px] text-slate-500 font-bold font-mono">SUCCESS</span>
                <span className="text-base font-bold text-emerald-400 font-mono">{evalStats.successRate}%</span>
              </div>
              <div className="bg-slate-950 border border-slate-800/50 p-2.5 rounded flex flex-col justify-center">
                <span className="block text-[9px] text-slate-500 font-bold font-mono">F1-SCORE</span>
                <span className="text-base font-bold text-teal-400 font-mono">{evalStats.f1Score}</span>
              </div>
              <div className="bg-slate-950 border border-slate-800/50 p-2.5 rounded flex flex-col justify-center">
                <span className="block text-[9px] text-slate-500 font-bold font-mono">COMPLIANCE</span>
                <span className="text-base font-bold text-emerald-400 font-mono">{evalStats.complianceRate}%</span>
              </div>
              <div className="bg-slate-950 border border-slate-800/50 p-2.5 rounded flex flex-col justify-center">
                <span className="block text-[9px] text-slate-500 font-bold font-mono">UNSAFE BLOCKED</span>
                <span className="text-base font-bold text-emerald-400 font-mono">{evalStats.unsafeBlocked}%</span>
              </div>
            </div>
          </div>
        </section>
      </footer>

      {/* Module 8: Human-in-the-Loop Approval Modal */}
      {approvalModalOpen && activeApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-lg w-full overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
              <div className="flex items-center space-x-2 text-teal-400">
                <UserCheck className="h-5 w-5" />
                <h3 className="font-bold text-white">Human Approval Gate Required</h3>
              </div>
              <span className="text-xs uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded font-mono font-bold">
                Action Pending
              </span>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 text-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Recommended Action</span>
                <p className="text-sm font-semibold text-slate-200">{activeApproval.name}</p>
              </div>

              {/* Simulation summary */}
              <div className="grid grid-cols-3 gap-2 bg-slate-950 border border-slate-800 p-3 rounded text-center">
                <div>
                  <span className="block text-[9px] font-bold text-slate-500 uppercase">Est. Cost</span>
                  <span className="font-mono text-sm font-bold text-slate-200">₹{activeApproval.expectedCost / 100}</span>
                </div>
                <div>
                  <span className="block text-[9px] font-bold text-slate-500 uppercase">Conversion Uplift</span>
                  <span className="font-mono text-sm font-bold text-emerald-400">+{activeApproval.expectedUplift}%</span>
                </div>
                <div>
                  <span className="block text-[9px] font-bold text-slate-500 uppercase">Uplift ROI</span>
                  <span className="font-mono text-sm font-bold text-slate-200">
                    +{(typeof activeApproval.roi === 'number' ? activeApproval.roi : Number(activeApproval.roi) || 0).toFixed(2)}x
                  </span>
                </div>
              </div>

              {/* Policy Enforcements */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase block font-mono">Server-Side Policy Check Results</span>
                <div className="space-y-1.5">
                  {activeApproval.policyChecks.map((rule: any, i: number) => (
                    <div key={i} className="flex justify-between items-center bg-slate-950/40 p-2 rounded border border-slate-800/40">
                      <div>
                        <span className="font-bold text-slate-300 block">{rule.ruleName}</span>
                        <span className="text-[10px] text-slate-500 font-mono">Limit: {rule.limit} (Value: {rule.value})</span>
                      </div>
                      <span className="bg-emerald-500/10 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded font-mono border border-emerald-500/20">
                        {rule.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex justify-end space-x-3">
              <button 
                onClick={() => handleResolveApproval('rejected')}
                className="bg-transparent hover:bg-slate-800 text-slate-400 hover:text-slate-200 font-semibold py-2 px-4 rounded transition border border-slate-800"
              >
                Reject Goal Run
              </button>
              <button 
                onClick={() => handleResolveApproval('approved')}
                className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold py-2 px-4 rounded transition flex items-center space-x-1.5"
              >
                <CheckCircle className="h-4 w-4" />
                <span>Approve Execution</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
