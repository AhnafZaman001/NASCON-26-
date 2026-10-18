import { useEffect, useRef } from "react";
import { bootFromSession, getState, hydrate, setFeedback, tick, useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { toast, ToastHost } from "./ui";

/**
 * Boots the app: a Supabase session loads the real workspace from the API (live mode), otherwise the
 * demo workspace from this browser. Runs the escalation timer and surfaces new notifications live (Q11).
 */
export default function Engine({ children }: { children: React.ReactNode }) {
  const s = useStore();
  const seen = useRef<string | null>(null);
  useEffect(() => {
    setFeedback({ error: (m) => toast(m, "bad"), ok: (m) => toast(m, "ok") });
    void bootFromSession().then((live) => { if (!live) hydrate(); });
    // Session ended elsewhere (signed out in another tab, user removed, token revoked) -> back to the login screen.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && getState().mode === "live") hydrate();
    });
    const i = setInterval(tick, 1000);
    return () => { clearInterval(i); data.subscription.unsubscribe(); };
  }, []);
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
