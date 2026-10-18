"use client";
import { useEffect, useRef } from "react";
import { hydrate, tick, useStore } from "@/lib/store";
import { toast, ToastHost } from "./ui";

/** Boots the store, runs the escalation timer, and surfaces new notifications live (Q11). */
export default function Engine({ children }: { children: React.ReactNode }) {
  const s = useStore();
  const seen = useRef<string | null>(null);
  useEffect(() => { hydrate(); const i = setInterval(tick, 1000); return () => clearInterval(i); }, []);
  useEffect(() => {
    if (!s.hydrated || !s.meId) return;
    const mine = s.notifications.filter((n) => n.userId === s.meId);
    const top = mine[0];
    if (seen.current === null) { seen.current = top?.id ?? ""; return; }
    for (const n of mine) { if (n.id === seen.current) break; toast(n.text, "info"); }
    seen.current = top?.id ?? seen.current;
  }, [s.notifications, s.meId, s.hydrated]);
  return (<>{s.hydrated ? children : <div className="grid min-h-screen place-items-center text-sm text-muted" role="status">Loading workspace…</div>}<ToastHost /></>);
}
