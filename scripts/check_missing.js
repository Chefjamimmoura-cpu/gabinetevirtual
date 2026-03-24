const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const {data} = await supabase.from('cadin_appointments').select('*, cadin_persons(*), cadin_organizations(*)').ilike('cadin_persons.full_name', '%Damião%');
  const {data: d2} = await supabase.from('cadin_appointments').select('*, cadin_persons(*), cadin_organizations(*)').ilike('cadin_persons.full_name', '%Flamarion%');
  
  fs.writeFileSync('t.json', JSON.stringify({ damiao: data.filter(d => d.cadin_persons !== null), flamarion: d2.filter(d => d.cadin_persons !== null) }, null, 2));
}
run();
