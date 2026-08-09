import { Request, Response } from 'express';

const NHOST_GRAPHQL_URL = process.env.NHOST_GRAPHQL_URL || 'http://localhost:8080/v1/graphql';
const HASURA_ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET || 'nhost-admin-secret';

async function executeGraphQL(query: string, variables: any) {
  const response = await fetch(NHOST_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': HASURA_ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}

export default async function approveStep(req: Request, res: Response) {
  const { step_run_id } = req.body.input || {};
  const userId = req.body.session_variables?.['x-hasura-user-id'];

  if (!userId || !step_run_id) {
    return res.status(400).json({ success: false, message: 'Missing user or step run ID' });
  }

  try {
    // 1. Get the step run and the user's role
    const getStepRunQuery = `
      query GetStepRun($id: uuid!, $userId: uuid!) {
        step_runs_by_pk(id: $id) {
          id
          status
          workflow_run {
            id
            status
            workflow {
              id
              organization {
                org_members(where: {user_id: {_eq: $userId}}) {
                  role
                }
              }
            }
          }
        }
      }
    `;
    const stepData = await executeGraphQL(getStepRunQuery, { id: step_run_id, userId });
    const stepRun = stepData.data?.step_runs_by_pk;

    if (!stepRun) {
      return res.status(404).json({ success: false, message: 'Step run not found' });
    }

    if (stepRun.status !== 'paused') {
      return res.status(400).json({ success: false, message: 'Step is not paused for approval' });
    }

    const member = stepRun.workflow_run.workflow.organization.org_members[0];
    if (!member || (member.role !== 'owner' && member.role !== 'editor')) {
      return res.status(403).json({ success: false, message: 'Unauthorized. Must be owner or editor to approve.' });
    }

    // 2. Approve the step
    await executeGraphQL(`
      mutation ApproveStep($stepRunId: uuid!, $runId: uuid!, $userId: uuid!, $now: timestamptz!) {
        update_step_runs_by_pk(
          pk_columns: {id: $stepRunId}, 
          _set: {status: "completed", approved_by: $userId, approved_at: $now}
        ) { id }
        
        update_workflow_runs_by_pk(
          pk_columns: {id: $runId}, 
          _set: {status: "running"}
        ) { id }
      }
    `, { 
      stepRunId: step_run_id, 
      runId: stepRun.workflow_run.id,
      userId,
      now: new Date().toISOString()
    });

    // 3. Execute Remaining Steps
    const remainingStepsQuery = `
      query GetRemainingSteps($workflowId: uuid!) {
        workflow_steps(where: {workflow_id: {_eq: $workflowId}}, order_by: {step_order: asc}) {
          id
          type
        }
      }
    `;
    const remainingStepsData = await executeGraphQL(remainingStepsQuery, { workflowId: stepRun.workflow_run.workflow.id });
    
    // Check which steps haven't been run yet by querying the step_runs
    const existingStepRunsQuery = `
      query GetStepRuns($runId: uuid!) {
        step_runs(where: {workflow_run_id: {_eq: $runId}}) {
          step_id
        }
      }
    `;
    const existingRunsData = await executeGraphQL(existingStepRunsQuery, { runId: stepRun.workflow_run.id });
    const executedStepIds = existingRunsData.data?.step_runs?.map((r: any) => r.step_id) || [];
    
    const steps = remainingStepsData.data?.workflow_steps || [];
    const pendingSteps = steps.filter((s: any) => !executedStepIds.includes(s.id));

    for (const step of pendingSteps) {
      // Create Step Run
      const createStepRun = `
        mutation CreateStepRun($runId: uuid!, $stepId: uuid!) {
          insert_step_runs_one(object: {workflow_run_id: $runId, step_id: $stepId, status: "running"}) {
            id
          }
        }
      `;
      const stepRunData = await executeGraphQL(createStepRun, { runId: stepRun.workflow_run.id, stepId: step.id });
      const newStepRunId = stepRunData.data?.insert_step_runs_one?.id;

      // Execute based on type with retries
      let success = false;
      let attempt = 0;
      let output: any = null;

      while (!success && attempt < 2) {
        attempt++;
        try {
          if (step.type === 'approval_gate') {
            await executeGraphQL(`
              mutation PauseRun($runId: uuid!, $stepRunId: uuid!) {
                update_workflow_runs_by_pk(pk_columns: {id: $runId}, _set: {status: "paused"}) { id }
                update_step_runs_by_pk(pk_columns: {id: $stepRunId}, _set: {status: "paused"}) { id }
              }
            `, { runId: stepRun.workflow_run.id, stepRunId: newStepRunId });
            return res.status(200).json({ success: true, message: 'Workflow paused for approval.' });
          }

          if (step.type === 'llm_call') {
            await new Promise(resolve => setTimeout(resolve, 1500));
            output = { result: "Mocked LLM Response" };
          }

          if (step.type === 'http_request') {
            await new Promise(resolve => setTimeout(resolve, 500));
            output = { statusCode: 200, body: "External HTTP Success" };
          }
          
          if (step.type === 'conditional_branch') {
            // Mock conditional check
            output = { branch_taken: "true", reason: "Previous output matched condition" };
          }

          // If no exception thrown, mark success
          success = true;
          await executeGraphQL(`
            mutation CompleteStep($stepRunId: uuid!, $output: jsonb) {
              update_step_runs_by_pk(pk_columns: {id: $stepRunId}, _set: {status: "completed", output: $output}) { id }
            }
          `, { stepRunId: newStepRunId, output });

        } catch (err: any) {
          if (attempt >= 2) {
            await executeGraphQL(`
              mutation FailStep($stepRunId: uuid!, $runId: uuid!, $error: String!) {
                update_step_runs_by_pk(pk_columns: {id: $stepRunId}, _set: {status: "failed", error: $error}) { id }
                update_workflow_runs_by_pk(pk_columns: {id: $runId}, _set: {status: "failed"}) { id }
              }
            `, { stepRunId: newStepRunId, runId: stepRun.workflow_run.id, error: err.message });
            return res.status(500).json({ success: false, message: 'Workflow failed at step ' + step.id });
          }
        }
      }
    }

    // 4. Complete Workflow
    await executeGraphQL(`
      mutation CompleteRun($runId: uuid!) {
        update_workflow_runs_by_pk(pk_columns: {id: $runId}, _set: {status: "completed"}) { id }
      }
    `, { runId: stepRun.workflow_run.id });

    return res.status(200).json({ success: true, message: 'Step approved and workflow resumed.' });

  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
