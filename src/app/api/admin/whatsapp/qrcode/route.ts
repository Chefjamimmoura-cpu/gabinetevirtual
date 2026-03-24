import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE || 'gabinete-carol';

  if (!url || !key) {
    return NextResponse.json({ error: 'Evolution API não configurada' }, { status: 500 });
  }

  try {
    const res = await fetch(`${url}/instance/connect/${instance}`, {
      method: 'GET',
      headers: {
        'apikey': key,
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json({ error: `Erro na Evolution API: ${res.statusText}`, details: errorText }, { status: res.status });
    }

    const data = await res.json();
    
    // Se a instância já estiver conectada, a Evolution API normalmente retorna o status da conexão sem a propriedade base64
    // Se não estiver, ela retorna o base64 do QR code
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Falha ao conectar na Evolution API' }, { status: 500 });
  }
}
