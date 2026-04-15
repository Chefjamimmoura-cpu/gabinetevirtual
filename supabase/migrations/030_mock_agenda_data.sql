-- ============================================================
-- Migration 030 — Dados mock para demonstração da Agenda
-- Eventos e emails realistas para apresentação ao Ismael.
-- 2026-03-31
-- ============================================================

-- Variável de gabinete
DO $$
DECLARE
  gab_id UUID := 'f25299db-1c33-45b9-830f-82f6d2d666ef';
BEGIN

-- ── Eventos da semana atual ──────────────────────────────────────────────────

INSERT INTO eventos (gabinete_id, titulo, descricao, tipo, data_inicio, data_fim, local, cor)
VALUES
  -- Hoje
  (gab_id, 'Reunião com Secretário de Obras',
   'Pauta: andamento das obras no bairro Caranã e pedido de indicação para pavimentação.',
   'reuniao', NOW()::date + TIME '09:00', NOW()::date + TIME '10:00',
   'Gabinete — Câmara Municipal', '#4285F4'),

  (gab_id, 'Sessão Plenária Ordinária',
   '10ª Sessão Ordinária — 1º Período da 2ª Sessão Legislativa da 14ª Legislatura.',
   'sessao_plenaria', NOW()::date + TIME '16:00', NOW()::date + TIME '18:00',
   'Plenário CMBV', '#312e81'),

  -- Amanhã
  (gab_id, 'Visita à UBS Caranã',
   'Verificação das condições da unidade de saúde após indicação protocolada.',
   'agenda_externa', (NOW()::date + 1) + TIME '08:30', (NOW()::date + 1) + TIME '10:00',
   'UBS Caranã — Rua dos Ipês', '#ec4899'),

  (gab_id, 'Reunião Comissão de Saúde e Assistência Social',
   'Análise do PLL 45/2026 — Programa de saúde bucal nas escolas municipais.',
   'reuniao_comissao', (NOW()::date + 1) + TIME '14:00', (NOW()::date + 1) + TIME '15:30',
   'Sala de Comissões — CMBV', '#0891b2'),

  -- Depois de amanhã
  (gab_id, 'Entrevista Folha de Boa Vista',
   'Pauta: atuação legislativa no 1º trimestre e projetos de lei em andamento.',
   'agenda_externa', (NOW()::date + 2) + TIME '10:00', (NOW()::date + 2) + TIME '10:45',
   'Redação Folha BV', '#f59e0b'),

  (gab_id, 'Audiência Pública — Transporte Coletivo',
   'Audiência pública requerida pela Comissão de Obras sobre transporte em Boa Vista.',
   'outro', (NOW()::date + 2) + TIME '15:00', (NOW()::date + 2) + TIME '17:00',
   'Plenário CMBV', '#7c3aed'),

  -- Próxima semana
  (gab_id, 'Reunião de Equipe — Planejamento Abril',
   'Revisão de metas do gabinete, prioridades legislativas e agenda de indicações.',
   'reuniao', (NOW()::date + 5) + TIME '09:00', (NOW()::date + 5) + TIME '11:00',
   'Gabinete — Câmara Municipal', '#4285F4'),

  (gab_id, 'Sessão Plenária Ordinária',
   '11ª Sessão Ordinária do período legislativo.',
   'sessao_plenaria', (NOW()::date + 7) + TIME '16:00', (NOW()::date + 7) + TIME '18:00',
   'Plenário CMBV', '#312e81');


-- ── Emails simulados ─────────────────────────────────────────────────────────

INSERT INTO agenda_emails (gabinete_id, conta, uid, remetente, assunto, preview, data_recebimento, lido)
VALUES
  -- Oficiais
  (gab_id, 'oficial', 'mock-001', 'Secretaria de Obras <obras@boavista.rr.gov.br>',
   'RE: Solicitação de cronograma — Pavimentação Caranã',
   'Prezada Vereadora, encaminhamos em anexo o cronograma atualizado das obras no bairro Caranã conforme solicitado...',
   NOW() - INTERVAL '2 hours', false),

  (gab_id, 'oficial', 'mock-002', 'CMBV — Mesa Diretora <mesa@camaraboavista.rr.leg.br>',
   'Convocação: 10ª Sessão Ordinária — 31/03/2026',
   'Comunicamos que a 10ª Sessão Ordinária está confirmada para hoje às 16h. Ordem do dia: 3 projetos em pauta...',
   NOW() - INTERVAL '5 hours', true),

  (gab_id, 'oficial', 'mock-003', 'Procuradoria Jurídica <juridico@camaraboavista.rr.leg.br>',
   'Parecer Jurídico — PLL 22/2026 (Programa Recomeço)',
   'Segue parecer favorável à constitucionalidade do PLL 22/2026. Não há vícios formais ou materiais...',
   NOW() - INTERVAL '1 day', true),

  -- Agenda
  (gab_id, 'agenda', 'mock-004', 'Folha de Boa Vista <redacao@folhabv.com.br>',
   'Confirmação de entrevista — Quarta-feira 10h',
   'Olá equipe da Vereadora Carol. Confirmamos a entrevista para quarta-feira às 10h na redação...',
   NOW() - INTERVAL '3 hours', false),

  (gab_id, 'agenda', 'mock-005', 'Dr. Marcos Souza <marcos.souza@saude.rr.gov.br>',
   'Visita UBS Caranã — documentação preparada',
   'Vereadora, já preparei os relatórios de atendimento da UBS para sua visita amanhã. Estarei na unidade...',
   NOW() - INTERVAL '4 hours', false),

  -- Comissão
  (gab_id, 'comissao', 'mock-006', 'Comissão de Saúde <comissaosaude@camaraboavista.rr.leg.br>',
   'Pauta: Reunião Comissão de Saúde — 01/04/2026',
   'Pauta da reunião: 1) PLL 45/2026 — Saúde bucal nas escolas. 2) Requerimento de informações ao Executivo...',
   NOW() - INTERVAL '6 hours', false),

  -- Canais / redes
  (gab_id, 'canais', 'mock-007', 'Instagram Notificações <no-reply@mail.instagram.com>',
   'Seu post teve 284 curtidas',
   'O post sobre a indicação de pavimentação no Caranã alcançou 284 curtidas e 42 comentários...',
   NOW() - INTERVAL '8 hours', true),

  -- Pessoal
  (gab_id, 'pessoal', 'mock-008', 'Carol Dantas (pessoal)',
   'Lembrete: aniversário do João — sábado',
   'Não esquecer do aniversário do João no sábado. Já comprar presente e confirmar presença...',
   NOW() - INTERVAL '1 day', true);

END;
$$;
