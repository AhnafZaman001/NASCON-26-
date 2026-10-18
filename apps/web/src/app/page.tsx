"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/app";

export default function Home() {
  const { me } = useApp(); const r = useRouter();
  useEffect(() => { r.replace(me ? "/dashboard" : "/login"); }, [me, r]);
  return null;
}
