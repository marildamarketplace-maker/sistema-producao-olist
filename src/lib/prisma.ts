import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function getPrismaConnectionString() {
  const connectionString = process.env.POSTGRES_PRISMA_URL;

  if (!connectionString) {
    throw new Error("POSTGRES_PRISMA_URL nao configurado.");
  }

  const url = new URL(connectionString);
  url.searchParams.set("sslmode", "no-verify");

  return url.toString();
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: getPrismaConnectionString(),
    }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
