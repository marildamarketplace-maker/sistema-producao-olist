import { NextResponse } from "next/server";
import { getAplicativoOlistConfig } from "@/lib/aplicativo";

export async function GET(req: Request) {
  const olistConfig = await getAplicativoOlistConfig();
  const clientId = olistConfig.clientId;
  const redirectUri = olistConfig.redirectUri;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "Configure client ID e redirect URI da Olist no aplicativo." }, { status: 500 });
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
