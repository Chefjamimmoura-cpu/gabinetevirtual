import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Função para enviar mensagem via Evolution API
async function sendWhatsAppMessage(to: string, text: string): Promise<boolean> {
  const url = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE || 'gabinete-carol';

  if (!url || !key) {
    console.error('ALIA CRON: Faltam credenciais EVOLUTION na ENV.');
    return false;
  }

  // Certificar que o número terminará com @s.whatsapp.net
  let number = to.trim();
  if (!number.endsWith('@s.whatsapp.net') && !number.endsWith('@g.us')) {
    number = `${number}@s.whatsapp.net`;
  }

  try {
    const res = await fetch(`${url}/message/sendText/${instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
      },
      body: JSON.stringify({
        number: number,
        text,
        delay: 1000,
      }),
    });
    return res.ok;
  } catch (error) {
    console.error('ALIA CRON: Falha na requisição para a Evolution API', error);
    return false;
  }
}

export async function GET(req: NextRequest) {
  // 1. Verificação de Autenticação Automática
  // Garante que só um CRON do Vercel ou alguém com o Secret consome a rota
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Supabase credentials missing' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 2. Coletando os Aniversariantes do Dia
  const today = new Date();
  const month = today.getMonth() + 1; // getMonth() é 0-indexado
  const day = today.getDate();

  try {
    const { data: persons, error } = await supabase
      .from('cadin_persons')
      .select(`
        id,
        full_name,
        birthday,
        phone,
        email,
        cadin_appointments (
          title,
          cadin_organizations (
            name,
            phone,
            email,
            address,
            neighborhood,
            city,
            state
          )
        )
      `)
      .eq('status', 'active');

    if (error) throw error;
    if (!persons || persons.length === 0) {
      return NextResponse.json({ ok: true, message: 'Nenhuma autoridade humana registrada ainda.' });
    }

    // Filtrar localmente os aniversariantes exatos de hoje
    const birthdayPersons = [];

    for (const person of persons) {
      if (!person.birthday) continue;
      
      const parts = person.birthday.split('-');
      if (parts.length >= 3) {
        const bMonth = parseInt(parts[1], 10);
        const bDay = parseInt(parts[2], 10);

        if (bMonth === month && bDay === day) {
          // Extraindo os dados do cargo primário (primeiro array se existir)
          const appt = person.cadin_appointments?.[0];
          const orgRaw = appt?.cadin_organizations;
          const org = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw;

          // Montar o endereço (se houver dados)
          let org_address = null;
          if (org?.address) {
            const locParams = [org.address, org.neighborhood, org.city, org.state].filter(Boolean);
            org_address = locParams.join(', ');
          }

          birthdayPersons.push({
            id: person.id,
            full_name: person.full_name,
            phone: person.phone,
            email: person.email,
            cargo: appt?.title || 'Autoridade / Liderança',
            org_name: org?.name || '',
            org_phone: org?.phone || null,
            org_email: org?.email || null,
            org_address: org_address
          });
        }
      }
    }

    // Se ninguém fizer aniversário hoje, sai silenciosamente sem enviar mensagens.
    if (birthdayPersons.length === 0) {
      return NextResponse.json({ ok: true, message: 'Nenhum aniversariante no dia de hoje.', day: day, month: month });
    }

    // 3. Compilando o Bloco de Mensagem IDÊNTICO ao do FrontEnd
    const messageText = `🎉 *Aniversariantes do dia!* 🎂\n\n` + 
      birthdayPersons.map((p) => {
        let card = `*${p.full_name}*\n` +
                   `  Cargo: ${p.cargo}${p.org_name ? ` · ${p.org_name}` : ''}\n`;
        
        if (p.phone || p.email) {
          card += `  📞 Pessoal: ${[p.phone, p.email].filter(Boolean).join(' | ')}\n`;
        }
        if (p.org_phone || p.org_email) {
          card += `  🏢 Órgão: ${[p.org_phone, p.org_email].filter(Boolean).join(' | ')}\n`;
        }
        if (p.org_address) {
          card += `  📍 Endereço: ${p.org_address}\n`;
        }
        return card;
      }).join(`\n━━━━━━━━━━━━━━━━━━━━━━\n\n`) +
      `\n_Mensagem automática ALIA — Gabinete Vereadora Carol Dantas_`;

    // 4. Distribuindo a mensagem para os números da Assessora e Vereadora definidos no ENV
    const notifyNumbersMap = process.env.ALIA_NOTIFY_NUMBERS;
    
    if (!notifyNumbersMap) {
       return NextResponse.json({ 
         ok: false, 
         error: 'ALIA_NOTIFY_NUMBERS não configurado no ENV.', 
         generatedText: messageText 
       });
    }

    // Separa e limpa os números divididos por vírgula
    const targetNumbers = notifyNumbersMap.split(',').map(n => n.trim()).filter(Boolean);
    const sentResults = [];

    for (const number of targetNumbers) {
      const delivered = await sendWhatsAppMessage(number, messageText);
      sentResults.push({ number, delivered });
    }

    return NextResponse.json({ 
      ok: true, 
      date: `${day}/${month}`,
      birthdaysFound: birthdayPersons.length,
      sentResults 
    });

  } catch (error: any) {
    console.error('Erro na cronjob de aniversariantes CADIN:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
