CREATE TABLE "acesso_pagina_usuario" (
  "usuario_id" UUID NOT NULL REFERENCES "usuario"("id") ON DELETE CASCADE,
  "pagina" VARCHAR(160) NOT NULL,
  "acessos" INTEGER NOT NULL DEFAULT 1 CHECK ("acessos" > 0),
  "ultimo_acesso" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("usuario_id", "pagina")
);
ALTER TABLE "acesso_pagina_usuario" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "acesso_pagina_usuario" FROM anon, authenticated;
