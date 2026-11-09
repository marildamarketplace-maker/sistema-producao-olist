BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.fila_mockups
  ADD COLUMN proxima_saida integer NOT NULL DEFAULT 0,
  ADD COLUMN tentativas integer NOT NULL DEFAULT 0,
  ADD COLUMN proxima_tentativa_em timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN reserva_id uuid,
  ADD COLUMN reserva_ate timestamptz,
  ADD COLUMN resultados jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN finalizado_em timestamptz,
  ADD CONSTRAINT fila_mockups_progresso_check CHECK (
    proxima_saida >= 0 AND tentativas >= 0 AND jsonb_array_length(resultados) = proxima_saida
    AND proxima_saida <= jsonb_array_length(trabalhos)
    AND ((status = 'PROCESSING' AND reserva_id IS NOT NULL AND reserva_ate IS NOT NULL)
      OR (status <> 'PROCESSING' AND reserva_id IS NULL AND reserva_ate IS NULL))
  );

DROP INDEX public.fila_mockups_pendentes_idx;
CREATE INDEX fila_mockups_pendentes_idx ON public.fila_mockups (aplicativo_id, proxima_tentativa_em, created_at)
  WHERE status = 'PENDING';
CREATE INDEX fila_mockups_reservas_idx ON public.fila_mockups (aplicativo_id, reserva_ate)
  WHERE status = 'PROCESSING';

COMMIT;
