import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  interpretarIdMockup, MOCKUP_CATEGORIA_MAX, MOCKUP_MAX_BYTES,
  MOCKUP_NOME_MAX, MOCKUP_OBSERVACAO_MAX, type TipoMockup,
} from "./mockups";

export class MockupInvalido extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function prepararImagemMockup(request: Request) {
  const nome = lerNome(request.headers.get("x-mockup-nome"));
  const tipoHeader = request.headers.get("x-mockup-tipo") ?? "INDIVIDUAL";
  if (!tipoValido(tipoHeader)) throw new MockupInvalido("Tipo de mockup inválido.");
  const tipo: TipoMockup = tipoHeader;
  const categoria = lerCampo(request.headers.get("x-mockup-categoria"), MOCKUP_CATEGORIA_MAX, "Categoria");
  const observacaoPrompt = lerCampo(request.headers.get("x-mockup-observacao-prompt"), MOCKUP_OBSERVACAO_MAX, "Observação do prompt");
  if (Number(request.headers.get("content-length")) > MOCKUP_MAX_BYTES) {
    throw new MockupInvalido("Selecione uma imagem de até 4 MB.", 413);
  }

  const reader = request.body?.getReader();
  if (!reader) throw new MockupInvalido("Selecione uma imagem.");
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > MOCKUP_MAX_BYTES) {
        await reader.cancel();
        throw new MockupInvalido("Selecione uma imagem de até 4 MB.", 413);
      }
      partes.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const original = Buffer.concat(partes, tamanho);
  let imagem: Buffer;
  try {
    const pipeline = sharp(original, { limitInputPixels: 16_000_000, failOn: "warning" });
    const { format, pages } = await pipeline.metadata();
    if (!format || !["jpeg", "png", "webp"].includes(format) || (pages ?? 1) !== 1) {
      throw new Error("Formato incompatível");
    }
    imagem = await pipeline.rotate().webp({ lossless: true }).toBuffer();
  } catch (error) {
    if (error instanceof MockupInvalido) throw error;
    throw new MockupInvalido("Use uma imagem JPG, PNG ou WebP estática e válida, de até 16 megapixels.", 415);
  }

  const hash = createHash("sha256").update(original).digest("hex");
  const prefixo = tipo === "LAYOUT" ? "layout-" : tipo === "INFORMATIVO" ? "info-" : "";
  const id = `${prefixo}${hash}-${Buffer.from(nome).toString("base64url")}`;
  return { id, nome, tipo, categoria, observacaoPrompt, imagem };
}

function tipoValido(value: string): value is TipoMockup {
  return value === "INDIVIDUAL" || value === "LAYOUT" || value === "INFORMATIVO";
}

function lerNome(valor: string | null) {
  let nome: string;
  try {
    nome = decodeURIComponent(valor ?? "").trim().normalize("NFC");
  } catch {
    throw new MockupInvalido("Nome do mockup inválido.");
  }
  if (!nome || nome.length > MOCKUP_NOME_MAX || /[\x00-\x1f\x7f]/.test(nome)) {
    throw new MockupInvalido("Informe um nome de até 100 caracteres para o mockup.");
  }
  return nome;
}

function lerCampo(valor: string | null, maximo: number, nome: string) {
  let texto: string;
  try {
    texto = decodeURIComponent(valor ?? "").trim().normalize("NFC");
  } catch {
    throw new MockupInvalido(`${nome} inválida.`);
  }
  if (texto.length > maximo || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(texto)) {
    throw new MockupInvalido(`${nome} excede o limite permitido.`);
  }
  return texto;
}

export function mockupPorId(id: string) {
  const dados = interpretarIdMockup(id);
  if (!dados) return null;
  const bytes = Buffer.from(dados.nomeCodificado, "base64url");
  if (bytes.toString("base64url") !== dados.nomeCodificado) return null;
  return { id, nome: bytes.toString("utf8"), tipo: dados.tipo };
}
