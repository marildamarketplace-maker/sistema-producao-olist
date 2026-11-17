import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { getAplicativoOlistConfig, getOlistRedirectUri } from "@/lib/aplicativo";
import { validarPayloadTokenOAuthOlist } from "@/lib/olist-oauth";
import { COOKIE_CONTEXTO_OLIST, verificarContextoOlist } from "@/lib/olist-oauth-contexto";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const contexto = verificarContextoOlist(req.cookies.get(COOKIE_CONTEXTO_OLIST)?.value);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  // Refresh é exclusivamente servidor-servidor; nunca aceitamos credenciais na URL.
  if (req.nextUrl.searchParams.has("refresh_token") || !contexto || state !== contexto.state || !code || code.length > 4096) {
    return NextResponse.json({ error: "Autorização OAuth inválida ou expirada. Reconecte a conta." }, { status: 400 });
  }
  const usuario = await prisma.usuario.findFirst({
    where: { id: contexto.usuarioId, aplicativoId: contexto.aplicativoId, ativo: true, podeEditarConfiguracao: true },
    select: { id: true },
  });
  if (!usuario) return NextResponse.json({ error: "Sem permissão para conectar esta conta." }, { status: 403 });
  try {
    const config = await getAplicativoOlistConfig(contexto.aplicativoId);
    if (!config.clientId || !config.clientSecret) {
      return NextResponse.json({ error: "Configure as credenciais Olist do aplicativo." }, { status: 409 });
    }
    const resposta = await axios.post(config.oauthUrl, new URLSearchParams({
      grant_type: "authorization_code", code, client_id: config.clientId,
      client_secret: config.clientSecret, redirect_uri: getOlistRedirectUri(req),
    }), { timeout: 20_000, headers: { "Content-Type": "application/x-www-form-urlencoded" }, validateStatus: () => true });
    if (resposta.status < 200 || resposta.status >= 300) {
      return NextResponse.json({ error: "A Olist não aceitou a autorização. Inicie uma nova conexão." }, { status: 502 });
    }
    const token = validarPayloadTokenOAuthOlist(resposta.data, { exigirRefreshToken: true });
    await prisma.integracaoOlistToken.upsert({
      where: { aplicativoId_provider: { aplicativoId: contexto.aplicativoId, provider: "olist" } },
      create: { aplicativoId: contexto.aplicativoId, provider: "olist", accessToken: token.access_token,
        refreshToken: token.refresh_token!, expiresAt: new Date(Date.now() + token.expires_in * 1000), status: "conectado", lastLoginAt: new Date() },
      update: { accessToken: token.access_token, refreshToken: token.refresh_token!,
        expiresAt: new Date(Date.now() + token.expires_in * 1000), status: "conectado", lastLoginAt: new Date() },
      select: { id: true },
    });
    const redirect = NextResponse.redirect(new URL("/configuracoes", req.nextUrl.origin));
    for (const nome of [COOKIE_CONTEXTO_OLIST, "olist_aplicativo_id"]) redirect.cookies.set(nome, "", { path: "/api/olist", maxAge: 0 });
    redirect.cookies.set("olist_oauth_state", "", { path: "/", maxAge: 0 });
    return redirect;
  } catch {
    return NextResponse.json({ error: "Não foi possível concluir a conexão Olist. Inicie uma nova autorização." }, { status: 502 });
  }
}
