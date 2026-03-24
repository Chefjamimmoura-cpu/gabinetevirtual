import { syncSapl } from './sync';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
  console.log('Iniciando syncSapl() manual test...');
  try {
    const result = await syncSapl();
    console.log('Sync concluído com sucesso!');
    console.dir(result, { depth: null });
  } catch (err) {
    console.error('Falha no Sync:', err);
  }
}

run();
