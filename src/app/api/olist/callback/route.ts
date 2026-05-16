import { NextRequest, NextResponse } from "next/server";

const OLIST_OAUTH_URL = process.env.OLIST_OAUTH_URL ?? "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";
const usedAuthorizationCodes = new Set<string>();

function isHtmlResponse(contentType: string, text: string) {
  return contentType.includes("text/html") || /<html|<script|alert\(/i.test(text);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const refreshToken = req.nextUrl.searchParams.get("refresh_token");
  const clientId = process.env.OLIST_CLIENT_ID;
  const clientSecret = process.env.OLIST_CLIENT_SECRET;
  const redirectUri = process.env.OLIST_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: "Configure OLIST_CLIENT_ID, OLIST_CLIENT_SECRET e OLIST_REDIRECT_URI." }, { status: 500 });
  }

  const grantType = refreshToken ? "refresh_token" : "authorization_code";

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

  const response = await fetch(OLIST_OAUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  console.info("[olist-api]", {
    endpoint: OLIST_OAUTH_URL,
    status: response.status,
    grant_type: grantType,
    client_id_exists: Boolean(clientId),
    client_secret_exists: Boolean(clientSecret),
    redirect_uri: redirectUri,
    modulo: "oauth-callback",
  });

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
        { error: "Falha no OAuth Olist/Tiny. Verifique Client ID, Client Secret, Redirect URI e se o código de autorização não expirou." },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: `Falha no callback OAuth (${response.status}).` }, { status: 500 });
  }

  const tokenData = JSON.parse(rawText) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (grantType === "authorization_code" && code) usedAuthorizationCodes.add(code);

  return NextResponse.json({
    ok: true,
    expires_in: tokenData.expires_in,
    has_access_token: Boolean(tokenData.access_token),
    has_refresh_token: Boolean(tokenData.refresh_token),
  });
}
