import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * GET /api/cadin/organizations?sort=caderno|az&sphere=federal|estadual|municipal&tipo=secretaria|...
 *
 * Retorna TODAS as pessoas ativas do CADIN com seu cargo e órgão.
 * - sort=caderno → ordem de inserção (sequência original do caderno físico)
 * - sort=az      → ordem alfabética por nome da pessoa
 * - sphere       → filtra por esfera governamental
 * - tipo         → filtra por tipo de órgão
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const { searchParams } = new URL(request.url);
    const sortMode = searchParams.get('sort') || 'caderno';
    const sphereFilter = searchParams.get('sphere') || '';
    const tipoFilter = searchParams.get('tipo') || '';

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Consulta principal: todos os appointments ativos ────────────────────
    let query = supabase
      .from('cadin_appointments')
      .select(`
        id,
        title,
        active,
        created_at,
        cadin_persons (
          id,
          full_name,
          phone,
          email,
          party,
          photo_url,
          notes,
          birthday,
          nome_parlamentar,
          chefe_gabinete
        ),
        cadin_organizations (
          id,
          name,
          acronym,
          type,
          sphere,
          phone,
          email,
          address
        )
      `)
      .eq('active', true)
      .order('created_at', { ascending: true });

    if (sphereFilter && ['federal', 'estadual', 'municipal'].includes(sphereFilter)) {
      // Filtro de esfera via join — precisa do relacionamento
      // Fazemos client-side após o fetch
    }

    const { data: appointments, error } = await query;
    if (error) throw error;

    let result = (appointments || [])
      .filter(a => a.cadin_persons && a.cadin_organizations)
      .map(a => {
        const person = a.cadin_persons as any;
        const org = a.cadin_organizations as any;

        // Aniversário: usa coluna dedicada (v2) ou fallback para notas legadas
        let birthday: string | null = null;
        if (person.birthday) {
          // Formato MM-DD → exibe DD/MM
          birthday = `${person.birthday.substring(3, 5)}/${person.birthday.substring(0, 2)}`;
        } else {
          const bdMatch = person.notes?.match(/Aniversário: (\d{2})-(\d{2})/);
          if (bdMatch) birthday = `${bdMatch[2]}/${bdMatch[1]}`;
        }

        // Chefe de gabinete: usa coluna dedicada (v2) ou fallback para notas legadas
        let chefeGab: string | null = person.chefe_gabinete || null;
        if (!chefeGab) {
          const cgMatch = person.notes?.match(/Chefe de Gabinete: ([^;]+)/);
          if (cgMatch) chefeGab = cgMatch[1].trim();
        }

        return {
          id: a.id,
          personId: person.id,
          orgId: org.id,
          photoUrl: person.photo_url || null,
          nomeOrgao: org.acronym ? `${org.name} (${org.acronym})` : org.name,
          orgName: org.name,
          orgAcronym: org.acronym || null,
          tipo: org.type,
          sphere: org.sphere || 'municipal',
          titularNome: person.nome_parlamentar || person.full_name,
          titularCargo: a.title,
          phone: person.phone || null,
          email: person.email || null,
          party: person.party || null,
          birthday,
          chefeGab,
          notes: person.notes || null,
          orgPhone: org.phone || null,
          orgEmail: org.email || null,
          orgAddress: org.address || null,
        };
      });

    // Filtros client-side (após join)
    if (sphereFilter) {
      result = result.filter(r => r.sphere === sphereFilter);
    }
    if (tipoFilter) {
      result = result.filter(r => r.tipo === tipoFilter);
    }

    // Ordenação A-Z por nome da pessoa
    if (sortMode === 'az') {
      result.sort((a, b) => (a.titularNome || '').localeCompare(b.titularNome || '', 'pt-BR'));
    }
    // 'caderno' já vem ordenado por created_at do Supabase

    // ── Contatos legados (V1) ────────────────────────────────────────────────
    const { data: legacyContacts } = await supabase
      .from('contatos')
      .select('id, nome, cargo, orgao, telefone, email')
      .not('orgao', 'is', null);

    const legacyResult = (legacyContacts || []).map(c => ({
      id: c.id,
      personId: c.id,
      orgId: null,
      nomeOrgao: c.orgao,
      orgName: c.orgao,
      orgAcronym: null,
      tipo: 'outros',
      sphere: 'municipal',
      titularNome: c.nome || null,
      titularCargo: c.cargo || null,
      phone: c.telefone || null,
      email: c.email || null,
      party: null,
      birthday: null,
      chefeGab: null,
      notes: null,
      orgPhone: null,
      orgEmail: null,
      orgAddress: null,
    }));

    const allResult = sortMode === 'az'
      ? [...result, ...legacyResult].sort((a, b) =>
          (a.titularNome || a.nomeOrgao || '').localeCompare(b.titularNome || b.nomeOrgao || '', 'pt-BR'))
      : [...result, ...legacyResult];

    return NextResponse.json(allResult);
  } catch (error) {
    console.error('Erro ao buscar CADIN:', error);
    return NextResponse.json({ error: 'Falha ao carregar CADIN' }, { status: 500 });
  }
}
