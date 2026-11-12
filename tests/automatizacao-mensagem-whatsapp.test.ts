import assert from "node:assert/strict";
import { test } from "node:test";
import { mensagemWhatsappAutomatizacao } from "@/lib/automatizacao/mensagem-whatsapp";



test("mensagem usa título com rotina e corpo enxuto com execução em Brasília e resultado", () => {
  const mensagem = mensagemWhatsappAutomatizacao("responder-avaliacoes-marketplaces", true, "Shopee: 3 respostas confirmadas; fila vazia. TikTok Shop: 0; fila vazia.", new Date("2026-11-11T01:15:00Z"));
  assert.equal(mensagem.titulo, "✅ responder-avaliacoes-marketplaces");
  assert.equal(mensagem.mensagem, "Execução: 10/11/2026, 22:15\nResultado: Shopee: 3 respostas confirmadas; fila vazia. TikTok Shop: 0; fila vazia.");
});

test("falha inclui resultado com credenciais e e-mail omitidos", () => {
  const mensagem = mensagemWhatsappAutomatizacao("minha-rotina", false,
    "A ferramenta exige aprovação. token=privado cliente@example.com");
  assert.match(mensagem.mensagem, /Resultado: A ferramenta exige aprovação/);
  assert.doesNotMatch(mensagem.mensagem, /privado|cliente@example.com/);
  assert.match(mensagem.titulo, /❌ minha-rotina/);
});

test("códigos técnicos e UUIDs não são enviados", () => {
  for (const [codigo, humano] of [
    ["AUTHENTICATION_ERROR", /Login necessário/], ["RESERVA_EXPIRADA", /interrompida/],
    ["RATE_LIMIT", /Limite de uso/], ["CONFIGURATION_ERROR", /Ferramenta indisponível/],
    ["CAPTCHA", /Verificação de segurança/], ["SAIDA_INVALIDA", /Não foi possível concluir/],
  ] as const) {
    const { mensagem } = mensagemWhatsappAutomatizacao("Rotina 00000000-0000-0000-0000-000000000001", false, codigo);
    assert.match(mensagem, humano);
    assert.ok(!mensagem.includes(codigo));
    assert.doesNotMatch(mensagem, /00000000/);
  }
});


test("nome da rotina é sanitizado e limitado sem interpretar marcação", () => {
  const mensagem = mensagemWhatsappAutomatizacao("*Rotina*\n_Exemplo_ " + "x".repeat(200), true, "");
  assert.ok(mensagem.titulo.length <= 123);
  assert.doesNotMatch(mensagem.titulo, /[\r\n*_]/);
  assert.ok(mensagem.titulo.startsWith("✅ Rotina Exemplo "));
  assert.doesNotMatch(mensagem.mensagem, /Rotina:|Status:|Motivo:/);
});


test("resultado parcial mantém conquistas e pendência por canal", () => {
  const resultado = "Shopee: 4 respostas confirmadas; fila vazia.\nTikTok Shop: não verificado; login necessário.";
  const { mensagem } = mensagemWhatsappAutomatizacao("Avaliações | Shopee e TikTok Shop", false, resultado);
  assert.ok(mensagem.endsWith(`Resultado: ${resultado}`));
  assert.match(mensagem, /login necessário/);
});

test("resultado vazio tem fallback e resultado longo é limitado sem quebrar emojis", () => {
  assert.match(mensagemWhatsappAutomatizacao("Rotina", true, "  ").mensagem, /Resultado não informado/);
  const { mensagem } = mensagemWhatsappAutomatizacao("Rotina", true, "😀".repeat(4_000));
  const resultado = mensagem.split("Resultado: ")[1];
  assert.equal(Array.from(resultado).length, 3_000);
  assert.ok(resultado.endsWith("😀…"));
});

test("remove identificadores e controles sem eliminar quebras de linha úteis", () => {
  const { mensagem } = mensagemWhatsappAutomatizacao("Rotina", true,
    "Canal: concluído\r\n00000000-0000-0000-0000-000000000001\u0000\u202e");
  assert.match(mensagem, /Canal: concluído\n\[identificador omitido\]/);
  assert.doesNotMatch(mensagem, /00000000|[\u0000\u202e\r]/);
});


test("bloqueio externo usa aviso sem sinalizar erro ou sucesso", () => {
  const resultado = "Shopee: análise parcial; CAPTCHA. TikTok Shop: sem pendências.";
  const aviso = mensagemWhatsappAutomatizacao("Avaliar Chats | Shopee e TikTok Shop", false, resultado, new Date("2026-11-12T12:01:00Z"), true);
  assert.equal(aviso.titulo, "⚠️ Avaliar Chats | Shopee e TikTok Shop | Intervenção necessária");
  assert.doesNotMatch(aviso.titulo, /❌|✅/);
  assert.equal(aviso.mensagem, `Execução: 12/11/2026, 09:01\nResultado: ${resultado}`);
});
