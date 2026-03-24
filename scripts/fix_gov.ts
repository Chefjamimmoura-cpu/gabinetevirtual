import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const GABINETE_ID = process.env.GABINETE_ID || 'f25299db-1c33-45b9-830f-82f6d2d666ef';

async function fixGov() {
  console.log('Verificando se Governo do Estado de Roraima existe...');
  let orgId = '';

  // 1. Encontrar ou criar a Organização
  const { data: orgs } = await supabase
    .from('cadin_organizations')
    .select('id')
    .ilike('name', '%Governo do Estado de Roraima%');

  if (orgs && orgs.length > 0) {
    orgId = orgs[0].id;
    console.log('Org encontrada:', orgId);
    
    // Atualizar endereço no banco caso já exista sem endereço
    await supabase.from('cadin_organizations')
      .update({ 
        endereco: 'Palácio Senador Hélio Campos - Praça do Centro Cívico, s/n - Boa Vista – RR - CEP: 69.301-380',
        phone: '(95) 2121-7930',
        email: 'antonio.denarium@casacivil.rr.gov.br'
      })
      .eq('id', orgId);
  } else {
    const { data: newOrg } = await supabase
      .from('cadin_organizations')
      .insert({
        gabinete_id: GABINETE_ID,
        name: 'Governo do Estado de Roraima',
        acronym: 'GOV-RR',
        sphere: 'estadual',
        endereco: 'Palácio Senador Hélio Campos - Praça do Centro Cívico, s/n - Boa Vista – RR - CEP: 69.301-380',
        phone: '(95) 2121-7930',
        email: 'antonio.denarium@casacivil.rr.gov.br'
      })
      .select('id')
      .single();
    
    orgId = newOrg?.id || '';
    console.log('Org criada:', orgId);
  }

  // 2. Criar ou encontrar a Pessoa (Antonio Denarium)
  let personId = '';
  const { data: persons } = await supabase
    .from('cadin_persons')
    .select('id')
    .ilike('full_name', 'Antonio Oliverio Garcia de Almeida');

  if (persons && persons.length > 0) {
    personId = persons[0].id;
    console.log('Pessoa encontrada:', personId);
  } else {
    // Foto oficial do governador
    const photoUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Antonio_Denarium_em_2023_%28cropped%29.jpg/200px-Antonio_Denarium_em_2023_%28cropped%29.jpg';
    
    const { data: newPerson } = await supabase
      .from('cadin_persons')
      .insert({
        gabinete_id: GABINETE_ID,
        full_name: 'Antonio Oliverio Garcia de Almeida',
        party: 'PROGRESSISTAS',
        email: 'adriana.brandao@casacivil.rr.gov.br', // Email do Chefe de Gab
        notes: 'Aniversário: 03 DE MARÇO. CHEFE DE GABINETE: Adriana Brandão / Lidiane - (95) 98123-6341 / 99113-2343',
        photo_url: photoUrl
      })
      .select('id')
      .single();
    personId = newPerson?.id || '';
    console.log('Pessoa criada:', personId);
  }

  if (!orgId || !personId) {
    console.error('Falha ao criar registros.');
    return;
  }

  // 3. Criar a nomeação / Cargo (Appointment)
  const { data: apps } = await supabase
    .from('cadin_appointments')
    .select('id')
    .eq('person_id', personId)
    .eq('organization_id', orgId);

  if (apps && apps.length > 0) {
    console.log('Cargo já existe:', apps[0].id);
    const oldDate = new Date('2000-01-01T00:00:00Z').toISOString();
    await supabase.from('cadin_appointments')
      .update({ active: true, created_at: oldDate, title: 'Governador do Estado' })
      .eq('id', apps[0].id);
  } else {
    // Inserir ele com created_at com uma data BEM antiga para aparecer no começo da lista!
    const oldDate = new Date('2000-01-01T00:00:00Z').toISOString();
    
    const { data: newApp, error: errApp } = await supabase
      .from('cadin_appointments')
      .insert({
        gabinete_id: GABINETE_ID,
        person_id: personId,
        organization_id: orgId,
        title: 'Governador',
        active: true,
        created_at: oldDate
      })
      .select('id')
      .single();
    
    if (errApp) console.error('Error insert app:', errApp);
    console.log('Cargo inserido:', newApp?.id);
  }

  console.log('Sucesso! O governador foi adicionado no topo do Caderno.');
}

fixGov();
