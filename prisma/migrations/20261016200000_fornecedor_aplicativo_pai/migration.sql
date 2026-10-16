-- Idempotente: permite sincronizar o histórico Prisma após aplicação pelo painel/MCP.
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS aplicativo_pai_id UUID;

UPDATE public.fornecedores
SET aplicativo_pai_id = '00000000-0000-0000-0000-000000000002'
WHERE aplicativo_pai_id IS NULL;

ALTER TABLE public.fornecedores ALTER COLUMN aplicativo_pai_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.fornecedores'::regclass AND conname = 'fornecedores_aplicativo_pai_id_fkey') THEN
    ALTER TABLE public.fornecedores ADD CONSTRAINT fornecedores_aplicativo_pai_id_fkey
      FOREIGN KEY (aplicativo_pai_id) REFERENCES public.aplicativo(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_fornecedores_aplicativo_pai_id ON public.fornecedores(aplicativo_pai_id);

CREATE OR REPLACE FUNCTION public.validar_matriz_fornecedor() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM id FROM public.aplicativo WHERE id = NEW.aplicativo_pai_id AND aplicativo_pai_id IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O fornecedor deve estar vinculado a um aplicativo pai, não a uma filial.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validar_matriz_fornecedor() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS validar_matriz_fornecedor ON public.fornecedores;
CREATE TRIGGER validar_matriz_fornecedor BEFORE INSERT OR UPDATE OF aplicativo_pai_id
ON public.fornecedores FOR EACH ROW EXECUTE FUNCTION public.validar_matriz_fornecedor();

CREATE OR REPLACE FUNCTION public.proteger_matriz_com_fornecedores() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.aplicativo_pai_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.fornecedores WHERE aplicativo_pai_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Este aplicativo está vinculado como pai de fornecedores e não pode se tornar uma filial.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.proteger_matriz_com_fornecedores() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS proteger_matriz_com_fornecedores ON public.aplicativo;
CREATE TRIGGER proteger_matriz_com_fornecedores BEFORE UPDATE OF aplicativo_pai_id
ON public.aplicativo FOR EACH ROW EXECUTE FUNCTION public.proteger_matriz_com_fornecedores();
