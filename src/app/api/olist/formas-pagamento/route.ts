import { NextResponse } from "next/server";
export async function GET() { return NextResponse.json({ error: "Formas de pagamento desativadas. Utilize Formas de recebimento." }, { status: 410 }); }
