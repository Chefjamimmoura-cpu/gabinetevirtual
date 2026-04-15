import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth-guard';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const url = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE || 'gabinete-carol';

  if (!url || !key) {
    return NextResponse.json({ error: 'Evolution API não configurada' }, { status: 500 });
  }

  try {
    const res = await fetch(`${url}/instance/connectionState/${instance}`, {
      method: 'GET',
      headers: {
        'apikey': key,
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
         return NextResponse.json({ state: 'open' }); // Se der 404 a instância pode estar connectState falhando de forma customizada ou offline, ajustando.
      }
      return NextResponse.json({ error: `Erro na Evolution API: ${res.statusText}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data?.instance || data);
  } catch (error) {
    return NextResponse.json({ error: 'Falha ao conectar na Evolution API' }, { status: 500 });
  }
}
