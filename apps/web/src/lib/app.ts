import { useStore, getState } from "./store";
import type { Perm, State } from "./types";

export function useApp() {
  const s = useStore();
  const me = s.members.find((m) => m.id === s.meId) ?? null;
  const can = (p: Perm) => !!me && (me.level === "owner" || me.perms.includes(p));
  const isAdmin = me?.level === "owner" || me?.level === "admin";
  const companyWide = isAdmin || can("assignment.manage");
  return { s, me, can, isAdmin, companyWide };
}
/** A user sees a contact if they can view CRM records, or they own a lead/opportunity on it. */
export function canSeeContact(s: State, meId: string | null, canView: boolean, contactId: string) {
  return canView || s.leads.some((l) => l.contactId === contactId && l.ownerId === meId) || s.opps.some((o) => o.contactId === contactId && o.ownerId === meId);
}
export const mask = (canSee: boolean, v: string) => (canSee ? v : "•••••");
export const snapshot = getState;
