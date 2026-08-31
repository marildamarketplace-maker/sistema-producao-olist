import { z } from "zod";
import {
  CONTEUDO_POR_SUPORTE_APLICACAO,
  CONTEUDOS_IMAGEM_ESTAMPA,
  SUPORTES_APLICACAO_ESTAMPA,
  TIPOS_IMAGEM_ESTAMPA,
} from "@/domain/estampa-apresentacao";
import {
  AFINIDADES_VISUAIS_ESTAMPA,
  CONTEXTOS_USO_ESTAMPA,
  PUBLICOS_SUGERIDOS_ESTAMPA,
} from "@/domain/estampa-segmentacao";
import { PADROES_TEXTEIS_ESTAMPA } from "@/domain/estampa-taxonomia-textil";
import { normalizarTaxonomiasAnalise } from "@/services/normalizarTaxonomiaEstampa";

const texto = (campo: string, minimo: number, maximo: number) =>
  z
    .string({ error: `${campo} deve ser um texto.` })
    .trim()
    .min(minimo, `${campo} deve possuir ao menos ${minimo} caracteres.`)
    .max(maximo, `${campo} deve possuir no máximo ${maximo} caracteres.`);

const normalizarTermo = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");

const lista = (campo: string, minimo: number, maximo: number, tamanhoItem = 80) =>
  z
    .array(texto(`Item de ${campo}`, 2, tamanhoItem), {
      error: `${campo} deve ser uma lista.`,
    })
    .min(minimo, `${campo} deve possuir ao menos ${minimo} item(ns).`)
    .max(maximo, `${campo} deve possuir no máximo ${maximo} itens.`);

const descricaoVisualSchema = texto("descricao", 20, 500)
  .describe(
    "Descrição objetiva em português do Brasil, com 1 a 3 frases, baseada somente no que é visível na arte.",
  )
  .superRefine((descricao, context) => {
    const frases = descricao
      .split(/[.!?]+(?:\s+|$)/u)
      .map((frase) => frase.trim())
      .filter(Boolean);
    if (frases.length > 3) {
      context.addIssue({
        code: "custom",
        message: "descricao deve possuir no máximo 3 frases.",
      });
    }
  });

const palavrasChaveSchema = lista("palavrasChave", 5, 24, 50).describe(
  "Termos relevantes em português do Brasil para pesquisa interna: elementos, temas, estilos, cores, ocasiões e combinações visuais úteis. Sem termos genéricos, inventados ou duplicados.",
);

const coresPrincipaisSchema = lista("coresPrincipais", 1, 5, 30).describe(
  "Cores dominantes da composição, com nomes comuns em português do Brasil e sem códigos RGB ou pequenas variações desnecessárias.",
);

const coresSecundariasSchema = lista("coresSecundarias", 0, 6, 30).describe(
  "Cores visualmente relevantes usadas como apoio, detalhes ou acentos, sem repetir as cores principais.",
);

const elementosVisuaisGenericos = new Set([
  "componente",
  "elemento",
  "elemento visual",
  "objeto",
  "objeto decorativo",
]);

const elementosVisuaisSchema = lista("elementosVisuais", 1, 16, 60)
  .describe(
    "Objetos, símbolos, personagens e componentes reconhecíveis realmente visíveis na imagem, descritos em português do Brasil com nomes específicos e úteis para pesquisa.",
  )
  .superRefine((elementos, context) => {
    elementos.forEach((elemento, index) => {
      if (elementosVisuaisGenericos.has(normalizarTermo(elemento))) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "elementosVisuais deve usar um nome reconhecível e específico.",
        });
      }
    });
  });

const temaSchema = texto("tema", 2, 80).describe(
  "Conceito visual principal da estampa em português do Brasil. Deve ser sustentado pela imagem; quando não houver contexto temático específico, use o motivo visual predominante, como Floral, Geométrico ou Abstrato.",
);

const subtemasSchema = lista("subtemas", 0, 8, 80).describe(
  "Recortes mais específicos do tema principal claramente sustentados pela imagem. Use uma lista vazia quando não houver refinamentos visuais seguros.",
);

const categoriasSchema = lista("categorias", 1, 8, 50).describe(
  "Rótulos amplos, concisos e úteis para filtros do catálogo, derivados somente do conteúdo visual observado.",
);

const ocasioesSchema = lista("ocasioes", 0, 8, 80).describe(
  "Datas, campanhas, celebrações ou situações de uso reconhecíveis por evidência visual clara. Deve ser uma lista vazia quando a ocasião for apenas uma associação possível.",
);

const tipoImagemSchema = z.enum(TIPOS_IMAGEM_ESTAMPA).describe(
  "Forma predominante de apresentação da imagem: arte plana, layout composto, aplicação visível em produto ou indefinida.",
);

const conteudosImagemSchema = z
  .array(z.enum(CONTEUDOS_IMAGEM_ESTAMPA), {
    error: "conteudosImagem deve ser uma lista de conteúdos visuais reconhecidos.",
  })
  .min(1, "conteudosImagem deve possuir ao menos um item.")
  .max(9, "conteudosImagem deve possuir no máximo 9 itens.")
  .refine((itens) => new Set(itens).size === itens.length, {
    message: "conteudosImagem não deve possuir valores duplicados.",
  });

const descricaoAplicacaoSchema = texto("descricao da aplicação", 10, 240).nullable();

const aplicacaoVisualSchema = z
  .object({
    objetoFisicoVisivel: z.boolean({
      error: "aplicacaoVisual.objetoFisicoVisivel deve ser booleano.",
    }),
    presente: z.boolean({ error: "aplicacaoVisual.presente deve ser booleano." }),
    suporte: z.enum(SUPORTES_APLICACAO_ESTAMPA),
    descricao: descricaoAplicacaoSchema,
    evidencias: z
      .array(texto("Evidência da aplicação", 3, 100), {
        error: "aplicacaoVisual.evidencias deve ser uma lista.",
      })
      .max(6, "aplicacaoVisual.evidencias deve possuir no máximo 6 itens."),
  })
  .strict();

const sugestaoSegmentacaoSchema = <T extends readonly [string, ...string[]]>(
  termos: T,
  campo: string,
) =>
  z
    .object({
      termo: z.enum(termos).describe(`Termo controlado de ${campo}.`),
      confianca: z
        .number({ error: `A confiança de ${campo} deve ser numérica.` })
        .min(0)
        .max(1),
      evidencias: z
        .array(texto(`Evidência de ${campo}`, 3, 120), {
          error: `As evidências de ${campo} devem ser uma lista.`,
        })
        .min(1, `Uma sugestão de ${campo} deve possuir evidência visual.`)
        .max(4, `Uma sugestão de ${campo} deve possuir no máximo 4 evidências.`),
    })
    .strict();

const listaSegmentacao = <T extends z.ZodType>(schema: T, campo: string) =>
  z
    .array(schema, { error: `${campo} deve ser uma lista.` })
    .max(6, `${campo} deve possuir no máximo 6 itens.`)
    .superRefine((itens, context) => {
      const termos = new Set<string>();
      itens.forEach((item, index) => {
        const termo = String((item as { termo: string }).termo);
        if (termos.has(termo)) {
          context.addIssue({
            code: "custom",
            path: [index, "termo"],
            message: `${campo} não deve possuir termos duplicados.`,
          });
        }
        termos.add(termo);
      });
    });

const segmentacaoBuscaSchema = z
  .object({
    publicosSugeridos: listaSegmentacao(
      sugestaoSegmentacaoSchema(PUBLICOS_SUGERIDOS_ESTAMPA, "público sugerido"),
      "publicosSugeridos",
    ),
    contextosUso: listaSegmentacao(
      sugestaoSegmentacaoSchema(CONTEXTOS_USO_ESTAMPA, "contexto de uso"),
      "contextosUso",
    ),
    afinidadesVisuais: listaSegmentacao(
      sugestaoSegmentacaoSchema(AFINIDADES_VISUAIS_ESTAMPA, "afinidade visual"),
      "afinidadesVisuais",
    ),
  })
  .strict()
  .describe(
    "Sugestões opcionais para busca, sustentadas por evidências visuais. As três listas podem ficar vazias; não invente público ou contexto.",
  );

const classificacaoTextilSchema = z
  .object({
    padroesTexteis: listaSegmentacao(
      sugestaoSegmentacaoSchema(PADROES_TEXTEIS_ESTAMPA, "padrão têxtil"),
      "padroesTexteis",
    ),
  })
  .strict()
  .describe(
    "Classificação da linguagem visual usando vocabulário profissional de estampas e tecidos. A lista pode ficar vazia quando nenhum padrão controlado for seguro.",
  );

export const analiseVisualEstampaSchema = z
  .object({
    titulo: texto("titulo", 3, 100),
    descricao: descricaoVisualSchema,
    tema: temaSchema,
    subtemas: subtemasSchema,
    coresPrincipais: coresPrincipaisSchema,
    coresSecundarias: coresSecundariasSchema,
    elementosVisuais: elementosVisuaisSchema,
    palavrasChave: palavrasChaveSchema,
    ocasioes: ocasioesSchema,
    categorias: categoriasSchema,
    estilo: texto("estilo", 2, 100),
    tipoImagem: tipoImagemSchema,
    conteudosImagem: conteudosImagemSchema,
    aplicacaoVisual: aplicacaoVisualSchema,
    segmentacaoBusca: segmentacaoBuscaSchema,
    classificacaoTextil: classificacaoTextilSchema,
    confiancaTipoImagem: z
      .number({ error: "confiancaTipoImagem deve ser numérica." })
      .min(0, "confiancaTipoImagem não pode ser menor que 0.")
      .max(1, "confiancaTipoImagem não pode ser maior que 1."),
    confianca: z
      .number({ error: "confianca deve ser numérica." })
      .min(0, "confianca não pode ser menor que 0.")
      .max(1, "confianca não pode ser maior que 1."),
  })
  .strict()
  .superRefine((analise, context) => {
    const conteudos = new Set(analise.conteudosImagem);
    const aplicacao = analise.aplicacaoVisual;

    if (analise.tipoImagem === "ESTAMPA" && !conteudos.has("ESTAMPA")) {
      context.addIssue({
        code: "custom",
        path: ["conteudosImagem"],
        message: "Uma imagem do tipo ESTAMPA deve registrar o conteúdo ESTAMPA.",
      });
    }

    if (analise.tipoImagem === "ESTAMPA" && aplicacao.presente) {
      context.addIssue({
        code: "custom",
        path: ["tipoImagem"],
        message: "Uma imagem com aplicação visível não pode ser classificada como ESTAMPA plana.",
      });
    }

    if (analise.tipoImagem === "ESTAMPA" && aplicacao.objetoFisicoVisivel) {
      context.addIssue({
        code: "custom",
        path: ["tipoImagem"],
        message: "Uma imagem com objeto ou superfície física visível não pode ser ESTAMPA plana.",
      });
    }

    if (aplicacao.objetoFisicoVisivel !== aplicacao.presente) {
      context.addIssue({
        code: "custom",
        path: ["aplicacaoVisual", "presente"],
        message: "Objeto físico visível e presença de aplicação devem ser coerentes.",
      });
    }

    if (analise.tipoImagem === "APLICACAO_PRODUTO" && !aplicacao.presente) {
      context.addIssue({
        code: "custom",
        path: ["aplicacaoVisual", "presente"],
        message: "APLICACAO_PRODUTO exige uma aplicação visual presente.",
      });
    }

    if (aplicacao.presente) {
      if (aplicacao.suporte === "NAO_APLICAVEL") {
        context.addIssue({
          code: "custom",
          path: ["aplicacaoVisual", "suporte"],
          message: "Uma aplicação presente não pode usar o suporte NAO_APLICAVEL.",
        });
      }
      if (aplicacao.descricao === null) {
        context.addIssue({
          code: "custom",
          path: ["aplicacaoVisual", "descricao"],
          message: "Uma aplicação presente deve possuir descrição objetiva.",
        });
      }
      if (aplicacao.evidencias.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["aplicacaoVisual", "evidencias"],
          message: "Uma aplicação presente deve registrar ao menos uma evidência visual.",
        });
      }
      if (!conteudos.has("APLICACAO_PRODUTO")) {
        context.addIssue({
          code: "custom",
          path: ["conteudosImagem"],
          message: "Uma aplicação presente deve registrar APLICACAO_PRODUTO em conteudosImagem.",
        });
      }
      const conteudoEsperado = CONTEUDO_POR_SUPORTE_APLICACAO[aplicacao.suporte];
      if (conteudoEsperado && !conteudos.has(conteudoEsperado)) {
        context.addIssue({
          code: "custom",
          path: ["conteudosImagem"],
          message: `O suporte ${aplicacao.suporte} deve constar em conteudosImagem.`,
        });
      }
      const suportesVisiveis = [
        "MODELO_REAL",
        "MANEQUIM",
        "PRODUTO_ISOLADO",
        "AMBIENTE",
      ] as const;
      const quantidadeSuportesVisiveis = suportesVisiveis.filter((conteudo) =>
        conteudos.has(conteudo),
      ).length;
      if (aplicacao.suporte === "MISTO" && quantidadeSuportesVisiveis < 2) {
        context.addIssue({
          code: "custom",
          path: ["aplicacaoVisual", "suporte"],
          message: "O suporte MISTO exige ao menos duas formas de aplicação em conteudosImagem.",
        });
      }
      if (aplicacao.suporte !== "MISTO" && quantidadeSuportesVisiveis > 1) {
        context.addIssue({
          code: "custom",
          path: ["aplicacaoVisual", "suporte"],
          message: "Mais de uma forma de aplicação visível deve usar o suporte MISTO.",
        });
      }
    } else {
      if (aplicacao.suporte !== "NAO_APLICAVEL") {
        context.addIssue({
          code: "custom",
          path: ["aplicacaoVisual", "suporte"],
          message: "Uma imagem sem aplicação deve usar o suporte NAO_APLICAVEL.",
        });
      }
      if (aplicacao.descricao !== null) {
        context.addIssue({
          code: "custom",
          path: ["aplicacaoVisual", "descricao"],
          message: "Uma imagem sem aplicação deve usar descrição nula.",
        });
      }
      if (aplicacao.evidencias.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["aplicacaoVisual", "evidencias"],
          message: "Uma imagem sem aplicação deve usar uma lista de evidências vazia.",
        });
      }
      if (conteudos.has("APLICACAO_PRODUTO")) {
        context.addIssue({
          code: "custom",
          path: ["conteudosImagem"],
          message: "Uma imagem sem aplicação não pode registrar APLICACAO_PRODUTO.",
        });
      }
    }
  });

export type AnaliseVisualEstampa = z.infer<typeof analiseVisualEstampaSchema>;

export class AnaliseVisualEstampaInvalidaError extends Error {
  readonly code = "INVALID_AI_ANALYSIS_OUTPUT";
  readonly retriable = true;
  readonly issues: z.core.$ZodIssue[];

  constructor(issues: z.core.$ZodIssue[], cause?: unknown) {
    super("A IA retornou metadados visuais fora do schema esperado.", { cause });
    this.name = "AnaliseVisualEstampaInvalidaError";
    this.issues = issues;
  }
}

export function validarAnaliseVisualEstampa(value: unknown): AnaliseVisualEstampa {
  const result = analiseVisualEstampaSchema.safeParse(value);
  if (!result.success) {
    throw new AnaliseVisualEstampaInvalidaError(result.error.issues, result.error);
  }
  const normalizado = normalizarTaxonomiasAnalise(result.data);
  const normalizedResult = analiseVisualEstampaSchema.safeParse(normalizado);
  if (!normalizedResult.success) {
    throw new AnaliseVisualEstampaInvalidaError(
      normalizedResult.error.issues,
      normalizedResult.error,
    );
  }
  return normalizedResult.data;
}

export const analiseVisualEstampaStructuredOutput = {
  name: "analise_visual_estampa",
  jsonSchema: z.toJSONSchema(analiseVisualEstampaSchema),
  parse: validarAnaliseVisualEstampa,
};
