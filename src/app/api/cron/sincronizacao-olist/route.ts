import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request:Request) {
  const secret=process.env.CRON_SECRET?.trim();
  if(!secret || request.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Não autorizado."},{status:401});
  try {
    const [{prisma},{clienteSync},{criarServicoOlistSync}]=await Promise.all([import("@/lib/prisma"),import("@/lib/olist-sync/cliente"),import("@/services/olist-sync-service")]);
    const resultado=await criarServicoOlistSync(prisma,clienteSync).executar(Date.now()+240_000);
    return NextResponse.json({ok:true,...resultado});
  }catch{return NextResponse.json({error:"Falha no processamento da sincronização."},{status:500});}
}
