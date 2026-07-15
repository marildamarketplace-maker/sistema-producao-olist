import { prisma } from "@/lib/prisma";

const OLIST_API_BASE_URL_DEFAULT = "https://api.tiny.com.br/public-api/v3";
const OLIST_OAUTH_URL_DEFAULT = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";
const OLIST_OAUTH_AUTHORIZE_URL_DEFAULT =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth";

function primeiroHeader(header: string | null) {
  return header?.split(",")[0]?.trim() || null;
}

export function getOlistRedirectUri(req: Request) {
  const configuredRedirectUri = process.env.OLIST_REDIRECT_URI?.trim();
  if (configuredRedirectUri) return configuredRedirectUri;

  const requestUrl = new URL(req.url);
  const host = primeiroHeader(req.headers.get("x-forwarded-host")) ?? primeiroHeader(req.headers.get("host"));
  const protocol = primeiroHeader(req.headers.get("x-forwarded-proto")) ?? requestUrl.protocol.replace(":", "");
  const origin = host ? `${protocol}://${host}` : requestUrl.origin;

  return `${new URL("/api/olist/callback", origin).toString()}?`;
}

export async function getAplicativoOlistConfig(aplicativoId: string) {
  const aplicativo = await prisma.aplicativo.findUnique({
    where: { id: aplicativoId },
    select: {
      id: true,
      nome: true,
      olistClientId: true,
      olistClientSecret: true,
    },
  });

  if (!aplicativo) {
    throw new Error("Aplicativo do usuário não encontrado.");
  }

  return {
    aplicativoId,
    nome: aplicativo.nome,
    clientId: aplicativo.olistClientId ?? "",
    clientSecret: aplicativo.olistClientSecret ?? "",
    apiBaseUrl: OLIST_API_BASE_URL_DEFAULT,
    oauthUrl: OLIST_OAUTH_URL_DEFAULT,
    oauthAuthorizeUrl: OLIST_OAUTH_AUTHORIZE_URL_DEFAULT,
  };
}
