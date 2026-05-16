import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST() {
  const { error } = await supabaseAdmin.from("integracao_olist_tokens").upsert(
    {
      provider: "olist",
      access_token: null,
      refresh_token: null,
      expires_at: null,
      status: "nao_conectado",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ login_url: "/api/olist/login" });
}
