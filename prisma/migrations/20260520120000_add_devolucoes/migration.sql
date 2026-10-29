-- Ajuste pontual baseado na auditoria de 2026-10-29.
-- Requer a estrutura existente; nao e uma migration de criacao inicial.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE INDEX IF NOT EXISTS idx_solicitacoes_devolucao_status_created
  ON public.solicitacoes_devolucao (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_itens_solicitacao_devolucao_solicitacao
  ON public.itens_solicitacao_devolucao (solicitacao_id);

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.itens_solicitacao_devolucao'::regclass AND conname = 'itens_solicitacao_devolucao_solicitacao_id_fkey') THEN
    ALTER TABLE public.itens_solicitacao_devolucao ADD CONSTRAINT itens_solicitacao_devolucao_solicitacao_id_fkey FOREIGN KEY (solicitacao_id) REFERENCES public.solicitacoes_devolucao(id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$migration$;
ALTER TABLE public.itens_solicitacao_devolucao VALIDATE CONSTRAINT itens_solicitacao_devolucao_solicitacao_id_fkey;

COMMIT;
