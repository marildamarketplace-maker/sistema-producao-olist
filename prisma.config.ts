import "dotenv/config";
import { defineConfig, env } from "prisma/config";

function withSsl(connectionString: string) {
  const url = new URL(connectionString);
  url.searchParams.set("sslmode", "require");
  return url.toString();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: withSsl(env("POSTGRES_DIRECT_URL")),
  },
});