-- SOMENTE após as etapas de docs/vendedor-olist-multiempresa.md.
-- Exige OLIST_VENDEDORES_COMPAT_LEGADO=false em TODAS as instâncias e nenhum escritor antigo.
-- Não faz parte de migrate deploy: a execução em produção exige autorização específica.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.envio_fornecedor WHERE fila_id IS NULL AND estado IN ('RESERVADO','INCERTO')) THEN
    RAISE EXCEPTION 'Concilie envios diretos pendentes no destino original antes da contração';
  END IF;
END $$;
DROP TRIGGER usuario_vendedor_olist_ponte_insert ON public.usuario;
DROP TRIGGER usuario_vendedor_olist_ponte_update ON public.usuario;
DROP FUNCTION public.usuario_vendedor_olist_ponte_legada();
ALTER TABLE public.usuario DROP COLUMN vendedor_olist_id;
-- Configuração obsoleta; não afeta snapshots/payloads/autoria dos pedidos e envios.
ALTER TABLE public.fornecedores DROP COLUMN vendedor_olist_id;
COMMIT;
