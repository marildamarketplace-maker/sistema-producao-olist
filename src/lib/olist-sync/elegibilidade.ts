type GrupoSync = {
  aplicativoPaiId: string;
  aplicativosBloqueados: readonly string[];
};

type AplicativoSync = {
  id: string;
  aplicativoPaiId: string | null;
};

// Elegibilidade não habilita participação nem concede acesso às credenciais.
// O chamador verifica também habilitado, permissões e jobs vigentes.
// Origem histórica é metadado e não faz parte desta decisão.
export function aplicativoElegivelSync(grupo: GrupoSync, aplicativo: AplicativoSync): boolean {
  return aplicativo.id !== grupo.aplicativoPaiId
    && aplicativo.aplicativoPaiId === grupo.aplicativoPaiId
    && !grupo.aplicativosBloqueados.includes(aplicativo.id);
}
