import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/lib/app";

export default function Home() {
  const { me } = useApp(); const r = useNavigate();
  useEffect(() => { r(me ? "/dashboard" : "/login", { replace: true }); }, [me, r]);
  return null;
}
