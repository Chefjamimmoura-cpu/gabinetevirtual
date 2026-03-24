import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * GET /api/cadin/birthdays?month=3&day=15
 * GET /api/cadin/birthdays?month=all
 *
 * Retorna aniversariantes usando a nova coluna "birthday" (cadastro_v2).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const monthParam = searchParams.get('month');
    const dayParam   = searchParams.get('day');

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Modo "all": retorna as contagens por mês para o gráfico de barras
    if (monthParam === 'all') {
      const { data, error } = await supabase
        .from('cadin_persons')
        .select('birthday')
        .not('birthday', 'is', null);

      if (error) throw error;

      // Monta as contagens de 1 a 12
      const stats = Array.from({ length: 12 }, () => 0);
      (data || []).forEach(p => {
        const m = parseInt(p.birthday.substring(0, 2), 10);
        if (m >= 1 && m <= 12) {
          stats[m - 1]++;
        }
      });

      return NextResponse.json({ stats });
    }

    // Modo normal: busca por um mês específico
    const today = new Date();
    const month = monthParam
      ? parseInt(monthParam).toString().padStart(2, '0')
      : (today.getMonth() + 1).toString().padStart(2, '0');

    // birthday format is MM-DD
    const { data: persons, error } = await supabase
      .from('cadin_persons')
      .select(`
        id,
        full_name,
        phone,
        email,
        party,
        birthday,
        chefe_gabinete,
        nome_parlamentar,
        cadin_appointments (
          id,
          title,
          active,
          cadin_organizations ( id, name, acronym, type, sphere, phone, email, address )
        )
      `)
      .like('birthday', `${month}-%`);

    if (error) throw error;

    let result = (persons || []).map(p => {
      const activeAppt = (p.cadin_appointments as any[])?.find(a => a.active);
      const org = activeAppt?.cadin_organizations;

      // Parse da data MM-DD
      const day = p.birthday ? parseInt(p.birthday.substring(3, 5)) : 99;

      return {
        id: p.id,
        full_name: p.nome_parlamentar || p.full_name,
        phone: p.phone || null,
        email: p.email || null,
        party: p.party || null,
        birthday_day: day,
        birthday_month: parseInt(month),
        birthday_display: p.birthday ? `${p.birthday.substring(3, 5)}/${month}` : null,
        cargo: activeAppt?.title || null,
        org_name: org ? (org.acronym ? `${org.name} (${org.acronym})` : org.name) : null,
        org_phone: org?.phone || null,
        org_email: org?.email || null,
        org_address: org?.address || null,
        org_sphere: org?.sphere || null,
        chefe_gab: p.chefe_gabinete,
      };
    });

    if (dayParam) {
      const dayNum = parseInt(dayParam);
      result = result.filter(p => p.birthday_day === dayNum);
    }

    result.sort((a, b) => a.birthday_day - b.birthday_day);

    return NextResponse.json({
      month: parseInt(month),
      day: dayParam ? parseInt(dayParam) : null,
      count: result.length,
      birthdays: result,
    });
  } catch (error) {
    console.error('Erro ao buscar aniversariantes:', error);
    return NextResponse.json({ error: 'Falha ao buscar aniversariantes' }, { status: 500 });
  }
}
