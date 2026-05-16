import { NextRequest, NextResponse } from "next/server";

const OLIST_OAUTH_URL = process.env.OLIST_OAUTH_URL ?? "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";

function isHtmlResponse(contentType: string, text: string) {
  return contentType.includes("text/html") || /<html|<script|alert\(/i.test(text);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const clientId = process.env.OLIST_CLIENT_ID;
  const clientSecret = process.env.OLIST_CLIENT_SECRET;
  const redirectUri = process.env.OLIST_REDIRECT_URI;

  if (!code) return NextResponse.json({ error: "Código OAuth ausente." }, { status: 400 });
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: "Configure OLIST_CLIENT_ID, OLIST_CLIENT_SECRET e OLIST_REDIRECT_URI." }, { status: 500 });
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(OLIST_OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }).toString(),
    cache: "no-store",
  });

  console.info("[olist-api]", { endpoint: OLIST_OAUTH_URL, status: response.status, modulo: "oauth-callback" });

  const rawText = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (isHtmlResponse(contentType, rawText)) {
    return NextResponse.json(
      { error: "Endpoint incorreto: a Olist retornou HTML em vez de JSON. Verifique a URL da API." },
      { status: 500 },
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      return NextResponse.json(
        { error: "Token inválido, chave expirada ou usuário sem permissão no módulo solicitado." },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: `Falha no callback OAuth (${response.status}).` }, { status: 500 });
  }

  const tokenData = JSON.parse(rawText) as { access_token?: string; refresh_token?: string; expires_in?: number };

  return NextResponse.json({
    ok: true,
    expires_in: tokenData.expires_in,
    has_access_token: Boolean(tokenData.access_token),
    has_refresh_token: Boolean(tokenData.refresh_token),
  });
}
