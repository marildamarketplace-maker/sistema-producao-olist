import { agendarAutomatizacoes } from "@/lib/automatizacao/agendador";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    return Response.json({ processadas: await agendarAutomatizacoes() });
  } catch {
    return Response.json({ error: "Falha no agendamento." }, { status: 500 });
  }
}
