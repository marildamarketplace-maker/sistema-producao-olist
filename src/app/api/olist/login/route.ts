import { NextRequest, NextResponse } from "next/server";
import { getAplicativoOlistConfig, getOlistRedirectUri } from "@/lib/aplicativo";

export async function GET(req: NextRequest) {
  const aplicativoId = req.cookies.get("olist_aplicativo_id")?.value;
  if (!aplicativoId) return NextResponse.json({ error: "Aplicativo não identificado." }, { status: 401 });
  const olistConfig = await getAplicativoOlistConfig(aplicativoId);
  const clientId = olistConfig.clientId;
  const redirectUri = getOlistRedirectUri(req);

  if (!clientId) {
    return NextResponse.json({ error: "Configure client ID da Olist no aplicativo." }, { status: 500 });
  }

  const url = new URL(olistConfig.oauthAuthorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid");

  const providedState = new URL(req.url).searchParams.get("state");
  const state = providedState ?? crypto.randomUUID();
  url.searchParams.set("state", state);

  const response = NextResponse.redirect(url.toString());
  response.cookies.set("olist_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
