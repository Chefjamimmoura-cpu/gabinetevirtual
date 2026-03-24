import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Rota POST pública que o servidor da Stripe vai bater quando o cartão for aprovado
export async function POST(req: Request) {
  try {
    // 1. Em um cenário real de produção com MCP do Stripe rodando, 
    // usaríamos: const event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
    const body = await req.json();

    // Aceita chamadas diretas para recarga ou eventos via Stripe
    // Vamos lidar de forma agnóstica para fins de Mock/Debug inicial
    const type = body.type || 'payment_intent.succeeded'; 
    const gabineteId = body.client_reference_id || body.metadata?.gabineteId || body.gabineteId;
    const tokensComprados = parseInt(body.metadata?.tokens || body.tokens || '0', 10);

    if (type === 'payment_intent.succeeded' || type === 'checkout.session.completed' || body.mock_success) {
      if (!gabineteId || !tokensComprados) {
        return NextResponse.json({ error: 'Faltam metadados (gabinete_id ou tokens) no payload.' }, { status: 400 });
      }

      // Conexão administrativa com Supabase (bypass RLS)
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY! || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Ler config_json atual do gabinete
      const { data: gab, error: fetchErr } = await supabase
        .from('gabinetes')
        .select('config_json')
        .eq('id', gabineteId)
        .single();
        
      if (fetchErr || !gab) {
        console.error('Gabinete não encontrado para o Webhook', fetchErr);
        return NextResponse.json({ error: 'Gabinete não encontrado.' }, { status: 404 });
      }

      const currentConfig = gab.config_json || {};
      if (!currentConfig.ia_config) {
        currentConfig.ia_config = { engine: 'gemini', monthly_quota: 1000000, tokens_used: 0 };
      }

      // Somar os tokens
      currentConfig.ia_config.monthly_quota += tokensComprados;

      // Salvar de volta
      const { error: updateErr } = await supabase
        .from('gabinetes')
        .update({ config_json: currentConfig })
        .eq('id', gabineteId);

      if (updateErr) {
        console.error('Falha ao creditar tokens:', updateErr);
        return NextResponse.json({ error: 'Falha ao gravar no BD.' }, { status: 500 });
      }

      console.log(`[BILLING] Sucesso! +${tokensComprados} tokens debitados na conta ${gabineteId}.`);
      return NextResponse.json({ received: true, credited: tokensComprados });
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('Erro no Webhook Stripe:', err);
    return NextResponse.json({ error: 'Erro ao processar Webhook.', details: err.message }, { status: 500 });
  }
}
