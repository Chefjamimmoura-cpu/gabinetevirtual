import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://drrzyitmlgeozxwubsyl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRycnp5aXRtbGdlb3p4d3Vic3lsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzE5NjEwNiwiZXhwIjoyMDg4NzcyMTA2fQ.e3MkeIsrBunjbZ8OkXPS00VPwdjymHjEDBlHEDTvg-U';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkIndicacoes() {
  const { data, error } = await supabase
    .from('indicacoes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (error) {
    fs.writeFileSync('temp_indicacoes_all.json', JSON.stringify({ error: error.message }));
    return;
  }
  
  fs.writeFileSync('temp_indicacoes_all.json', JSON.stringify(data, null, 2));
}

checkIndicacoes();
