-- Contração isolada, somente após a expansão de usuario_vendedor_olist.
-- Exige OLIST_VENDEDORES_COMPAT_LEGADO=false em TODAS as instâncias e nenhum escritor antigo.
-- SQL não verifica variáveis da aplicação. Não executar migrate deploy global.
-- A criação deste arquivo não autoriza sua aplicação em produção.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- O DROP já exige este lock; obtê-lo antes das verificações impede escritas legadas no intervalo.
LOCK TABLE public.usuario IN ACCESS EXCLUSIVE MODE;

DO $$ BEGIN
  IF to_regclass('public.usuario_vendedor_olist') IS NULL OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='usuario' AND column_name='vinculos_olist_versao'
  ) THEN
    RAISE EXCEPTION 'Aplique a expansão de usuario_vendedor_olist antes de remover o campo legado';
  END IF;
  IF EXISTS(SELECT 1 FROM public.envio_fornecedor WHERE fila_id IS NULL AND estado IN ('RESERVADO','INCERTO')) THEN
    RAISE EXCEPTION 'Concilie envios diretos pendentes no destino original antes da contração';
  END IF;
END $$;

-- Não recopia o escalar: após o corte, ele pode estar desatualizado ou ter sido removido
-- intencionalmente da associação. Não recriar vínculos nem sobrescrever IDs novos.
DROP TRIGGER usuario_vendedor_olist_ponte_insert ON public.usuario;
DROP TRIGGER usuario_vendedor_olist_ponte_update ON public.usuario;
DROP FUNCTION public.usuario_vendedor_olist_ponte_legada();
ALTER TABLE public.usuario DROP COLUMN vendedor_olist_id;

-- Preserva a associação normalizada, seus triggers e os campos de fornecedores/históricos.
COMMIT;
