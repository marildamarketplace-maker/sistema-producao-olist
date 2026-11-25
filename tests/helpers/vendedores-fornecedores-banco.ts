import { readFile } from "node:fs/promises";
import type { BancoMemoria } from "./postgres-memoria";

export const idVendedorTeste = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
export const idsVendedores = {
  cliente: idVendedorTeste(1), matriz: idVendedorTeste(2), filial: idVendedorTeste(3),
  outroCliente: idVendedorTeste(4), outraMatriz: idVendedorTeste(5), neto: idVendedorTeste(6),
  usuario: idVendedorTeste(10), outroUsuario: idVendedorTeste(11), operador: idVendedorTeste(12),
  fornecedor: idVendedorTeste(20), duplicado: idVendedorTeste(21), outroFornecedor: idVendedorTeste(22),
};

/** Fixture descartável. Nunca usa URL ou schema da aplicação. */
export async function prepararBancoVendedores(db: Pick<BancoMemoria, "exec" | "query">) {
  await db.exec(`DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    END $$;
    CREATE TABLE aplicativo(id uuid PRIMARY KEY,nome text NOT NULL,aplicativo_pai_id uuid REFERENCES aplicativo(id));
    CREATE TABLE usuario(id uuid PRIMARY KEY,aplicativo_id uuid NOT NULL REFERENCES aplicativo(id),
      ativo boolean NOT NULL DEFAULT true,vendedor_olist_id integer);
    CREATE TABLE fornecedores(id uuid PRIMARY KEY,aplicativo_id uuid REFERENCES aplicativo(id),
      aplicativo_pai_id uuid NOT NULL REFERENCES aplicativo(id));
    GRANT UPDATE(aplicativo_id),INSERT(aplicativo_pai_id) ON fornecedores TO authenticated;
    CREATE TABLE pedido_fornecedor_solicitacao(id uuid PRIMARY KEY,fornecedor_id uuid REFERENCES fornecedores(id));
    CREATE TABLE produtos_fornecedor(id uuid PRIMARY KEY,fornecedor_id uuid REFERENCES fornecedores(id));
    CREATE TABLE pedido_fornecedor_queue(id uuid PRIMARY KEY,tipo_origem text NOT NULL,fornecedor_id uuid REFERENCES fornecedores(id) ON DELETE RESTRICT,
      solicitacao_producao_id uuid,autor_id uuid REFERENCES usuario(id),chave_idempotencia uuid,hash_entrada text,
      aplicativo_solicitante_id uuid NOT NULL REFERENCES aplicativo(id),aplicativo_fornecedor_id uuid NOT NULL REFERENCES aplicativo(id),
      status text NOT NULL DEFAULT 'PENDENTE',CONSTRAINT ck_fila_origem CHECK(true));
  `);
  const i = idsVendedores;
  await db.query("INSERT INTO aplicativo(id,nome) VALUES ($1,'Cliente'),($2,'Matriz'),($3,'Outro cliente'),($4,'Outra matriz')",
    [i.cliente,i.matriz,i.outroCliente,i.outraMatriz]);
  await db.query("INSERT INTO aplicativo VALUES ($1,'Filial',$2),($3,'Neto',$1)",[i.filial,i.matriz,i.neto]);
  await db.query("INSERT INTO usuario(id,aplicativo_id,vendedor_olist_id) VALUES ($1,$2,100),($3,$4,NULL),($5,$6,NULL)",
    [i.usuario,i.cliente,i.outroUsuario,i.outroCliente,i.operador,i.matriz]);
  for (const caminho of ["20261124223231_usuario_vendedor_olist", "20261125183000_vendedores_fornecedores_externos"]) {
    await db.exec(await readFile(new URL(`../../prisma/migrations/${caminho}/migration.sql`, import.meta.url), "utf8"));
  }
}

export async function cadastrarFornecedorTeste(db: Pick<BancoMemoria,"query">, id = idsVendedores.fornecedor,
  matriz = idsVendedores.matriz) {
  await db.query("INSERT INTO fornecedores(id,aplicativo_id,aplicativo_pai_id) VALUES($1,$2,$3)",
    [id,idsVendedores.cliente,matriz]);
}

export async function confirmarVendedorTeste(db: Pick<BancoMemoria,"query">, conta = idsVendedores.filial,
  matriz = idsVendedores.matriz, vendedor = 200) {
  await db.query(`INSERT INTO usuario_vendedor_olist(usuario_id,aplicativo_id,vendedor_olist_id,
    origem_aplicativo_id,fornecedor_matriz_id,confirmado_em,confirmado_por_id)
    VALUES($1,$2,$3,$4,$5,clock_timestamp(),$6)
    ON CONFLICT(usuario_id,aplicativo_id) DO UPDATE SET vendedor_olist_id=EXCLUDED.vendedor_olist_id,
      confirmado_em=EXCLUDED.confirmado_em,confirmado_por_id=EXCLUDED.confirmado_por_id,revogado_em=NULL,motivo_revogacao=NULL`,
    [idsVendedores.usuario,conta,vendedor,idsVendedores.cliente,matriz,idsVendedores.operador]);
}
