# AI Agent Workflow Builder - Technical Writeup

## 1. Schema Reasoning & Relationships
The schema is designed to closely match the hierarchical nature of a workflow engine:
- `organizations` is the root entity containing all isolated data.
- `org_members` tracks who has access to which organization and their `role` (owner, editor, viewer).
- `workflows` belong to organizations. 
- `workflow_steps` and `workflow_triggers` belong to workflows. The steps are ordered via `step_order` and store their specific parameters inside a `config` JSONB field, allowing flexibility across different node types (e.g., LLM vs HTTP).
- `workflow_runs` track executions of a workflow, and `step_runs` track the individual granular state of each step in that run, supporting states like `paused` for manual approval.

## 2. Enforcing Two Permission Layers
### Layer 1: Row-Level Security (RLS) in Hasura
This layer ensures data isolation so users in Org A cannot access data in Org B.
- **Rule Implementation**: Every select/insert/update/delete permission in Hasura uses an `_exists` check against the `org_members` table, matching `user_id` to the incoming `X-Hasura-User-Id` header and ensuring `org_id` matches the accessed row.
- **Role Scoping**: 
  - Owners get full CRUD access.
  - Editors get CRUD on workflows/runs, but no access to mutate `org_members` or `organizations`.
  - Viewers get read-only access (only `SELECT` allowed) on workflows/runs.

### Layer 2: Step-Level Gating via Action Handlers
While RLS is excellent for row visibility, step-level logic (e.g., deciding if someone can add a `db_write` step, or if they are allowed to approve a gate mid-execution) requires business logic. 
- **Rule Implementation**: The frontend interacts with Nhost Serverless Functions (exposed as Hasura Actions). Before the function unpauses an `approval_gate`, it fetches the caller's role from `org_members`. If they are an `owner` or `editor`, the execution resumes; otherwise, an unauthorized error is thrown.

## 3. Approval Gate Pause/Resume Implementation
1. The `triggerWorkflowRun` action loops over steps sequentially.
2. When it encounters a step of type `approval_gate`, it updates the `step_run` and `workflow_run` status to `paused` and **terminates** the loop. 
3. The Next.js frontend listens via GraphQL subscriptions to the `step_run` status. When it sees `paused`, it shows an "Approve" button to owners/editors.
4. Clicking "Approve" triggers the `approveStep` Hasura Action.
5. The Action validates permissions, updates the step to `completed`, and re-triggers the remainder of the workflow execution loop from that step onwards.
