import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { gabineteId, packageId, tokens } = await req.json();

    if (!gabineteId || !packageId || !tokens) {
      return NextResponse.json({ error: 'Dados insuficientes para a transação.' }, { status: 400 });
    }

    // 1. Verificação da Chave STRIPE
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      console.warn('⚠️ STRIPE_SECRET_KEY não encontrado. MCP do Stripe não configurado. Retornando Mock URL.');
      // Stub session for testing/showcase purposes
      return NextResponse.json({ 
        url: `/configuracoes?checkout_success=true&mock_package=${packageId}`,
        message: 'Modo de testes ativado (sem chave Stripe).' 
      });
    }

    // 2. Integração real com o Stripe usando fetch REST ou SDK oficial (stubs)
    // Para simplificar a demonstração inicial e focar no MCP futuro, criaremos uma tentativa de inicializar sessão
    // A implementação abaixo assume que no futuro a bibliota "stripe" será instalada, mas para evitar throw erro de import:
    try {
      // NOTE: Here we would use the actual stripe SDK via dynamically imported MCP
      const stripeHeaders = {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      };

      const preco = packageId === 'pkg_1m' ? 8900 : 39900; // Centavos

      const urlParams = new URLSearchParams();
      urlParams.append('success_url', `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/configuracoes?success=true&session_id={CHECKOUT_SESSION_ID}`);
      urlParams.append('cancel_url', `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/configuracoes?canceled=true`);
      urlParams.append('payment_method_types[0]', 'card');
      urlParams.append('payment_method_types[1]', 'pix'); // Suporte a PIX no Stripe Brasil
      urlParams.append('mode', 'payment');
      urlParams.append('client_reference_id', gabineteId);
      urlParams.append('metadata[packageId]', packageId);
      urlParams.append('metadata[tokens]', String(tokens));

      urlParams.append('line_items[0][price_data][currency]', 'brl');
      urlParams.append('line_items[0][price_data][product_data][name]', `Pacote de Inteligência Artificial: ${tokens / 1000000} Milhão de Tokens (ALIA)`);
      urlParams.append('line_items[0][price_data][unit_amount]', String(preco));
      urlParams.append('line_items[0][quantity]', '1');

      const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: stripeHeaders,
        body: urlParams
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Erro na API Stripe:', errorData);
        throw new Error(errorData.error?.message || 'Erro ao comunicar com Stripe');
      }

      const session = await response.json();
      return NextResponse.json({ url: session.url });

    } catch (paymentError: any) {
      console.error(paymentError);
      return NextResponse.json({ error: paymentError.message }, { status: 500 });
    }

  } catch (err: any) {
    console.error('Erro geral Checkout:', err);
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 });
  }
}
