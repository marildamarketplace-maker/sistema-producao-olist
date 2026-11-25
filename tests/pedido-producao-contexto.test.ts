import assert from "node:assert/strict";
import test from "node:test";
import { assinarConsultaProducao, lerConsultaProducao, ErroContextoConsultaProducao } from "../src/lib/pedido-producao-contexto";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const contexto = { usuarioId:id(1), aplicativoSolicitanteId:id(2), solicitacaoId:id(3), referenciaId:id(4), destinoId:id(5), matrizId:id(6),
  vendedorOrigemId:10, clienteOrigemId:20, vendedorDestinoId:30, vinculosVersao:1, podeSelecionarFilial:false, regraTipo:"PADRAO" as const, regraVersao:2 };

test("contexto de leitura tem validade curta e assinatura sem nomes/documentos/credenciais", () => {
  process.env.OLIST_OAUTH_STATE_SECRET = "test-pedido-producao-secret-32-characters";
  const agora = 1_000_000;
  const token = assinarConsultaProducao(contexto, agora);
  assert.deepEqual(lerConsultaProducao(token, agora), { ...contexto, expiraEm: agora+120_000 });
  assert.throws(() => lerConsultaProducao(token, agora+120_000), ErroContextoConsultaProducao);
  assert.throws(() => lerConsultaProducao(token, agora-1), ErroContextoConsultaProducao);
  assert.throws(() => lerConsultaProducao(`${token}.x`, agora), ErroContextoConsultaProducao);
  const [corpo, assinatura] = token.split(".");
  const adulterado = Buffer.from(JSON.stringify({ ...contexto, destinoId:id(99), expiraEm:agora+120_000 })).toString("base64url");
  assert.throws(() => lerConsultaProducao(`${adulterado}.${assinatura}`, agora), ErroContextoConsultaProducao);
  assert.throws(() => lerConsultaProducao(`${corpo}.x`, agora), ErroContextoConsultaProducao);
  const dados = Buffer.from(corpo,"base64url").toString("utf8");
  assert.doesNotMatch(dados, /cpf|nome|secret|Bearer/i);
});
