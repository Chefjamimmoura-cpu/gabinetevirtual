import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { OFICIO_SYSTEM_PROMPT } from '@/lib/oficios/prompts';

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { destinatario, cargo, assunto, mensagem } = body;

    if (!destinatario || !assunto || !mensagem) {
      return NextResponse.json({ error: 'Campos obrigatórios faltando' }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const gemini = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: OFICIO_SYSTEM_PROMPT,
      generationConfig: {
        temperature: 0.2, // Baixa temperatura para manter a formalidade e precisão
        maxOutputTokens: 2048,
        responseMimeType: "application/json", // Forçamos a saída em JSON nativo
      },
    });

    const userContext = `
Destinatário: ${destinatario}
Cargo do Destinatário: ${cargo || 'Não especificado'}
Assunto Original: ${assunto}
Mensagem Bruta / Pedido: ${mensagem}
`;

    const result = await gemini.generateContent(userContext);
    const responseText = result.response.text();
    
    // O Gemini retorna o JSON garantido devido ao responseMimeType
    const aiData = JSON.parse(responseText);

    // Gerar data atual dinâmica formatada
    // Gerar data atual dinâmica formatada estritamente em DD/MM/YYYY
    const hoje = new Date();
    const dia = String(hoje.getDate()).padStart(2, '0');
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const ano = hoje.getFullYear();
    const dataFormatada = `Boa Vista - RR, ${dia}/${mes}/${ano}.`;

    // Gerar um número de ofício placeholder (V3 terá controle real no banco)
    const numAleatorio = Math.floor(Math.random() * 900) + 100;

    // Retornamos os dados mapeados para o Dashboard
    return NextResponse.json({
      numero: `${numAleatorio}/${hoje.getFullYear()}`,
      cidadeData: dataFormatada,
      pronomeTratamento: aiData.pronomeTratamento || 'A Sua Excelência o Senhor',
      destinatarioFinal: destinatario,
      cargoFinal: cargo || '',
      assuntoOficial: aiData.assuntoRevisado || assunto.toUpperCase(),
      corpo: `${aiData.corpoTexto}\n\n${aiData.fecho}`,
      assinaturaNome: 'CAROL DANTAS',
      assinaturaCargo: 'Vereadora - Boa Vista/RR'
    });

  } catch (err) {
    console.error('Erro na geração de ofício:', err);
    return NextResponse.json({ error: 'Falha ao gerar o ofício' }, { status: 500 });
  }
}
