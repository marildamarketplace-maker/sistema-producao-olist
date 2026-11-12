import assert from "node:assert/strict";
import { test } from "node:test";
import { mensagemWhatsappAutomatizacao } from "@/lib/automatizacao/mensagem-whatsapp";



test("mensagem usa título com rotina e corpo enxuto com execução em Brasília e resultado", () => {
  const mensagem = mensagemWhatsappAutomatizacao("responder-avaliacoes-marketplaces", true, "Shopee: 3 respostas confirmadas; fila vazia. TikTok Shop: 0; fila vazia.", new Date("2026-11-11T01:15:00Z"));
  assert.equal(mensagem.titulo, "✅ responder-avaliacoes-marketplaces");
  assert.equal(mensagem.mensagem, "10/11 · 22:15\nShopee: 3 respostas confirmadas; fila vazia. TikTok Shop: 0; fila vazia.");
});

test("falha inclui resultado com credenciais e e-mail omitidos", () => {
  const mensagem = mensagemWhatsappAutomatizacao("minha-rotina", false,
    "A ferramenta exige aprovação. token=privado cliente@example.com");
  assert.match(mensagem.mensagem, /A ferramenta exige aprovação/);
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
  assert.ok(mensagem.endsWith(resultado));
  assert.match(mensagem, /login necessário/);
});

test("resultado vazio tem fallback e resultado longo é limitado sem quebrar emojis", () => {
  assert.match(mensagemWhatsappAutomatizacao("Rotina", true, "  ").mensagem, /Resultado não informado/);
  const { mensagem } = mensagemWhatsappAutomatizacao("Rotina", true, "😀".repeat(4_000));
  assert.match(mensagem, /Tarefa concluída. Detalhes no histórico do ERP/);
  assert.ok(Array.from(mensagem).length < 400);
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
  assert.equal(aviso.titulo, "⚠️ Avaliar Chats");
  assert.doesNotMatch(aviso.titulo, /❌|✅/);
  assert.equal(aviso.mensagem, `12/11 · 09:01\n${resultado}`);
});

test("usa resumo próprio, sem levar o relatório completo ou links ao WhatsApp", () => {
  const detalhado = "Filtros, identidade da loja e detalhes de verificação. ".repeat(80);
  const resumo = "Shopee: sem pendências.\nTikTok: CAPTCHA.\nAção: concluir verificação no TikTok.";
  const aviso = mensagemWhatsappAutomatizacao("Avaliar Chats | Shopee e TikTok Shop", false, detalhado, new Date("2026-11-12T12:15:00Z"), true, resumo);
  assert.equal(aviso.titulo, "⚠️ Avaliar Chats");
  assert.equal(aviso.mensagem, `12/11 · 09:15\n${resumo}`);
  assert.ok(Array.from(`${aviso.titulo}\n${aviso.mensagem}`).length < 450);
  assert.doesNotMatch(aviso.mensagem, /Filtros|identidade/);
  const comLink = mensagemWhatsappAutomatizacao("Rotina", false, "Login necessário. https://seller.test/caminho?loja=123");
  assert.doesNotMatch(comLink.mensagem, /https|seller.test/);
});

test("relatório antigo longo não esconde bloqueio atrás de truncamento", () => {
  const aviso = mensagemWhatsappAutomatizacao("Ofertas | Shopee e TikTok", false, "Shopee: oferta preservada. ".repeat(60) + "TikTok: CAPTCHA.", new Date(), true);
  assert.match(aviso.mensagem, /Intervenção necessária/);
  assert.match(aviso.mensagem, /Verificação de segurança pendente/);
  assert.match(aviso.mensagem, /histórico do ERP/);
  assert.ok(Array.from(aviso.mensagem).length < 360);
});
