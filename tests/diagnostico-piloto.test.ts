import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { descreverErroPiloto, ErroEntradaPiloto } from "../src/services/diagnosticoPilotoEstampas";
import { CarregarPreviewEstampaError } from "../src/services/carregarPreviewEstampaService";

test("diagnóstico identifica amostra ausente, JSON inválido e permissão", () => {
  assert.match(descreverErroPiloto({ code: "ENOENT", message: "segredo" }), /Arquivo de amostra não encontrado/u);
  assert.match(descreverErroPiloto(new SyntaxError("conteúdo privado")), /JSON da amostra inválido/u);
  assert.match(descreverErroPiloto({ code: "EACCES" }), /Sem permissão/u);
  assert.equal(descreverErroPiloto(new ErroEntradaPiloto("IDs duplicados")), "IDs duplicados");
});

test("diagnóstico não expõe URLs ou valores de validação", () => {
  const segredo = "https://privado.example/?token=SECRETO";
  const preview = new CarregarPreviewEstampaError(segredo, { code: "INVALID_URL", details: { url: segredo } });
  assert.match(descreverErroPiloto(preview), /INVALID_URL/u);
  assert.ok(!descreverErroPiloto(preview).includes(segredo));
  const result = z.enum(["permitido"]).safeParse(segredo);
  assert.ok(!result.success);
  if (!result.success) assert.ok(!descreverErroPiloto(result.error).includes("SECRETO"));
  assert.ok(!descreverErroPiloto(new Error(segredo)).includes("SECRETO"));
});
