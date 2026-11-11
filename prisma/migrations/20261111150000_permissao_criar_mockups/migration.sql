-- Permissão independente, concedida explicitamente pela administração de usuários.
ALTER TABLE "usuario" ADD COLUMN "pode_criar_mockups" BOOLEAN NOT NULL DEFAULT false;
