'use client';

import { useState, useEffect } from 'react';
import { useAuthenticationStatus, useUserData, useSignOut } from '@nhost/nextjs';
import { useRouter } from 'next/navigation';
import { gql, useQuery, useMutation } from '@apollo/client';
import { AuthForm } from '@/components/AuthForm';

// GraphQL Query to get user's organizations and workflows
const GET_DASHBOARD_DATA = gql`
  query GetDashboardData($userId: uuid!) {
    org_members(where: {user_id: {_eq: $userId}}) {
      organization {
        id
        name
        workflows {
          id
          name
          created_at
        }
      }
    }
  }
`;

// GraphQL Mutation to create a new organization and add the user as owner
const CREATE_FIRST_ORG = gql`
  mutation CreateFirstOrg($userId: uuid!, $orgName: String!) {
    insert_organizations_one(object: {
      name: $orgName,
      org_members: {
        data: [{user_id: $userId, role: "owner"}]
      }
    }) {
      id
    }
  }
`;

// Mutation to create a workflow in an existing organization
const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($orgId: uuid!, $name: String!) {
    insert_workflows_one(object: {org_id: $orgId, name: $name}) {
      id
    }
  }
`;

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  
  useEffect(() => {
    setMounted(true);
  }, []);

  const { isAuthenticated, isLoading: isAuthLoading } = useAuthenticationStatus();
  const user = useUserData();
  const { signOut } = useSignOut();

  const { data, loading: isQueryLoading, refetch } = useQuery(GET_DASHBOARD_DATA, {
    variables: { userId: user?.id },
    skip: !user?.id,
  });

  const [createFirstOrg, { loading: isCreatingFirst }] = useMutation(CREATE_FIRST_ORG);
  const [createWorkflow, { loading: isCreating }] = useMutation(CREATE_WORKFLOW);

  const handleCreateWorkflow = async () => {
    if (!user?.id) return;
    
    try {
      const orgs = data?.org_members;
      
      if (!orgs || orgs.length === 0) {
        // Step 1: Create Organization first (so permissions register)
        const orgRes = await createFirstOrg({
          variables: {
            userId: user.id,
            orgName: `${user.email}'s Org`
          }
        });
        const newOrgId = orgRes.data.insert_organizations_one.id;
        
        // Step 2: Now create the workflow inside that new Organization
        const wfRes = await createWorkflow({
          variables: {
            orgId: newOrgId,
            name: "My First Workflow"
          }
        });
        router.push(`/workflow/${wfRes.data.insert_workflows_one.id}`);
      } else {
        // User already has an organization, just add a workflow
        const res = await createWorkflow({
          variables: {
            orgId: orgs[0].organization.id,
            name: `New Workflow ${new Date().getTime()}`
          }
        });
        router.push(`/workflow/${res.data.insert_workflows_one.id}`);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to create workflow. Check console for errors.");
    }
  };

  if (!mounted || isAuthLoading) {
    return <div className="flex min-h-screen items-center justify-center">Loading...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <AuthForm />
      </div>
    );
  }

  const workflows = data?.org_members[0]?.organization?.workflows || [];

  return (
    <div className="min-h-screen bg-[#f4f5f8] p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 pb-6 border-b border-slate-200">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">AI</div>
            Workflow Dashboard
          </h1>
          <div className="flex items-center gap-4 bg-white border border-slate-200 px-4 py-2 rounded-lg shadow-sm">
            <span className="text-sm text-slate-600 font-medium">{user?.email}</span>
            <div className="w-px h-4 bg-slate-200"></div>
            <button 
              onClick={() => signOut()}
              className="text-sm text-slate-500 hover:text-slate-900 transition-colors font-medium"
            >
              Sign Out
            </button>
          </div>
        </div>
        
        {isQueryLoading ? (
          <div className="text-slate-500 animate-pulse font-medium">Loading workflows...</div>
        ) : (
          <>
            <div className="bg-white p-4 rounded-xl border border-slate-200 mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold shrink-0">🏢</div>
                <div>
                  <h2 className="font-bold text-slate-800">{data?.org_members?.[0]?.organization?.name || 'Your Organization'}</h2>
                  <p className="text-xs text-slate-500 font-medium">Organization Workspace</p>
                </div>
              </div>
              <div className="text-left sm:text-right w-full sm:w-auto border-t sm:border-0 border-slate-100 pt-3 sm:pt-0">
                <p className="text-sm font-bold text-slate-700">Usage Quota</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 rounded-full" 
                      style={{ width: `${Math.min(100, (data?.org_members?.[0]?.organization?.workflows?.length || 0) * 10)}%` }}
                    ></div>
                  </div>
                  <span className="text-xs font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{data?.org_members?.[0]?.organization?.workflows?.length || 0} / 100</span>
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {workflows.map((wf: any) => (
              <div 
                key={wf.id} 
                onClick={() => router.push(`/workflow/${wf.id}`)}
                className="group bg-white p-6 rounded-xl border border-slate-200 cursor-pointer transition-all hover:border-blue-400 hover:shadow-md flex flex-col justify-between min-h-[160px]"
              >
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active</span>
                  </div>
                  <h3 className="font-bold text-lg text-slate-900 tracking-tight group-hover:text-blue-600 transition-colors">{wf.name}</h3>
                </div>
                <div className="pt-4 border-t border-slate-100 mt-4">
                  <p className="text-xs text-slate-400 font-mono flex justify-between">
                    <span>ID:</span>
                    <span>{wf.id.substring(0, 8)}</span>
                  </p>
                </div>
              </div>
            ))}
            
            {/* Create Workflow Card */}
            <button 
              onClick={handleCreateWorkflow}
              disabled={isCreating || isCreatingFirst}
              className="group bg-slate-50 p-6 rounded-xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center min-h-[160px] cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 transition-all disabled:opacity-50"
            >
              <div className="w-10 h-10 rounded-full bg-white border border-slate-200 text-slate-400 flex items-center justify-center mb-3 text-xl font-medium shadow-sm group-hover:text-blue-600 group-hover:border-blue-200 group-hover:bg-blue-100 transition-colors">
                {isCreating || isCreatingFirst ? '...' : '+'}
              </div>
              <h3 className="font-medium text-slate-600 group-hover:text-blue-700 transition-colors">
                {isCreating || isCreatingFirst ? 'Creating...' : 'New Workflow'}
              </h3>
            </button>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
