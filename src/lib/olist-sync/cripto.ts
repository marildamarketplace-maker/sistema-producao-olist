import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { FalhaSync, type JsonValue } from "./contrato";

const TAMANHO_MAXIMO = 2 * 1024 * 1024;

function canonico(valor: JsonValue, profundidade = 0): string {
  if (profundidade > 32) throw new FalhaSync("JSON_INVALIDO", "O conteúdo ultrapassa a profundidade permitida.");
  if (valor === null) return "null";
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) throw new FalhaSync("JSON_INVALIDO", "O conteúdo possui um número inválido.");
    return JSON.stringify(valor);
  }
  if (typeof valor === "boolean" || typeof valor === "string") return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(item => canonico(item, profundidade + 1)).join(",")}]`;
  if (typeof valor !== "object" || Object.getPrototypeOf(valor) !== Object.prototype) {
    throw new FalhaSync("JSON_INVALIDO", "O conteúdo não é um objeto JSON válido.");
  }
  return `{${Object.keys(valor).sort().map(chave => `${JSON.stringify(chave)}:${canonico(valor[chave], profundidade + 1)}`).join(",")}}`;
}

/** Ordem estável dos objetos; a ordem dos arrays tem significado e é preservada. */
export function serializarCanonico(valor: JsonValue): string {
  const texto = canonico(valor);
  if (Buffer.byteLength(texto, "utf8") > TAMANHO_MAXIMO) {
    throw new FalhaSync("JSON_INVALIDO", "O conteúdo ultrapassa o limite permitido.");
  }
  return texto;
}

function lerChave(valor: string | undefined): Buffer {
  if (!valor || !/^[A-Za-z0-9+/]{43}=$/.test(valor)) {
    throw new FalhaSync("CRIPTO_NAO_CONFIGURADA", "Configure as chaves de proteção da sincronização com 32 bytes em base64.");
  }
  const chave = Buffer.from(valor, "base64");
  if (chave.length !== 32 || chave.toString("base64") !== valor) {
    throw new FalhaSync("CRIPTO_NAO_CONFIGURADA", "A chave de proteção da sincronização é inválida.");
  }
  return chave;
}

export function criarCriptografiaSync(ambiente: {
  OLIST_SYNC_DATA_KEY?: string;
  OLIST_SYNC_HMAC_KEY?: string;
} = { OLIST_SYNC_DATA_KEY: process.env.OLIST_SYNC_DATA_KEY, OLIST_SYNC_HMAC_KEY: process.env.OLIST_SYNC_HMAC_KEY }) {
  const dados = lerChave(ambiente.OLIST_SYNC_DATA_KEY);
  const hmac = lerChave(ambiente.OLIST_SYNC_HMAC_KEY);
  if (dados.equals(hmac)) throw new FalhaSync("CRIPTO_NAO_CONFIGURADA", "As chaves de dados e de identificação devem ser diferentes.");
  const validarContexto = (contexto: string) => {
    if (!contexto || contexto.length > 512) throw new FalhaSync("CONTEXTO_INVALIDO", "O contexto de proteção é obrigatório.");
    return Buffer.from(`olist-sync:v1:${contexto}`, "utf8");
  };
  return {
    hash(valor: JsonValue, contexto: string): string {
      return createHmac("sha256", hmac).update(validarContexto(contexto)).update("\0").update(serializarCanonico(valor)).digest("hex");
    },
    cifrar(valor: JsonValue, contexto: string): string {
      const iv = randomBytes(12);
      const cifra = createCipheriv("aes-256-gcm", dados, iv);
      cifra.setAAD(validarContexto(contexto));
      const texto = Buffer.concat([cifra.update(serializarCanonico(valor), "utf8"), cifra.final()]);
      return ["v1", iv.toString("base64url"), cifra.getAuthTag().toString("base64url"), texto.toString("base64url")].join(".");
    },
    decifrar(texto: string, contexto: string): JsonValue {
      const aad = validarContexto(contexto);
      try {
        const partes = texto.split(".");
        if (partes.length !== 4 || partes[0] !== "v1" || texto.length > TAMANHO_MAXIMO * 2 ||
          !partes.slice(1).every(parte => /^[A-Za-z0-9_-]+$/.test(parte))) throw new Error("Formato");
        const iv = Buffer.from(partes[1], "base64url");
        const tag = Buffer.from(partes[2], "base64url");
        if (iv.length !== 12 || tag.length !== 16) throw new Error("Formato");
        const cifra = createDecipheriv("aes-256-gcm", dados, iv);
        cifra.setAAD(aad);
        cifra.setAuthTag(tag);
        const decifrado = Buffer.concat([cifra.update(Buffer.from(partes[3], "base64url")), cifra.final()]).toString("utf8");
        const valor: JsonValue = JSON.parse(decifrado);
        serializarCanonico(valor);
        return valor;
      } catch {
        throw new FalhaSync("DADOS_INVALIDOS", "Não foi possível validar os dados protegidos da sincronização.");
      }
    },
  };
}

export function hashSync(valor: JsonValue, contexto: string): string {
  return criarCriptografiaSync().hash(valor, contexto);
}
export function cifrarSync(valor: JsonValue, contexto: string): string {
  return criarCriptografiaSync().cifrar(valor, contexto);
}
export function decifrarSync(texto: string, contexto: string): JsonValue {
  return criarCriptografiaSync().decifrar(texto, contexto);
}
