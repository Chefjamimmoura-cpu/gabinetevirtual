import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { createRateLimiter } from '@/lib/rate-limit';

const billingLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

/**
 * POST /api/billing/webhook
 * Webhook da Stripe — valida assinatura antes de processar.
 *
 * Requer STRIPE_WEBHOOK_SECRET no .env.
 * Se não configurado, rejeita todas as chamadas (fail closed).
 */
export async function POST(req: NextRequest) {
  // Rate limiting
  const rateLimited = billingLimiter.check(req);
  if (rateLimited) return rateLimited;

  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[BILLING] STRIPE_WEBHOOK_SECRET não configurado');
      return NextResponse.json({ error: 'Webhook não configurado' }, { status: 500 });
    }

    // Lê o body como texto para validar a assinatura
    const rawBody = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json({ error: 'Assinatura ausente' }, { status: 400 });
    }

    // Validação da assinatura Stripe (sem dependência do SDK)
    const elements = signature.split(',');
    const timestampStr = elements.find(e => e.startsWith('t='))?.slice(2);
    const signatures = elements
      .filter(e => e.startsWith('v1='))
      .map(e => e.slice(3));

    if (!timestampStr || signatures.length === 0) {
      return NextResponse.json({ error: 'Formato de assinatura inválido' }, { status: 400 });
    }

    // Verifica tolerância de tempo (5 minutos)
    const timestamp = parseInt(timestampStr, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 300) {
      return NextResponse.json({ error: 'Assinatura expirada' }, { status: 400 });
    }

    // Calcula HMAC esperado
    const signedPayload = `${timestampStr}.${rawBody}`;
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(signedPayload)
      .digest('hex');

    const isValid = signatures.some(sig =>
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSignature))
    );

    if (!isValid) {
      console.error('[BILLING] Assinatura Stripe inválida');
      return NextResponse.json({ error: 'Assinatura inválida' }, { status: 400 });
    }

    // Assinatura válida — processar evento
    const event = JSON.parse(rawBody);
    const type = event.type;

    if (type === 'payment_intent.succeeded' || type === 'checkout.session.completed') {
      const gabineteId = event.data?.object?.client_reference_id
        || event.data?.object?.metadata?.gabineteId;
      const tokensComprados = parseInt(
        event.data?.object?.metadata?.tokens || '0', 10
      );

      if (!gabineteId || !tokensComprados) {
        return NextResponse.json({ error: 'Metadados incompletos no evento' }, { status: 400 });
      }

      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );

      const { data: gab, error: fetchErr } = await supabase
        .from('gabinetes')
        .select('config_json')
        .eq('id', gabineteId)
        .single();

      if (fetchErr || !gab) {
        console.error('[BILLING] Gabinete não encontrado:', fetchErr);
        return NextResponse.json({ error: 'Gabinete não encontrado' }, { status: 404 });
      }

      const currentConfig = gab.config_json || {};
      if (!currentConfig.ia_config) {
        currentConfig.ia_config = { engine: 'gemini', monthly_quota: 1000000, tokens_used: 0 };
      }

      currentConfig.ia_config.monthly_quota += tokensComprados;

      const { error: updateErr } = await supabase
        .from('gabinetes')
        .update({ config_json: currentConfig })
        .eq('id', gabineteId);

      if (updateErr) {
        console.error('[BILLING] Falha ao creditar tokens:', updateErr);
        return NextResponse.json({ error: 'Falha ao gravar no BD' }, { status: 500 });
      }

      console.log(`[BILLING] +${tokensComprados} tokens creditados para ${gabineteId}`);
      return NextResponse.json({ received: true, credited: tokensComprados });
    }

    // Evento não tratado — ack sem erro
    return NextResponse.json({ received: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[BILLING] Erro no webhook:', message);
    return NextResponse.json({ error: 'Erro ao processar webhook' }, { status: 500 });
  }
}
