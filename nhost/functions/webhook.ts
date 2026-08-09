import { Request, Response } from 'express';

export default async function webhookTrigger(req: Request, res: Response) {
  // A webhook endpoint that simulates an external system starting a workflow
  // In a real scenario, this would verify a webhook signature (e.g., Stripe, GitHub)
  
  const { workflow_id, api_key } = req.body;

  if (!workflow_id) {
    return res.status(400).json({ success: false, message: 'Missing workflow_id' });
  }

  // Very basic auth for the webhook to prevent public spam
  if (api_key !== 'my-secret-webhook-key') {
    return res.status(401).json({ success: false, message: 'Unauthorized webhook call' });
  }

  try {
    // 1. Call our existing trigger function logic internally or via the GraphQL Action
    // For this assignment, we will just call the Hasura Action via GraphQL
    // using the Admin Secret to bypass user session auth since webhooks don't have user sessions

    const NHOST_GRAPHQL_URL = process.env.NHOST_GRAPHQL_URL || 'http://localhost:8080/v1/graphql';
    const HASURA_ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET || 'nhost-admin-secret';

    const triggerMutation = `
      mutation TriggerFromWebhook($workflow_id: uuid!) {
        triggerWorkflowRun(workflow_id: $workflow_id) {
          success
          message
        }
      }
    `;

    const response = await fetch(NHOST_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hasura-admin-secret': HASURA_ADMIN_SECRET,
        // We mock the user ID of the owner to allow the trigger to pass the permission check inside the action
        // In a real app, you might have a "Service Role" or use the webhook creator's ID
        'x-hasura-role': 'admin'
      },
      body: JSON.stringify({ 
        query: triggerMutation, 
        variables: { workflow_id } 
      }),
    });

    const data = await response.json();
    
    if (data.errors) {
      return res.status(500).json({ success: false, message: 'GraphQL Error', errors: data.errors });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Webhook successfully triggered workflow',
      data: data.data 
    });

  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
