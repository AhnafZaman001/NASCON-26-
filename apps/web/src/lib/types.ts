export type Level = "owner" | "admin" | "user";
export type Perm =
  | "crm.view" | "crm.create" | "crm.edit" | "crm.delete" | "crm.export"
  | "value.view" | "assignment.manage" | "integrations.manage" | "audit.view" | "config.manage";
export const ALL_PERMS: { key: Perm; label: string }[] = [
  { key: "crm.view", label: "View CRM records" },
  { key: "crm.create", label: "Create CRM records" },
  { key: "crm.edit", label: "Edit CRM records" },
  { key: "crm.delete", label: "Delete CRM records" },
  { key: "crm.export", label: "Export CRM records" },
  { key: "value.view", label: "See opportunity values" },
  { key: "assignment.manage", label: "Manage assignment rules & reassign" },
  { key: "config.manage", label: "Customize pipelines & fields" },
  { key: "integrations.manage", label: "Manage integrations" },
  { key: "audit.view", label: "View audit log" },
];
export type Availability = "available" | "busy" | "leave" | "offline";

export interface Member {
  id: string; name: string; email: string; level: Level; roleName: string;
  perms: Perm[]; status: Availability; notifyDest: string; calendar: "connected" | "needs_reconnect" | "none"; tz: string;
}
export interface Company { id: string; name: string }
export type FieldType = "text" | "number" | "date" | "dropdown" | "checkbox";
export interface CustomField {
  id: string; name: string; type: FieldType; entity: "contact" | "opportunity";
  pipelineId: string | null; options?: string[];
}
export interface Stage { id: string; name: string; kind: "open" | "won" | "lost"; required: string[] }
export interface Pipeline { id: string; name: string; stages: Stage[] }
export interface Contact {
  id: string; name: string; phone: string; email: string; companyId: string | null;
  tags: string[]; optedOut: boolean; custom: Record<string, string>; createdAt: number; source: string;
}
export interface Opportunity {
  id: string; title: string; contactId: string; pipelineId: string; stageId: string;
  value: number; custom: Record<string, string>; ownerId: string | null; createdAt: number;
}
export interface LeadHistory { at: number; from: string | null; to: string | null; kind: "assign" | "escalate" | "reassign" | "acknowledge"; reason: string }
export interface Lead {
  id: string; contactId: string; source: string; createdAt: number;
  status: "unassigned" | "assigned" | "acknowledged";
  ownerId: string | null; assignedAt: number | null; firstAssignedAt: number | null;
  deadlineAt: number | null; ackedAt: number | null; ackedBy: string | null; lastActionAt: number;
  level: number; escalations: number; exhausted: boolean; history: LeadHistory[];
}
export interface Message {
  id: string; contactId: string; direction: "in" | "out"; body: string; at: number;
  status: "queued" | "sent" | "delivered" | "failed" | "received"; error?: string; by?: string; ref: string;
}
export interface Payment {
  id: string; oppId: string; contactId: string; amount: number; currency: string; at: number;
  status: "pending" | "paid" | "failed" | "expired" | "refunded"; requestedBy: string; ref: string; link: string;
}
export interface Appointment {
  id: string; contactId: string; oppId: string | null; memberId: string; title: string;
  start: number; end: number; status: "confirmed" | "cancelled"; tz: string;
}
export interface Activity {
  id: string; contactId: string; oppId?: string; at: number; actor: string;
  type: "note" | "stage" | "assignment" | "field" | "message" | "payment" | "appointment" | "lead";
  text: string;
}
export interface AuditEntry { id: string; at: number; actor: string; type: string; target: string; before?: string; after?: string }
export interface AppNotification { id: string; at: number; userId: string; text: string; leadId?: string; read: boolean }
export type IntegrationKey = "messaging" | "payments" | "calendar" | "notifications";
export interface Integration {
  status: "not_connected" | "connected" | "error"; lastOk: number | null; errors: { at: number; text: string }[];
  provider: string; failNext?: boolean;
}
export interface SyncEvent { id: string; at: number; integration: IntegrationKey; dir: "in" | "out"; result: "ok" | "failed" | "rejected" | "duplicate"; ref: string; note: string }
export interface Criterion { field: "tag" | "stage" | "owner" | "source" | "createdDays"; value: string }
export interface SavedList { id: string; name: string; criteria: Criterion[] }
export interface LevelCfg { target: "assignee" | "next" | "backup" | "manager"; seconds: number }
export interface Settings {
  maxOpenLeads: number; idleSeconds: number; backupId: string | null; managerId: string | null;
  ackedOnAbsence: "keep" | "reassign"; levels: LevelCfg[];
}
export interface State {
  hydrated: boolean; workspace: { id: string; name: string }; meId: string | null;
  members: Member[]; companies: Company[]; contacts: Contact[]; fields: CustomField[];
  pipelines: Pipeline[]; opps: Opportunity[]; leads: Lead[]; messages: Message[]; payments: Payment[];
  appointments: Appointment[]; activity: Activity[]; audit: AuditEntry[]; notifications: AppNotification[];
  integrations: Record<IntegrationKey, Integration>; sync: SyncEvent[]; lists: SavedList[];
  settings: Settings; rr: number; hiddenTiles: Record<string, string[]>;
}
