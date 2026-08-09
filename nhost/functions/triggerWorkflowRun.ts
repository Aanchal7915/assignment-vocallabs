import { Request, Response } from 'express';

const NHOST_GRAPHQL_URL = process.env.NHOST_GRAPHQL_URL || 'http://localhost:8080/v1/graphql';
const HASURA_ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET || 'nhost-admin-secret';

// Helper to execute GraphQL against Hasura
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

export default async function triggerWorkflowRun(req: Request, res: Response) {
  const { workflow_id } = req.body.input || {};
  const userId = req.body.session_variables?.['x-hasura-user-id'];

  if (!userId || !workflow_id) {
    return res.status(400).json({ success: false, message: 'Missing user or workflow ID' });
  }

  try {
    // 1. Get workflow details & verify permissions
    const workflowQuery = `
      query GetWorkflow($id: uuid!, $userId: uuid!) {
        workflows_by_pk(id: $id) {
          id
          org_id
          organization {
            quota_used
            quota_allowed
            org_members(where: {user_id: {_eq: $userId}}) {
              role
            }
          }
          workflow_steps(order_by: {step_order: asc}) {
            id
            type
            config
          }
        }
      }
    `;
    const wfData = await executeGraphQL(workflowQuery, { id: workflow_id, userId });
    const workflow = wfData.data?.workflows_by_pk;

    if (!workflow) {
      return res.status(404).json({ success: false, message: 'Workflow not found' });
    }

    const member = workflow.organization.org_members[0];
    if (!member || (member.role !== 'owner' && member.role !== 'editor')) {
      return res.status(403).json({ success: false, message: 'Unauthorized. Must be owner or editor.' });
    }

    if (workflow.organization.quota_used >= workflow.organization.quota_allowed) {
      return res.status(403).json({ success: false, message: 'Organization quota exceeded.' });
    }

    // 2. Create the Workflow Run
    const createRunMutation = `
      mutation CreateRun($workflow_id: uuid!) {
        insert_workflow_runs_one(object: {workflow_id: $workflow_id, status: "running"}) {
          id
        }
      }
    `;
    const runData = await executeGraphQL(createRunMutation, { workflow_id });
    const runId = runData.data?.insert_workflow_runs_one?.id;

    // 3. Execute Steps
    const steps = workflow.workflow_steps;
    
    for (const step of steps) {
      // Create Step Run as pending
      const createStepRun = `
        mutation CreateStepRun($runId: uuid!, $stepId: uuid!) {
          insert_step_runs_one(object: {workflow_run_id: $runId, step_id: $stepId, status: "running"}) {
            id
          }
        }
      `;
      const stepRunData = await executeGraphQL(createStepRun, { runId, stepId: step.id });
      const stepRunId = stepRunData.data?.insert_step_runs_one?.id;

      // Execute based on type
      if (step.type === 'approval_gate') {
        // Pause the workflow run and step run
        await executeGraphQL(`
          mutation PauseRun($runId: uuid!, $stepRunId: uuid!) {
            update_workflow_runs_by_pk(pk_columns: {id: $runId}, _set: {status: "paused"}) { id }
            update_step_runs_by_pk(pk_columns: {id: $stepRunId}, _set: {status: "paused"}) { id }
          }
        `, { runId, stepRunId });
        
        return res.status(200).json({ success: true, message: 'Workflow paused for approval.' });
      }

      if (step.type === 'llm_call') {
        // Example LLM Call (Stubbed with artificial delay as per assignment option)
        await new Promise(resolve => setTimeout(resolve, 1500));
        await executeGraphQL(`
          mutation CompleteStep($stepRunId: uuid!, $output: jsonb) {
            update_step_runs_by_pk(pk_columns: {id: $stepRunId}, _set: {status: "completed", output: $output}) { id }
          }
        `, { stepRunId, output: { result: "Mocked LLM Response" } });
      }

      if (step.type === 'http_request') {
        // Mock HTTP Request
        await executeGraphQL(`
          mutation CompleteStep($stepRunId: uuid!, $output: jsonb) {
            update_step_runs_by_pk(pk_columns: {id: $stepRunId}, _set: {status: "completed", output: $output}) { id }
          }
        `, { stepRunId, output: { statusCode: 200, body: "Success" } });
      }
    }

    // 4. Complete Workflow & Increment Quota
    await executeGraphQL(`
      mutation CompleteRun($runId: uuid!, $orgId: uuid!) {
        update_workflow_runs_by_pk(pk_columns: {id: $runId}, _set: {status: "completed"}) { id }
        update_organizations_by_pk(pk_columns: {id: $orgId}, _inc: {quota_used: 1}) { id }
      }
    `, { runId, orgId: workflow.org_id });

    return res.status(200).json({ success: true, message: 'Workflow completed successfully.' });

  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
