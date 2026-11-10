-- Promover para prisma/migrations junto com a retirada dos modelos, após
-- verificação de dependências, exportação e restauração em homologação.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TABLE public.ocorrencias_tarefas_midia;
DROP TABLE public.tarefas_midia;
DROP TABLE public.categorias_olist;
DROP TYPE public."StatusOcorrenciaTarefaMidia";
DROP TYPE public."PeriodicidadeTarefaMidia";
DROP TYPE public."PrioridadeTarefaMidia";

COMMIT;
