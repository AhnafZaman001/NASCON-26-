// Permission keys shared by apps/web (UI gating) and apps/api (server enforcement).
// Must match the strings stored in roles.permissions (see supabase/migrations/0010).
export const PERMISSIONS = [
  { key: "crm.view", label: "View CRM records" },
  { key: "crm.create", label: "Create CRM records" },
  { key: "crm.edit", label: "Edit CRM records" },
  { key: "crm.delete", label: "Delete CRM records" },
  { key: "crm.export", label: "Export CRM records" },
  { key: "values.view", label: "See opportunity values" },
  { key: "assignment.manage", label: "Manage assignment rules & reassign" },
  { key: "leads.manage", label: "Manage all leads" },
  { key: "pipelines.manage", label: "Customize pipelines & fields" },
  { key: "conversations.view_all", label: "View all conversations" },
  { key: "dashboard.company", label: "See company-wide dashboard" },
  { key: "integrations.manage", label: "Manage integrations" },
  { key: "users.manage", label: "Manage team & roles" },
  { key: "audit.view", label: "View audit log" },
] as const;

export type Perm = (typeof PERMISSIONS)[number]["key"];
export const ALL_PERM_KEYS: Perm[] = PERMISSIONS.map((p) => p.key);
export const isPerm = (v: string): v is Perm => (ALL_PERM_KEYS as string[]).includes(v);
