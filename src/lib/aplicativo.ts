import { prisma } from "@/lib/prisma";

export const APLICATIVO_PADRAO_ID = "00000000-0000-0000-0000-000000000001";

const OLIST_API_BASE_URL_DEFAULT = "https://api.tiny.com.br/public-api/v3";
const OLIST_OAUTH_URL_DEFAULT = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";
const OLIST_OAUTH_AUTHORIZE_URL_DEFAULT =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth";

function primeiroHeader(header: string | null) {
  return header?.split(",")[0]?.trim() || null;
}

export function getOlistRedirectUri(req: Request) {
  const requestUrl = new URL(req.url);
  const host = primeiroHeader(req.headers.get("x-forwarded-host")) ?? primeiroHeader(req.headers.get("host"));
  const protocol = primeiroHeader(req.headers.get("x-forwarded-proto")) ?? requestUrl.protocol.replace(":", "");
  const origin = host ? `${protocol}://${host}` : requestUrl.origin;

  return `${new URL("/api/olist/callback", origin).toString()}?`;
}

export async function getAplicativoOlistConfig(aplicativoId = APLICATIVO_PADRAO_ID) {
  const aplicativo = await prisma.aplicativo.findUnique({
    where: { id: aplicativoId },
    select: {
      id: true,
      nome: true,
      olistClientId: true,
      olistClientSecret: true,
    },
  });

  return {
    aplicativoId,
    nome: aplicativo?.nome ?? "Aplicativo padrão",
    clientId: aplicativo?.olistClientId ?? process.env.OLIST_CLIENT_ID ?? "",
    clientSecret: aplicativo?.olistClientSecret ?? process.env.OLIST_CLIENT_SECRET ?? "",
    apiBaseUrl: OLIST_API_BASE_URL_DEFAULT,
    oauthUrl: OLIST_OAUTH_URL_DEFAULT,
    oauthAuthorizeUrl: OLIST_OAUTH_AUTHORIZE_URL_DEFAULT,
  };
}
