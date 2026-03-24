import 'dotenv/config';

// Data de início: 1º de Setembro de 2025
const START_DATE = new Date('2025-09-01T12:00:00Z');
const END_DATE = new Date();

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET || '';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runBackfill() {
  console.log(`[BACKFILL] Iniciando varredura retroativa do D.O. de ${START_DATE.toISOString().split('T')[0]} até hoje.`);
  
  const current = new Date(START_DATE);
  
  while (current <= END_DATE) {
    // Ignorar fins de semana (0 = Domingo, 6 = Sábado)
    if (current.getUTCDay() !== 0 && current.getUTCDay() !== 6) {
      const targetDateStr = current.toISOString().split('T')[0];
      console.log(`\n==============================================`);
      console.log(`[BACKFILL] Solicitando processamento para: ${targetDateStr}`);
      
      try {
        const res = await fetch(`${APP_URL}/api/cadin/sync-do`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(CRON_SECRET ? { 'Authorization': `Bearer ${CRON_SECRET}` } : {})
          },
          body: JSON.stringify({ target_date: targetDateStr })
        });
        
        const data = await res.json();
        if (res.ok) {
          console.log(`[SUCESSO] Edições: ${data.editions_found || 0} | Jobs enfileirados: ${data.jobs_queued || 0}`);
          if (data.jobs_queued && data.jobs_queued > 0) {
             console.log(`           Fontes: ${data.sources?.join(', ')}`);
             console.log(`           Aguardando 15s para dar tempo do worker processar sem gargalar a CPU...`);
             await delay(15000); 
          } else {
             console.log(`           ${data.message}`);
             await delay(1000); 
          }
        } else {
          console.error(`[ERRO] Falha no endpoint:`, data);
          await delay(2000);
        }
      } catch (err: any) {
        console.error(`[FALHA DE REDE] Erro ao conectar na API local (${APP_URL}):`, err.message);
        await delay(5000);
      }
    }
    
    // Avança 1 dia
    current.setUTCDate(current.getUTCDate() + 1);
  }
  
  console.log(`\n[BACKFILL] Busca Retroativa Concluída!`);
  console.log(`As nomeações e exonerações detectadas agora podem ser revisadas na aba Monitoramento do CADIN.`);
}

runBackfill();
