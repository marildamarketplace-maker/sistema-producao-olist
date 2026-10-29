-- Ajuste pontual baseado na auditoria de 2026-10-29.
-- Requer a estrutura existente; nao e uma migration de criacao inicial.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.notification ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification FROM PUBLIC, anon, authenticated;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notification'::regclass AND conname = 'notification_tentativas_check') THEN
    ALTER TABLE public.notification ADD CONSTRAINT notification_tentativas_check CHECK (tentativas >= 0) NOT VALID;
  END IF;
END
$migration$;
ALTER TABLE public.notification VALIDATE CONSTRAINT notification_tentativas_check;

COMMIT;
