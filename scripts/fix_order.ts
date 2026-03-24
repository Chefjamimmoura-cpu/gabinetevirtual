import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fixOrder() {
  console.log('Ajustando a ordem (created_at) do Vice-Governador e Secretário...');

  // 1. Vice-Governador (Edilson Damião)
  const { data: damiaoPers } = await supabase.from('cadin_persons').select('id').ilike('full_name', '%EDILSON DAMIÃO%');
  if (damiaoPers && damiaoPers.length > 0) {
    console.log('Atualizando Vice-Governador:', damiaoPers[0].id);
    await supabase.from('cadin_appointments')
      .update({ created_at: new Date('2000-01-02T00:00:00Z').toISOString() })
      .eq('person_id', damiaoPers[0].id)
      .ilike('title', '%VICE-GOVERNADOR%');
  }

  // 2. Secretário Chefe (Flamarion)
  const { data: flamPers } = await supabase.from('cadin_persons').select('id').ilike('full_name', '%FRANCISCO FLAMARION%');
  if (flamPers && flamPers.length > 0) {
    console.log('Atualizando Secretario Chefe:', flamPers[0].id);
    await supabase.from('cadin_appointments')
      .update({ created_at: new Date('2000-01-03T00:00:00Z').toISOString() })
      .eq('person_id', flamPers[0].id)
      .ilike('title', '%SECRETÁRIO CHEFE%');
  }

  console.log('Ordem ajustada globalmente! 1) Gov 2) Vice 3) Casa Civil.');
}

fixOrder();
