import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth-guard';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const url = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE || 'gabinete-carol';

  if (!url || !key) {
    return NextResponse.json({ error: 'Evolution API não configurada' }, { status: 500 });
  }

  try {
    const res = await fetch(`${url}/instance/logout/${instance}`, {
      method: 'DELETE',
      headers: { apikey: key },
    });

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json(
        { error: `Erro na Evolution API: ${res.statusText}`, details: errorText },
        { status: res.status }
      );
    }

    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: true, ...data });
  } catch {
    return NextResponse.json({ error: 'Falha ao conectar na Evolution API' }, { status: 500 });
  }
}
