-- Ajuste pontual baseado na auditoria de 2026-10-29.
-- Requer a estrutura existente; nao e uma migration de criacao inicial.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Nao restaura as colunas OAuth antigas: a integracao atual usa variaveis de ambiente.
-- Nenhum turno/horario e inventado. A tela legada requer uma API autenticada
-- antes de voltar a operar: nao liberar acesso direto de anon/authenticated.
CREATE TABLE IF NOT EXISTS public.turnos_producao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aplicativo_id UUID NOT NULL REFERENCES public.aplicativo(id) ON DELETE RESTRICT,
  hora_inicio TIME NOT NULL,
  hora_fim TIME NOT NULL,
  inicia_dia_anterior BOOLEAN NOT NULL DEFAULT false,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_turnos_producao_aplicativo_id
  ON public.turnos_producao (aplicativo_id);
ALTER TABLE public.turnos_producao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.turnos_producao FROM PUBLIC, anon, authenticated;

COMMIT;
