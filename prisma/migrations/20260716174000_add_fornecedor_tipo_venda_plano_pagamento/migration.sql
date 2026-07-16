ALTER TABLE "fornecedores"
ADD COLUMN "meu_tipo_venda_enum" "tipo_venda",
ADD COLUMN "meu_plano_pagamento_id" UUID;

ALTER TABLE "fornecedores"
ADD CONSTRAINT "fornecedores_meu_plano_pagamento_id_fkey"
FOREIGN KEY ("meu_plano_pagamento_id")
REFERENCES "plano_pagamento"("id")
ON DELETE SET NULL;

CREATE INDEX "idx_fornecedores_meu_plano_pagamento_id"
ON "fornecedores"("meu_plano_pagamento_id");
