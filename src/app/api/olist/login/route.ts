import { NextResponse } from "next/server";

const OLIST_OAUTH_AUTHORIZE_URL =
  process.env.OLIST_OAUTH_AUTHORIZE_URL ?? "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth";

export async function GET(req: Request) {
  const clientId = process.env.OLIST_CLIENT_ID;
  const redirectUri = process.env.OLIST_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "Configure OLIST_CLIENT_ID e OLIST_REDIRECT_URI." }, { status: 500 });
  }

  const url = new URL(OLIST_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid");

  const state = new URL(req.url).searchParams.get("state");
  if (state) url.searchParams.set("state", state);

  return NextResponse.redirect(url.toString());
}
