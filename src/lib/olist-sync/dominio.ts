import {
  CAPACIDADES_SYNC, FalhaSync, type CamposSync, type DecisaoSync, type EntidadeSync,
  type JsonValue, type ObservacaoRemota, type OrigemSync, type ReplicaComparacao,
} from "./contrato";
import { serializarCanonico } from "./cripto";

const TEXTOS_PRODUTO = ["sku", "descricao", "descricaoComplementar", "unidade", "unidadePorCaixa", "gtin", "garantia"] as const;
const TEXTOS_CONTATO = ["nome", "fantasia", "tipoPessoa", "cpfCnpj", "telefone", "celular", "telefoneAdicional", "email", "emailNfe", "site"] as const;
const ENDERECO = ["endereco", "numero", "complemento", "bairro", "municipio", "cep", "uf", "pais"] as const;
const DIMENSOES = ["largura", "altura", "comprimento", "diametro", "pesoLiquido", "pesoBruto"] as const;
const SEO = ["titulo", "descricao", "linkVideo", "slug"] as const;
const IDENTIDADE = new Set(["sku", "cpfCnpj", "tipoPessoa", "tipo", "tipoVariacao", "grade", "unidade"]);

function objeto(valor: unknown): valor is Record<string, unknown> {
  return !!valor && typeof valor === "object" && !Array.isArray(valor);
}

function falhaContrato(): never {
  throw new FalhaSync("CONTRATO", "A Olist retornou dados fora do contrato esperado.");
}

export function identificadorRemoto(valor: unknown): string {
  if (typeof valor === "number" && (!Number.isSafeInteger(valor) || valor < 1)) return falhaContrato();
  const id = typeof valor === "string" || typeof valor === "number" ? String(valor) : "";
  if (!/^[1-9]\d{0,19}$/.test(id)) return falhaContrato();
  return id;
}

function texto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== "string" || valor.length > 100_000) return falhaContrato();
  return valor;
}

function projetarTextos(fonte: Record<string, unknown>, chaves: readonly string[], completo = true): CamposSync {
  const destino: CamposSync = {};
  for (const chave of chaves) if (completo || chave in fonte) destino[chave] = texto(fonte[chave]);
  return destino;
}

function estruturaTextos(valor: unknown, chaves: readonly string[]): JsonValue {
  if (valor === null || valor === undefined) return null;
  if (!objeto(valor)) return falhaContrato();
  return projetarTextos(valor, chaves);
}

/** Não remove letras nem zeros: o CNPJ alfanumérico usa ASCII menos 48 no módulo 11. */
export function normalizarDocumento(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.length > 32) return null;
  const documento = valor.replace(/[.\/\-\s]/g, "").toUpperCase();
  if (/^(.)\1+$/.test(documento)) return null;
  const digito = (base: string, pesos: number[]) => {
    const resto = [...base].reduce((total, caractere, indice) => total + (caractere.charCodeAt(0) - 48) * pesos[indice], 0) % 11;
    return String(resto < 2 ? 0 : 11 - resto);
  };
  if (/^\d{11}$/.test(documento)) {
    const base = documento.slice(0, 9);
    const primeiro = digito(base, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const segundo = digito(base + primeiro, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return documento === base + primeiro + segundo ? documento : null;
  }
  if (/^[A-Z0-9]{12}\d{2}$/.test(documento)) {
    const base = documento.slice(0, 12);
    const primeiro = digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const segundo = digito(base + primeiro, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return documento === base + primeiro + segundo ? documento : null;
  }
  return null;
}

export function normalizarNome(nome: string): string {
  return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Apenas indício para revisão; nunca é uma chave de correspondência. */
export function similaridadeNomes(a: string, b: string): number {
  const trigramas = (valor: string) => {
    const normalizado = normalizarNome(valor);
    const resultado = new Set<string>();
    for (const palavra of normalizado.split(" ").filter(Boolean)) {
      const termo = `  ${palavra} `;
      for (let i = 0; i < termo.length - 2; i++) resultado.add(termo.slice(i, i + 3));
    }
    return resultado;
  };
  const esquerda = trigramas(a);
  const direita = trigramas(b);
  const intersecao = [...esquerda].filter(item => direita.has(item)).length;
  const uniao = esquerda.size + direita.size - intersecao;
  return uniao === 0 ? 0 : intersecao / uniao;
}

function dimensoes(valor: unknown): JsonValue {
  if (valor === null || valor === undefined) return null;
  if (!objeto(valor)) return falhaContrato();
  const resultado: CamposSync = {};
  for (const campo of DIMENSOES) {
    const medida = valor[campo];
    if (medida !== null && medida !== undefined && (typeof medida !== "number" || !Number.isFinite(medida) || medida < 0)) return falhaContrato();
    resultado[campo] = medida === undefined ? null : medida as number | null;
  }
  // Embalagem.id é específico da conta e nunca atravessa a fronteira.
  if (objeto(valor.embalagem) && valor.embalagem.tipo !== null && valor.embalagem.tipo !== undefined) {
    if (typeof valor.embalagem.tipo !== "number" || ![0, 1, 2, 3].includes(valor.embalagem.tipo)) return falhaContrato();
    resultado.embalagem = { tipo: valor.embalagem.tipo };
  }
  return resultado;
}

function seo(valor: unknown): JsonValue {
  if (valor === null || valor === undefined) return null;
  if (!objeto(valor)) return falhaContrato();
  const resultado = projetarTextos(valor, SEO);
  if (valor.keywords !== undefined && valor.keywords !== null) {
    if (!Array.isArray(valor.keywords) || valor.keywords.length > 100 || !valor.keywords.every(item => typeof item === "string" && item.length < 1000)) return falhaContrato();
    resultado.keywords = valor.keywords;
  } else resultado.keywords = null;
  return resultado;
}

function grade(valor: unknown): JsonValue {
  if (valor === undefined || valor === null) return null;
  if (!Array.isArray(valor) || valor.length > 100) return falhaContrato();
  const itens = valor.map(item => {
    if (!objeto(item) || typeof item.chave !== "string" || typeof item.valor !== "string") return falhaContrato();
    return { chave: item.chave, valor: item.valor };
  });
  return itens.sort((a, b) => a.chave.localeCompare(b.chave) || a.valor.localeCompare(b.valor));
}

function imagensObservadas(valor: unknown): JsonValue {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor) || valor.length > 50) return falhaContrato();
  return valor.map(item => {
    if (!objeto(item) || typeof item.externo !== "boolean") return falhaContrato();
    return { url: texto(item.url), externo: item.externo };
  });
}

export function observarRegistro(entidade: EntidadeSync, payload: unknown, opcoes: { completo?: boolean } = {}): ObservacaoRemota {
  if (!objeto(payload)) return falhaContrato();
  const completo = opcoes.completo ?? false;
  const id = identificadorRemoto(payload.id);
  const pendencias: string[] = [];
  let campos: CamposSync;
  let chave: string | null = null;
  let nome: string;
  let tipo: string | undefined;
  let paiId: string | null | undefined;
  let situacao = String(payload.situacao ?? "");
  if (entidade === "PRODUTO") {
    campos = projetarTextos(payload, TEXTOS_PRODUTO, completo);
    chave = typeof payload.sku === "string" && payload.sku.trim() ? payload.sku : null;
    nome = texto(payload.descricao) ?? "";
    tipo = texto(payload.tipo) ?? undefined;
    paiId = objeto(payload.produtoPai) && payload.produtoPai.id ? identificadorRemoto(payload.produtoPai.id) : null;
    if (tipo !== undefined) campos.tipo = tipo;
    for (const campo of ["dimensoes", "seo", "grade"] as const) {
      if (completo || campo in payload) campos[campo] = campo === "dimensoes" ? dimensoes(payload[campo]) : campo === "seo" ? seo(payload[campo]) : grade(payload[campo]);
    }
    if (completo || "anexos" in payload) campos.imagens = imagensObservadas(payload.anexos);
    if ("tipoVariacao" in payload) campos.tipoVariacao = texto(payload.tipoVariacao);
    if (tipo && !["S", "V", "K", "F", "M"].includes(tipo)) pendencias.push("TIPO_PRODUTO_DESCONHECIDO");
    if (completo && !tipo) pendencias.push("TIPO_PRODUTO_AUSENTE");
    if (["K", "F", "V"].includes(tipo ?? "") || paiId || payload.tipoVariacao === "V") pendencias.push("ESTRUTURA_REQUER_MAPEAMENTO");
    for (const referencia of ["marca", "categoria"] as const) {
      if (objeto(payload[referencia]) && payload[referencia].id) pendencias.push(`REFERENCIA_${referencia.toUpperCase()}`);
    }
    if (Array.isArray(payload.fornecedores) && payload.fornecedores.length) pendencias.push("REFERENCIA_FORNECEDORES");
    if (objeto(payload.dimensoes) && objeto(payload.dimensoes.embalagem) && payload.dimensoes.embalagem.id) pendencias.push("REFERENCIA_EMBALAGEM");
    if (Array.isArray(payload.anexos) && payload.anexos.length) pendencias.push("IMAGENS_REQUEREM_VALIDACAO");
  } else if (entidade === "CONTATO" || entidade === "VENDEDOR") {
    const fonte = entidade === "VENDEDOR" ? payload.contato : payload;
    if (!objeto(fonte)) return falhaContrato();
    campos = projetarTextos(fonte, TEXTOS_CONTATO, completo);
    chave = normalizarDocumento(fonte.cpfCnpj);
    if (chave) campos.cpfCnpj = chave;
    nome = texto(fonte.nome) ?? "";
    for (const campo of ["endereco", "enderecoCobranca"] as const) {
      if (completo || campo in fonte) campos[campo] = estruturaTextos(fonte[campo], ENDERECO);
    }
    if (objeto(fonte.vendedor) && fonte.vendedor.id) pendencias.push("REFERENCIA_VENDEDOR");
    if (Array.isArray(fonte.tipos) && fonte.tipos.length) pendencias.push("REFERENCIA_TIPOS_CONTATO");
    // Acesso ao sistema (A) não é uma propriedade transferível; B também é ativo.
    if (situacao === "A") situacao = "B";
  } else {
    nome = texto(payload.nome) ?? "";
    campos = { nome };
    // Forma de pagamento não oferece chave global confiável no contrato público.
  }
  if (!chave && entidade !== "FORMA_PAGAMENTO") pendencias.push("IDENTIDADE_AUSENTE_OU_INVALIDA");
  if (!nome.trim()) pendencias.push("NOME_OBRIGATORIO");
  const alterado = payload.dataAlteracao ?? payload.dataAtualizacao;
  const alteradoEm = alterado === null || alterado === undefined ? null : texto(alterado);
  return { id, chave, nome, situacao, alteradoEm, tipo, paiId, completo, campos, pendencias };
}

export function gerarHashesCampos(campos: CamposSync, hash: (valor: JsonValue) => string): Record<string, string> {
  return Object.fromEntries(Object.keys(campos).sort().map(campo => [campo, hash(campos[campo])]));
}

export function inferirOrigem(replicas: ReplicaComparacao[], visaoCompleta: boolean, anterior?: OrigemSync): OrigemSync {
  if (anterior) return anterior;
  const presentes = replicas.filter(replica => replica.observacao !== null);
  if (visaoCompleta && presentes.length === 1 && presentes[0].observacao?.completo &&
    !presentes[0].observacao.pendencias.some(p=>p.includes("IDENTIDADE")||p.includes("DUPLICIDADE")||p==="LIMITE_OBSERVACOES")) {
    return { tipo: "OBSERVADA_PELO_MODULO", aplicativoId: presentes[0].aplicativoId };
  }
  return { tipo: "DESCONHECIDA", aplicativoId: null };
}

function estaAtivo(entidade: EntidadeSync, situacao: string): boolean {
  return entidade === "PRODUTO" ? situacao === "A" : entidade === "FORMA_PAGAMENTO" ? situacao === "1" : situacao === "B" || situacao === "A";
}

export function avaliarReplicas(entrada: {
  entidade: EntidadeSync;
  replicas: ReplicaComparacao[];
  hashesBase: Record<string, string> | null;
  visaoCompleta: boolean;
  hash: (valor: JsonValue) => string;
}): DecisaoSync {
  const { entidade, replicas, hashesBase, hash } = entrada;
  const motivos: string[] = [];
  const presentes = replicas.flatMap(replica => replica.observacao ? [{ aplicativoId: replica.aplicativoId, observacao: replica.observacao }] : []);
  const bloqueada = (): DecisaoSync => ({ status: "AGUARDANDO_REVISAO", motivos: [...new Set(motivos)], campos: null, hashes: {}, fontesPorCampo: {}, aplicativosCriar: [], aplicativosAtualizar: [] });
  if (!entrada.visaoCompleta || replicas.length < 2 || presentes.some(item => !item.observacao.completo)) motivos.push("AUDITORIA_INCOMPLETA");
  if (new Set(replicas.map(replica => replica.aplicativoId)).size !== replicas.length) motivos.push("REPLICA_DUPLICADA");
  if (!presentes.length) motivos.push("REGISTRO_AUSENTE");
  if (replicas.some(replica => replica.existia && !replica.observacao)) motivos.push("REGISTRO_REMOVIDO");
  if (presentes.some(item => !estaAtivo(entidade, item.observacao.situacao))) motivos.push("REGISTRO_INATIVO");
  const chaves = new Set(presentes.map(item => item.observacao.chave));
  if (chaves.size !== 1 || chaves.has(null)) motivos.push("IDENTIDADE_REQUER_REVISAO");
  for (const item of presentes) motivos.push(...item.observacao.pendencias.filter(codigo => !codigo.startsWith("REFERENCIA_") && codigo !== "IMAGENS_REQUEREM_VALIDACAO"));
  if (motivos.length) return bloqueada();
  const campos: CamposSync = {};
  const fontesPorCampo: Record<string, string[]> = {};
  const nomesCampos = new Set([...Object.keys(hashesBase ?? {}), ...presentes.flatMap(item => Object.keys(item.observacao.campos))]);
  for (const campo of nomesCampos) {
    if (presentes.some(item => !(campo in item.observacao.campos))) {
      motivos.push(`CAMPO_INCOMPLETO:${campo}`);
      continue;
    }
    const valores = presentes.map(item => ({ aplicativoId: item.aplicativoId, valor: item.observacao.campos[campo], hash: hash(item.observacao.campos[campo]) }));
    const valoresDistintos = new Set(valores.map(item => item.hash));
    const hashBase = hashesBase?.[campo];
    if (hashBase === undefined && valoresDistintos.size > 1) { motivos.push(`DIVERGENCIA_INICIAL:${campo}`); continue; }
    const alterados = hashBase === undefined ? valores : valores.filter(item => item.hash !== hashBase);
    if (new Set(alterados.map(item => item.hash)).size > 1) { motivos.push(`CONFLITO:${campo}`); continue; }
    if (hashBase !== undefined && alterados.length && (IDENTIDADE.has(campo) || (campo === "gtin" && hashBase !== hash(null) && hashBase !== hash("")))) {
      motivos.push(`CAMPO_PROTEGIDO:${campo}`);
      continue;
    }
    const candidatos = alterados.length ? alterados : valores;
    if (campo === "imagens" && hashBase !== undefined && alterados.length) {
      motivos.push("SUBRECURSO_REQUER_VALIDACAO:imagens");
      continue;
    }
    campos[campo] = candidatos[0].valor;
    fontesPorCampo[campo] = candidatos.map(item => item.aplicativoId).sort();
  }
  if (motivos.length) return bloqueada();
  const aplicativosCriar = replicas.filter(item => !item.observacao).map(item => item.aplicativoId);
  const aplicativosAtualizar = presentes.filter(item => serializarCanonico(item.observacao.campos) !== serializarCanonico(campos)).map(item => item.aplicativoId);
  if (aplicativosCriar.length) {
    for (const item of presentes) motivos.push(...item.observacao.pendencias.filter(codigo => codigo.startsWith("REFERENCIA_") || codigo === "IMAGENS_REQUEREM_VALIDACAO"));
  }
  if ((aplicativosCriar.length || aplicativosAtualizar.length) && !CAPACIDADES_SYNC[entidade].criar) motivos.push("ENTIDADE_SOMENTE_LEITURA");
  if (motivos.length) return bloqueada();
  return {
    status: aplicativosCriar.length || aplicativosAtualizar.length ? "PROPAGAR" : "SINCRONIZADO",
    motivos: [], campos, hashes: gerarHashesCampos(campos, hash), fontesPorCampo, aplicativosCriar, aplicativosAtualizar,
  };
}

/** Reconstrói o payload: nunca espalha o objeto obtido da outra conta. */
export function prepararPayload(entidade: EntidadeSync, campos: CamposSync, opcoes: { operacao: "CRIAR" | "ATUALIZAR" }): CamposSync {
  if (entidade !== "PRODUTO" && entidade !== "CONTATO") throw new FalhaSync("SOMENTE_LEITURA", "A API desta entidade permite somente auditoria.");
  if (entidade === "PRODUTO") {
    const payload = projetarTextos(campos, TEXTOS_PRODUTO, false);
    if (typeof payload.sku !== "string" || !payload.sku.trim() || typeof payload.descricao !== "string" || !payload.descricao.trim()) {
      throw new FalhaSync("OBRIGATORIOS", "O produto precisa de SKU e descrição para sincronização.");
    }
    if ((opcoes.operacao === "CRIAR" || campos.tipo !== undefined) && campos.tipo !== "S" && campos.tipo !== "M") throw new FalhaSync("ESTRUTURA_REQUER_MAPEAMENTO", "A estrutura do produto exige validação e mapeamento de dependências.");
    if (campos.tipoVariacao === "V" || (Array.isArray(campos.grade) && campos.grade.length)) {
      throw new FalhaSync("VARIACAO_REQUER_VALIDACAO", "Variações devem utilizar o contrato específico validado.");
    }
    if (opcoes.operacao === "CRIAR" && Array.isArray(campos.imagens) && campos.imagens.length) {
      throw new FalhaSync("IMAGENS_REQUEREM_VALIDACAO", "A criação deste produto exige validação e aplicação das imagens pelo subrecurso específico.");
    }
    if ("dimensoes" in campos) payload.dimensoes = dimensoes(campos.dimensoes);
    if ("seo" in campos) payload.seo = seo(campos.seo);
    if (opcoes.operacao === "CRIAR") payload.tipo = campos.tipo;
    return payload;
  }
  const payload = projetarTextos(campos, TEXTOS_CONTATO, false);
  const documento = normalizarDocumento(payload.cpfCnpj);
  if (!documento || typeof payload.nome !== "string" || !payload.nome.trim()) throw new FalhaSync("OBRIGATORIOS", "O contato precisa de nome e documento válido.");
  if ((documento.length === 11 && payload.tipoPessoa !== "F") || (documento.length === 14 && payload.tipoPessoa !== "J")) {
    throw new FalhaSync("IDENTIDADE_INCOMPATIVEL", "O tipo de pessoa não corresponde ao documento.");
  }
  payload.cpfCnpj = documento;
  for (const campo of ["endereco", "enderecoCobranca"] as const) if (campo in campos) payload[campo] = estruturaTextos(campos[campo], ENDERECO);
  if (opcoes.operacao === "CRIAR") payload.situacao = "B";
  return payload;
}

export function prepararImagens(valor: JsonValue, contratoValidado: boolean): CamposSync[] {
  if (!contratoValidado) throw new FalhaSync("IMAGENS_REQUEREM_VALIDACAO", "Valide o contrato de imagens antes de aplicar alterações.");
  if (!Array.isArray(valor) || valor.length > 50) throw new FalhaSync("IMAGENS_INVALIDAS", "A lista de imagens é inválida.");
  return valor.map(item => {
    if (!objeto(item) || typeof item.url !== "string" || item.url.length > 4096 || typeof item.externo !== "boolean") return falhaContrato();
    let url: URL;
    try { url = new URL(item.url); } catch { return falhaContrato(); }
    // URLs internas, credenciais e esquemas executáveis nunca são encaminhados ao ERP.
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || !host.includes(".") ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[") || /\.(localhost|local|internal)$/.test(host)) {
      throw new FalhaSync("IMAGEM_URL_INVALIDA", "A imagem precisa de uma URL HTTPS pública.");
    }
    return { url: url.toString(), externo: item.externo };
  });
}

export function prepararVariacao(campos: CamposSync, contratoValidado: boolean): CamposSync {
  if (!contratoValidado) throw new FalhaSync("VARIACAO_REQUER_VALIDACAO", "Valide o contrato de variações antes de aplicar alterações.");
  const payload = projetarTextos(campos, ["sku", "gtin"], false);
  if (typeof payload.sku !== "string" || !payload.sku.trim()) throw new FalhaSync("OBRIGATORIOS", "A variação precisa de SKU.");
  const combinacao = grade(campos.grade);
  if (!Array.isArray(combinacao) || !combinacao.length) throw new FalhaSync("OBRIGATORIOS", "A variação precisa de uma grade validada.");
  payload.grade = combinacao;
  return payload;
}
