'use client';

import { useState } from 'react';
import { gql, useQuery, useMutation, useSubscription } from '@apollo/client';
import { useRouter, useParams } from 'next/navigation';
import { useAuthenticationStatus } from '@nhost/nextjs';
import Link from 'next/link';

const GET_WORKFLOW = gql`
  query GetWorkflow($id: uuid!) {
    workflows(where: {id: {_eq: $id}}) {
      id
      name
      workflow_steps(order_by: {step_order: asc}) {
        id
        type
        step_order
      }
    }
  }
`;

const SUB_WORKFLOW_RUNS = gql`
  subscription MonitorRuns($id: uuid!) {
    workflows(where: {id: {_eq: $id}}) {
      workflow_runs(order_by: {created_at: desc}, limit: 1) {
        id
        status
        step_runs(order_by: {created_at: asc}) {
          id
          status
          step_id
        }
      }
    }
  }
`;

const ADD_STEP = gql`
  mutation AddStep($workflowId: uuid!, $type: String!, $order: Int!) {
    insert_workflow_steps_one(object: {
      workflow_id: $workflowId, 
      type: $type, 
      step_order: $order, 
      config: "{}"
    }) {
      id
    }
  }
`;

const TRIGGER_RUN = gql`
  mutation TriggerRun($workflowId: uuid!) {
    triggerWorkflowRun(workflow_id: $workflowId) {
      success
      message
    }
  }
`;

const APPROVE_STEP = gql`
  mutation ApproveStep($stepRunId: uuid!) {
    approveStep(step_run_id: $stepRunId) {
      success
      message
    }
  }
`;

export default function WorkflowBuilderPage() {
  const router = useRouter();
  const params = useParams();
  const workflowId = params?.id as string;
  const [newStepType, setNewStepType] = useState('llm_call');

  const { isAuthenticated, isLoading: isAuthLoading } = useAuthenticationStatus();

  const { data: wfData, loading: wfLoading } = useQuery(GET_WORKFLOW, { 
    variables: { id: workflowId },
    skip: !workflowId || isAuthLoading || !isAuthenticated
  });
  const { data: subData } = useSubscription(SUB_WORKFLOW_RUNS, { 
    variables: { id: workflowId },
    skip: !workflowId || isAuthLoading || !isAuthenticated
  });
  
  const [addStep, { loading: isAddingStep }] = useMutation(ADD_STEP, { refetchQueries: [GET_WORKFLOW] });
  const [triggerRun, { loading: isTriggering }] = useMutation(TRIGGER_RUN);
  const [approveStep, { loading: isApproving }] = useMutation(APPROVE_STEP);

  if (isAuthLoading) return <div className="p-8 text-center">Loading...</div>;

  const workflow = wfData?.workflows?.[0];
  const latestRun = subData?.workflows?.[0]?.workflow_runs?.[0];
  const stepRuns = latestRun?.step_runs || [];

  if (wfLoading) return <div className="p-8 text-center">Loading Workflow...</div>;
  if (!workflow) return <div className="p-8 text-center text-red-500">Workflow not found or permission denied.</div>;

  const handleAddStep = async () => {
    const nextOrder = (workflow.workflow_steps?.length || 0) + 1;
    await addStep({ variables: { workflowId, type: newStepType, order: nextOrder } });
  };

  const handleRun = async () => {
    try {
      await triggerRun({ variables: { workflowId } });
      alert("Workflow execution started!");
    } catch (e: any) {
      alert("Error starting workflow: " + e.message);
    }
  };

  const handleApprove = async (stepRunId: string) => {
    try {
      await approveStep({ variables: { stepRunId } });
      alert("Step approved!");
    } catch (e: any) {
      alert("Error approving step: " + e.message);
    }
  };

  // Lucide Icons are dynamically imported for the UI
  const { Play, Plus, Server, Webhook, Split, ShieldCheck, Cpu, ArrowLeft, RefreshCw, CircleDashed } = require('lucide-react');

  return (
    <div className="min-h-screen bg-[#f4f5f8] p-8 font-sans">
      <div className="max-w-5xl mx-auto">
        <Link href="/" className="inline-flex items-center text-slate-500 hover:text-slate-900 transition-colors mb-6 text-sm font-medium">
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Dashboard
        </Link>
        
        {/* Header Block */}
        <div className="bg-white px-8 py-6 rounded-xl shadow-sm border border-slate-200 mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 mb-1">{workflow.name}</h1>
            <p className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-1 rounded inline-block">ID: {workflowId}</p>
          </div>
          <button 
            onClick={handleRun}
            disabled={isTriggering || workflow.workflow_steps.length === 0}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium shadow-sm hover:bg-blue-700 hover:shadow disabled:opacity-50 disabled:pointer-events-none transition-all flex items-center gap-2"
          >
            {isTriggering ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isTriggering ? 'Initializing...' : 'Execute Workflow'}
          </button>
        </div>

        {/* Live Run Monitor */}
        {latestRun && (
          <div className="bg-white border border-slate-200 p-8 rounded-xl mb-8 shadow-sm">
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Server className="w-5 h-5 text-slate-400" /> Execution Logs
              </h2>
              <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                latestRun.status === 'completed' ? 'bg-green-100 text-green-700 border border-green-200' :
                latestRun.status === 'paused' ? 'bg-yellow-100 text-yellow-700 border border-yellow-200' :
                latestRun.status === 'failed' ? 'bg-red-100 text-red-700 border border-red-200' :
                'bg-blue-100 text-blue-700 border border-blue-200'
              }`}>
                {latestRun.status}
              </span>
            </div>
            
            <div className="space-y-3">
              {workflow.workflow_steps.map((step: any) => {
                const sRun = stepRuns.find((sr: any) => sr.step_id === step.id);
                const isPaused = sRun?.status === 'paused';
                
                return (
                  <div key={step.id} className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="font-medium text-slate-700 flex items-center gap-3 text-sm">
                      <span className="flex items-center justify-center w-6 h-6 rounded bg-white border border-slate-200 text-xs text-slate-500 font-mono shadow-sm">{step.step_order}</span>
                      {step.type.replace('_', ' ').toUpperCase()}
                    </span>
                    <div className="flex items-center gap-4">
                      {sRun ? (
                        <span className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${isPaused ? 'text-yellow-600' : sRun.status === 'completed' ? 'text-green-600' : sRun.status === 'failed' ? 'text-red-600' : 'text-blue-600'}`}>
                          {sRun.status === 'running' && <RefreshCw className="w-3 h-3 animate-spin" />}
                          {sRun.status}
                        </span>
                      ) : (
                        <span className="text-xs font-bold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
                          <CircleDashed className="w-3 h-3" /> Waiting
                        </span>
                      )}
                      
                      {isPaused && (
                        <button 
                          onClick={() => handleApprove(sRun.id)}
                          disabled={isApproving}
                          className="px-4 py-1.5 bg-yellow-500 text-white rounded text-xs font-bold shadow-sm hover:bg-yellow-600 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          {isApproving ? 'Authorizing...' : 'Approve Execution'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Node Editor Canvas */}
        <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 relative overflow-hidden">
          {/* Subtle grid background to simulate canvas */}
          <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
          
          <div className="relative z-10 flex items-center justify-between mb-8 pb-4 border-b border-slate-100">
            <h2 className="text-lg font-bold text-slate-800">Workflow Definition</h2>
            <div className="text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded border border-slate-200 font-medium">Read-Only View</div>
          </div>
          
          <div className="relative z-10 space-y-0 mb-10 flex flex-col items-center">
            {workflow.workflow_steps.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 w-full max-w-md border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
                <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center mb-4 text-slate-400 border border-slate-200"><Plus /></div>
                <p className="text-slate-600 font-medium">Canvas is empty</p>
                <p className="text-slate-400 text-sm mt-1 text-center">Add your first functional node to begin building the automation.</p>
              </div>
            ) : (
              workflow.workflow_steps.map((step: any, index: number) => {
                let Icon = Cpu;
                let colorBorder = "border-slate-300";
                let colorBg = "bg-white";
                let colorIconBg = "bg-slate-100";
                let colorIcon = "text-slate-600";
                
                if (step.type === 'llm_call') { Icon = Cpu; colorBorder = "border-indigo-300"; colorIconBg = "bg-indigo-50"; colorIcon = "text-indigo-600"; }
                if (step.type === 'http_request') { Icon = Webhook; colorBorder = "border-emerald-300"; colorIconBg = "bg-emerald-50"; colorIcon = "text-emerald-600"; }
                if (step.type === 'approval_gate') { Icon = ShieldCheck; colorBorder = "border-yellow-300"; colorIconBg = "bg-yellow-50"; colorIcon = "text-yellow-600"; }
                if (step.type === 'conditional_branch') { Icon = Split; colorBorder = "border-cyan-300"; colorIconBg = "bg-cyan-50"; colorIcon = "text-cyan-600"; }
                if (step.type === 'db_write') { Icon = Server; colorBorder = "border-purple-300"; colorIconBg = "bg-purple-50"; colorIcon = "text-purple-600"; }
                if (step.type === 'notify') { Icon = Play; colorBorder = "border-pink-300"; colorIconBg = "bg-pink-50"; colorIcon = "text-pink-600"; }

                return (
                  <div key={step.id} className="relative flex flex-col items-center w-full max-w-md">
                    {/* The Node Card */}
                    <div className={`w-full p-0 rounded-lg flex flex-col border shadow-sm transition-shadow hover:shadow-md bg-white ${colorBorder}`}>
                      <div className={`px-4 py-2 border-b border-slate-100 flex justify-between items-center rounded-t-lg bg-slate-50/50`}>
                        <div className="flex items-center gap-2">
                           <div className={`w-6 h-6 rounded flex items-center justify-center ${colorIconBg} ${colorIcon}`}>
                             <Icon className="w-3.5 h-3.5" />
                           </div>
                           <h3 className="font-semibold text-slate-700 text-sm">{step.type.replace('_', ' ').toUpperCase()}</h3>
                        </div>
                        <div className="flex gap-1">
                          <div className="w-1 h-1 rounded-full bg-slate-300"></div>
                          <div className="w-1 h-1 rounded-full bg-slate-300"></div>
                          <div className="w-1 h-1 rounded-full bg-slate-300"></div>
                        </div>
                      </div>
                      <div className="px-4 py-3">
                        <p className="text-xs text-slate-500 font-medium">Node Execution Order: {step.step_order}</p>
                      </div>
                    </div>
                    
                    {/* The Connection SVG Line */}
                    {index !== workflow.workflow_steps.length - 1 && (
                      <div className="h-10 w-px bg-slate-300 my-1 relative">
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-slate-300 bg-white"></div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="relative z-10 flex flex-col sm:flex-row gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <select 
              value={newStepType}
              onChange={(e) => setNewStepType(e.target.value)}
              className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-700 font-medium text-sm appearance-none cursor-pointer shadow-sm"
            >
              <option value="llm_call">🧠 AI Logic (LLM Call)</option>
              <option value="http_request">🌐 External Call (HTTP Request)</option>
              <option value="db_write">💾 Database Write</option>
              <option value="notify">📩 Send Notification</option>
              <option value="approval_gate">🛡️ Manual Action (Approval Gate)</option>
              <option value="conditional_branch">🔀 Logic (Conditional Branch)</option>
            </select>
            <button 
              onClick={handleAddStep}
              disabled={isAddingStep}
              className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:pointer-events-none font-medium text-sm flex items-center justify-center gap-2 shadow-sm"
            >
              <Plus className="w-4 h-4" /> Add Node
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
