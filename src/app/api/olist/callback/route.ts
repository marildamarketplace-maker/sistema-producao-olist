import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { getAplicativoOlistConfig, getOlistRedirectUri } from "@/lib/aplicativo";
import {
  ErroPayloadTokenOAuthOlist,
  validarPayloadTokenOAuthOlist,
} from "@/lib/olist-oauth";
import { prisma } from "@/lib/prisma";

const usedAuthorizationCodes = new Set<string>();

function isHtmlResponse(contentType: string, text: string) {
  return contentType.includes("text/html") || /<html|<script|alert\(/i.test(text);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const refreshToken = req.nextUrl.searchParams.get("refresh_token");
  const aplicativoId = req.cookies.get("olist_aplicativo_id")?.value;
  if (!aplicativoId) return NextResponse.json({ error: "Aplicativo não identificado." }, { status: 401 });
  const olistConfig = await getAplicativoOlistConfig(aplicativoId);
  const clientId = olistConfig.clientId;
  const clientSecret = olistConfig.clientSecret;
  const redirectUri = getOlistRedirectUri(req);

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Configure client ID e client secret da Olist no aplicativo." }, { status: 500 });
  }

  const grantType = refreshToken ? "refresh_token" : "authorization_code";

  if (grantType === "authorization_code") {
    const cookieState = req.cookies.get("olist_oauth_state")?.value;
    if (!state || !cookieState || state !== cookieState) {
      return NextResponse.json({ error: "Falha de autenticação OAuth: state inválido." }, { status: 400 });
    }
  }

  if (grantType === "authorization_code" && !code) {
    return NextResponse.json({ error: "Código OAuth ausente." }, { status: 400 });
  }
  if (grantType === "refresh_token" && !refreshToken) {
    return NextResponse.json({ error: "Refresh token ausente." }, { status: 400 });
  }
  if (grantType === "authorization_code" && code && usedAuthorizationCodes.has(code)) {
    return NextResponse.json({ error: "Código OAuth já utilizado. Gere um novo código de autorização." }, { status: 400 });
  }

  const body = new URLSearchParams({
    grant_type: grantType,
    client_id: clientId,
    client_secret: clientSecret,
  });

  if (grantType === "authorization_code") {
    body.set("code", code as string);
    body.set("redirect_uri", redirectUri);
  } else {
    body.set("refresh_token", refreshToken as string);
  }

  const response = await axios.post(olistConfig.oauthUrl, body, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    validateStatus: () => true,
  });

  console.info("[olist-api]", {
    endpoint: olistConfig.oauthUrl,
    status: response.status,
    grant_type: grantType,
    client_id_exists: Boolean(clientId),
    client_secret_exists: Boolean(clientSecret),
    redirect_uri: redirectUri,
    modulo: "oauth-callback",
  });

  const rawText = typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? "");
  const contentType = String(response.headers["content-type"] ?? "");
  if (isHtmlResponse(contentType, rawText)) {
    return NextResponse.json(
      { error: "Endpoint incorreto: a Olist retornou HTML em vez de JSON. Verifique a URL da API." },
      { status: 500 },
    );
  }

  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401) {
      return NextResponse.json(
        { error: "Falha no OAuth Olist/Tiny. Verifique Client ID, Client Secret, Redirect URI e se o código de autorização não expirou." },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: `Falha no callback OAuth (${response.status}).` }, { status: 500 });
  }

  let tokenData;
  try {
    tokenData = validarPayloadTokenOAuthOlist(
      typeof response.data === "string" ? JSON.parse(rawText) : response.data,
      { exigirRefreshToken: grantType === "authorization_code" },
    );
  } catch (error) {
    const mensagem =
      error instanceof ErroPayloadTokenOAuthOlist
        ? error.message
        : "Resposta OAuth inválida da Olist.";
    console.error("[olist-api] Payload OAuth inválido.", {
      grant_type: grantType,
      erro: mensagem,
    });
    return NextResponse.json({ error: mensagem }, { status: 502 });
  }
  if (grantType === "authorization_code" && code) usedAuthorizationCodes.add(code);

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
  const existente = await prisma.integracaoOlistToken.findFirst({
    where: { aplicativoId, provider: "olist" }, select: { id: true },
  });
  const dadosToken = {
    aplicativoId,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? refreshToken,
    expiresAt,
    status: "conectado",
    lastLoginAt: new Date(),
    updatedAt: new Date(),
  };
  if (existente) {
    await prisma.integracaoOlistToken.update({ where: { id: existente.id }, data: dadosToken });
  } else {
    await prisma.integracaoOlistToken.create({ data: { provider: "olist", ...dadosToken } });
  }

  const redirect = NextResponse.redirect(new URL("/configuracoes", req.nextUrl.origin));
  redirect.cookies.set("olist_oauth_state", "", { path: "/", maxAge: 0 });
  redirect.cookies.set("olist_aplicativo_id", "", { path: "/api/olist", maxAge: 0 });
  return redirect;
}
