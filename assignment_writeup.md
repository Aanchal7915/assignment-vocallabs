# Assignment Writeup: AI Agent Workflow Builder

## 1. Schema Reasoning & Design
The schema was designed for strict organizational multi-tenancy and robust workflow execution tracking. 
- **`organizations` & `org_members`**: Form the foundation of multi-tenancy. Every workflow belongs to an organization, and access is resolved by matching the caller's user ID against `org_members`.
- **`workflows` & `workflow_steps`**: Represent the template. Steps are explicitly ordered (`step_order`) and strongly typed (`llm_call`, `http_request`, `conditional_branch`, `approval_gate`). `config` is stored as JSONB to accommodate vastly different requirements per step type (e.g. LLM prompts vs HTTP endpoints).
- **`workflow_runs` & `step_runs`**: Capture real-time execution state. Separating the "template" from the "run" ensures that historical runs are preserved even if the workflow is edited. We added an explicit `paused` status to support the `approval_gate` requirement.

## 2. Two-Layer Permission System
A core challenge was enforcing security both at the database level and the execution level.

**Layer 1: Database Scoping (Hasura Permissions)**
This layer prevents unauthorized users from even reading or modifying records they don't own. 
Instead of relying on application logic, we leveraged Hasura's Row-Level Security (RLS). Every `select`, `insert`, and `update` operation on `workflows` and related tables is gated by a custom check:
```json
{"organization": {"org_members": {"user_id": {"_eq": "X-Hasura-User-Id"}}}}
```
This guarantees airtight cross-org isolation. An editor in Org A physically cannot query data from Org B, even if they guess a UUID, because the GraphQL engine filters it out at the SQL level.

**Layer 2: Step-Level Execution Gating (Action Handlers)**
While Hasura controls *data access*, execution logic requires dynamic, mid-flight authorization.
When a user clicks "Run Workflow", or tries to approve a step, the frontend calls a Hasura Action (`triggerWorkflowRun` or `approveStep`). The Node.js serverless function receives the request, fetches the user's specific role (`owner` or `editor`) from the database using the caller's user ID, and makes an execution-level decision. 
For example, in `approveStep`, we explicitly reject the action if the caller is a `viewer`. This cannot be done purely in Hasura RLS because approving a step requires mutating multiple rows and resuming complex background execution logic based on business rules.

## 3. Approval Gate & Workflow Execution
The workflow execution engine is implemented across two Serverless functions to handle the `paused` state seamlessly.

1. **`triggerWorkflowRun`**: Iterates through steps sequentially. When it encounters an `approval_gate` step, it updates the `workflow_run` and `step_run` statuses to `paused` and immediately exits the process, returning a 200 response. This allows the Live Monitor subscription on the frontend to update the UI instantly without hanging the HTTP request.
2. **`approveStep`**: Acts as the resume hook. It first enforces Layer 2 permissions (verifying the caller is an owner/editor). Then, it updates the paused step to `completed` and dynamically queries the database for all remaining, unexecuted steps. It resumes the execution loop for the pending steps (with built-in retry mechanisms for external API calls) before finally marking the overall run as `completed`.

This architecture elegantly sidesteps serverless timeout limits while providing a highly responsive, real-time user experience via GraphQL subscriptions.
