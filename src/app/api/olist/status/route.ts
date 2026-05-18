import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("integracao_olist_tokens")
    .select("status, last_login_at, expires_at")
    .eq("provider", "olist")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!data) {
    return NextResponse.json({ status: "nao_conectado", last_login_at: null, expires_at: null });
  }

  const now = new Date();
  const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
  const status = expiresAt && expiresAt <= now && data.status === "conectado" ? "expirado" : data.status;

  return NextResponse.json({ status, last_login_at: data.last_login_at, expires_at: data.expires_at });
}
