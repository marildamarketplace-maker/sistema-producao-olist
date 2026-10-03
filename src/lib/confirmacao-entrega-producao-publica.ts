import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

const VERSAO_TOKEN = 1;
const VALIDADE_TOKEN_SEGUNDOS = 7 * 24 * 60 * 60;
const HASHES_SENHAS_VALIDAS = [
  "072fee9f0154344c7c550b69f9b9203723772e8ed2ed5dcff46c0af87567361e",
  "c966f2b2ac54ea7da80c12641795183892f204b6b6016a3a4c7d5c80108f97c7",
].map((hash) => Buffer.from(hash, "hex"));

type TokenPayload = {
  v: number;
  aplicativoId: string;
  exp: number;
};

function obterSegredo() {
  const segredo = process.env.CONFIRMACAO_PRODUCAO_PUBLIC_SECRET?.trim();
  if (!segredo || segredo.length < 32) {
    throw new Error(
      "CONFIRMACAO_PRODUCAO_PUBLIC_SECRET deve ter ao menos 32 caracteres.",
    );
  }
  return segredo;
}

function assinar(payloadCodificado: string) {
  return createHmac("sha256", obterSegredo())
    .update(payloadCodificado)
    .digest("base64url");
}

function assinaturaValida(recebida: string, esperada: string) {
  const recebidaBuffer = Buffer.from(recebida);
  const esperadaBuffer = Buffer.from(esperada);
  return recebidaBuffer.length === esperadaBuffer.length
    && timingSafeEqual(recebidaBuffer, esperadaBuffer);
}

export function criarTokenPublicoConfirmacaoProducao(input: {
  aplicativoId: string;
  agora?: Date;
}) {
  const agora = input.agora ?? new Date();
  const payload: TokenPayload = {
    v: VERSAO_TOKEN,
    aplicativoId: input.aplicativoId,
    exp: Math.floor(agora.getTime() / 1_000) + VALIDADE_TOKEN_SEGUNDOS,
  };
  const payloadCodificado = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadCodificado}.${assinar(payloadCodificado)}`;
}

export function validarTokenPublicoConfirmacaoProducao(
  token: string,
  agora = new Date(),
): TokenPayload {
  const [payloadCodificado, assinatura, extra] = token.split(".");
  if (!payloadCodificado || !assinatura || extra) {
    throw new Error("Link de confirmação inválido.");
  }
  if (!assinaturaValida(assinatura, assinar(payloadCodificado))) {
    throw new Error("Link de confirmação inválido.");
  }

  let payload: Partial<TokenPayload>;
  try {
    payload = JSON.parse(
      Buffer.from(payloadCodificado, "base64url").toString("utf8"),
    ) as Partial<TokenPayload>;
  } catch {
    throw new Error("Link de confirmação inválido.");
  }
  if (
    payload.v !== VERSAO_TOKEN
    || typeof payload.aplicativoId !== "string"
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(payload.aplicativoId)
    || !Number.isSafeInteger(payload.exp)
  ) {
    throw new Error("Link de confirmação inválido.");
  }
  if ((payload.exp as number) <= Math.floor(agora.getTime() / 1_000)) {
    throw new Error("Este link de confirmação expirou.");
  }

  return payload as TokenPayload;
}

export function senhaPublicaConfirmacaoValida(senha: unknown) {
  if (typeof senha !== "string" || senha.length < 1 || senha.length > 100) {
    return false;
  }
  const hashRecebido = createHash("sha256").update(senha).digest();
  return HASHES_SENHAS_VALIDAS.some((hashEsperado) =>
    timingSafeEqual(hashRecebido, hashEsperado),
  );
}
