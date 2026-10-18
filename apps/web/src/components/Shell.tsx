import { Link } from "react-router-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Bell, CalendarDays, CreditCard, Gauge, Inbox, LogOut, Menu, Plug, ScrollText, Settings, ShieldAlert, Users, KanbanSquare, X } from "lucide-react";
import { useApp } from "@/lib/app";
import { logout, loginAs, markNotificationsRead, recoveryItems, setStatus } from "@/lib/store";
import { cn, ago } from "@/lib/utils";
import { Avatar, Badge, Select } from "./ui";
import type { Availability } from "@/lib/types";

const statusLabel: Record<Availability, string> = { available: "Available", busy: "Busy", leave: "On leave", offline: "Offline" };

export default function Shell({ children }: { children: React.ReactNode }) {
  const { s, me, can, isAdmin, companyWide } = useApp();
  const path = useLocation().pathname; const router = useNavigate();
  const [open, setOpen] = useState(false); const [bell, setBell] = useState(false);
  useEffect(() => { if (s.hydrated && !me) router("/login", { replace: true }); }, [s.hydrated, me, router]);
  if (!me) return null;
  const rec = recoveryItems(s).filter((r) => companyWide || r.lead.ownerId === me.id).length;
  const mine = s.notifications.filter((n) => n.userId === me.id); const unread = mine.filter((n) => !n.read).length;
  const nav = [
    { href: "/dashboard", label: "Dashboard", icon: Gauge, show: true },
    { href: "/leads", label: "Leads", icon: ShieldAlert, show: true, badge: rec },
    { href: "/pipeline", label: "Pipeline", icon: KanbanSquare, show: true },
    { href: "/contacts", label: "Contacts", icon: Users, show: true },
    { href: "/inbox", label: "Inbox", icon: Inbox, show: true },
    { href: "/payments", label: "Payments", icon: CreditCard, show: true },
    { href: "/calendar", label: "Calendar", icon: CalendarDays, show: true },
    { href: "/integrations", label: "Integrations", icon: Plug, show: can("integrations.manage") || isAdmin },
    { href: "/audit", label: "Audit log", icon: ScrollText, show: can("audit.view") },
    { href: "/settings", label: "Settings", icon: Settings, show: isAdmin || can("pipelines.manage") || can("assignment.manage") || can("users.manage") },
  ].filter((n) => n.show);

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 p-3">
      <div className="mb-3 px-2 pt-1"><p className="text-base font-bold tracking-tight">Lead Shield</p><p className="truncate text-xs text-muted">{s.workspace.name}</p></div>
      {nav.map((n) => {
        const active = path === n.href || path.startsWith(n.href + "/");
        return (
          <Link key={n.href} to={n.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium", active ? "bg-brand/15 text-brand" : "text-muted hover:bg-surface2 hover:text-fg")}>
            <n.icon size={17} aria-hidden />{n.label}
            {!!n.badge && <Badge tone="bad" className="ml-auto"><span className="sr-only">Items needing attention: </span>{n.badge}</Badge>}
          </Link>
        );
      })}
      {s.mode === "demo" ? <div className="mt-auto space-y-2 rounded-lg border border-line p-2 text-xs text-muted">
        <p className="font-medium text-fg">Demo: switch user</p>
        <Select aria-label="Switch demo user" value={me.id} onChange={(e) => loginAs(e.target.value)} className="!py-1.5 !text-xs">
          {s.members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.roleName})</option>)}
        </Select>
        <p>Tests permissions and live escalation without logging out.</p>
      </div> : <p className="mt-auto px-2 text-xs text-muted">Signed in as {me.email}</p>}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden"><button aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-surface shadow-xl">{sidebar}</aside></div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/90 px-3 py-2.5 backdrop-blur sm:px-5">
          <button className="rounded-lg p-2 hover:bg-surface2 lg:hidden" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={18} /> : <Menu size={18} />}</button>
          <div className="ml-auto flex items-center gap-2">
            <label className="sr-only" htmlFor="my-status">My availability</label>
            <Select id="my-status" value={me.status} onChange={(e) => setStatus(me.id, e.target.value as Availability)} className="!w-auto !py-1.5">
              {(Object.keys(statusLabel) as Availability[]).map((k) => <option key={k} value={k}>{statusLabel[k]}</option>)}
            </Select>
            <div className="relative">
              <button aria-label={`Notifications, ${unread} unread`} aria-expanded={bell} onClick={() => { setBell(!bell); if (!bell) markNotificationsRead(); }} className="relative rounded-lg p-2 hover:bg-surface2">
                <Bell size={18} />{unread > 0 && <span className="absolute right-1 top-1 size-2 rounded-full bg-bad" />}
              </button>
              {bell && (
                <div className="absolute right-0 mt-2 max-h-96 w-[min(22rem,calc(100vw-1.5rem))] overflow-auto rounded-xl border border-line bg-surface p-2 shadow-xl">
                  {mine.length === 0 && <p className="p-3 text-sm text-muted">No notifications yet.</p>}
                  {mine.slice(0, 12).map((n) => (
                    <Link key={n.id} to={n.leadId ? `/leads` : "#"} onClick={() => setBell(false)} className="block rounded-lg p-2.5 text-sm hover:bg-surface2">{n.text}<span className="block text-xs text-muted">{ago(n.at)}</span></Link>
                  ))}
                </div>
              )}
            </div>
            <div className="hidden items-center gap-2 sm:flex"><Avatar name={me.name} /><div className="text-xs leading-tight"><p className="font-medium">{me.name}</p><p className="text-muted">{me.roleName}</p></div></div>
            <button aria-label="Log out" title="Log out" onClick={() => { void logout().then(() => router("/login", { replace: true })); }} className="rounded-lg p-2 hover:bg-surface2"><LogOut size={18} /></button>
          </div>
        </header>
        <main className="mx-auto max-w-7xl p-3 sm:p-5">{children}</main>
      </div>
    </div>
  );
}
