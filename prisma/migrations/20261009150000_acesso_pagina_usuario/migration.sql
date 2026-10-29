-- Ajuste pontual baseado na auditoria de 2026-10-29.
-- Requer a estrutura existente; nao e uma migration de criacao inicial.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.acesso_pagina_usuario ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.acesso_pagina_usuario FROM PUBLIC, anon, authenticated;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.acesso_pagina_usuario'::regclass AND conname = 'acesso_pagina_usuario_acessos_check') THEN
    ALTER TABLE public.acesso_pagina_usuario ADD CONSTRAINT acesso_pagina_usuario_acessos_check CHECK (acessos > 0) NOT VALID;
  END IF;
END
$migration$;
ALTER TABLE public.acesso_pagina_usuario VALIDATE CONSTRAINT acesso_pagina_usuario_acessos_check;

COMMIT;
