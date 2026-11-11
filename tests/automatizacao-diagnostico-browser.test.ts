import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnosticoBrowser } from "@/lib/automatizacao/diagnostico-browser";

test("diagnóstico identifica causas de inicialização sem copiar a saída bruta", () => {
  for (const [saida, esperado] of [
    ["No usable sandbox!", "SANDBOX_BLOQUEADA"],
    ["Failed to move to new namespace: Operation not permitted", "SANDBOX_BLOQUEADA"],
    ["Missing X server or $DISPLAY", "TELA_INACESSIVEL"],
    ["Authorization required, but no authorization protocol specified", "TELA_INACESSIVEL"],
    ["ProcessSingleton: profile in use", "PERFIL_EM_USO"],
    ["error while loading shared libraries: libX.so", "BIBLIOTECA_AUSENTE"],
    ["permission denied", "PERMISSAO_NEGADA"],
    ["unknown option --flag", "VERSAO_INCOMPATIVEL"],
    ["outra falha", "CAUSA_NAO_CLASSIFICADA"],
  ]) {
    const resultado = diagnosticoBrowser(`${saida}\nhttps://privado.test/?token=SEGREDO cliente@example.com`);
    assert.ok(resultado.startsWith(esperado));
    assert.doesNotMatch(resultado, /SEGREDO|cliente@example.com|privado.test/);
  }
  assert.match(diagnosticoBrowser("", "EADDRINUSE"), /^PORTA_OCUPADA/);
  assert.match(diagnosticoBrowser("", "ENOENT"), /^INSTALACAO_INCOMPLETA/);
});
