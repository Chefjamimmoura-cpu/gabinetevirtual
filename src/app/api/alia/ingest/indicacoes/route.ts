// POST /api/alia/ingest/indicacoes
// Indexa: protocolos de campo, fluxo de trabalho, tipos de demanda, georreferenciamento.

import { NextRequest, NextResponse } from 'next/server';
import { upsertKnowledge, type KnowledgeChunk } from '@/lib/alia/rag';

const GABINETE_ID = process.env.GABINETE_ID!;

const INDICACOES_CHUNKS: KnowledgeChunk[] = [
  {
    dominio: 'indicacoes', source_ref: 'campo:fluxo-completo',
    chunk_text: `FLUXO COMPLETO — Do Recebimento da Demanda ao Protocolo no SAPL:

ETAPA 1 — RECEBER A DEMANDA
  • Canal: WhatsApp do gabinete, visita presencial, ligação telefônica
  • Registrar imediatamente no sistema de indicações com status "pendente"
  • Coletar: nome do solicitante, telefone, localização aproximada, descrição do problema

ETAPA 2 — VISITA AO LOCAL (Equipe de Campo)
  • Confirmar o problema in loco
  • Tirar fotos (mínimo 3: geral, detalhe, contexto)
  • Ativar GPS e registrar coordenadas geográficas
  • Registrar endereço completo: rua, número, bairro, ponto de referência

ETAPA 3 — COLETA DE EVIDÊNCIAS
  • Depoimento de moradores (áudio com permissão ou escrito)
  • Contagem de famílias afetadas
  • Registro de riscos (se houver perigo imediato, acionar órgão competente)

ETAPA 4 — IDENTIFICAR ÓRGÃO RESPONSÁVEL
  • Consultar tabela de órgãos por tipo de problema
  • Verificar se é competência municipal, estadual ou federal

ETAPA 5 — REDIGIR A INDICAÇÃO
  • Usar template padrão (ementa + justificativa em §§)
  • Fundamentar em lei (CF art. 30, Lei Orgânica de Boa Vista)
  • Revisão jurídica antes de protocolar

ETAPA 6 — PROTOCOLAR NO SAPL
  • Acesso: https://sapl.boavista.rr.leg.br
  • Anexar fotos e documentos
  • Aguardar número de protocolo

ETAPA 7 — ACOMPANHAR E FECHAR
  • Monitorar tramitação no SAPL
  • Cobrar resposta do órgão executivo
  • Registrar como "concluído" com foto do resultado`,
    metadata: { tipo: 'fluxo', area: 'campo' },
  },
  {
    dominio: 'indicacoes', source_ref: 'campo:protocolo-fotos',
    chunk_text: `PROTOCOLO DE FOTOS PARA INDICAÇÕES DE CAMPO:

QUANTIDADE: Mínimo 3 fotos por demanda
  • Foto 1: visão geral do problema com contexto do local
  • Foto 2: detalhe do problema (close)
  • Foto 3: ponto de referência (número da casa, placa de rua, esquina)

QUALIDADE:
  • GPS ativado antes de fotografar (geotagging automático)
  • Luz do dia sempre que possível
  • Mínimo 2MB, sem filtros ou edições
  • Formato JPEG ou PNG

NOMENCLATURA: BAIRRO_TIPOPROBLEMA_DATA
  Exemplos: CARANÃ_BURACO_20260319, CENTENARIO_ILUMINACAO_20260319

ATENÇÃO:
  • Buraco profundo ou fiação exposta: fotografar da distância segura
  • Não mostrar rostos de crianças sem autorização
  • Incluir escala quando possível (pessoa ao lado, objeto de referência)`,
    metadata: { tipo: 'protocolo', area: 'fotos' },
  },
  {
    dominio: 'indicacoes', source_ref: 'campo:georreferenciamento',
    chunk_text: `GEORREFERENCIAMENTO DE INDICAÇÕES:

MÉTODO 1 — Google Maps (recomendado):
  • Abrir Maps → pressionar o ponto exato → copiar coordenadas
  • Formato: -2.819600, -60.673300 (latitude, longitude)
  • Ou compartilhar o link com o pin marcado

MÉTODO 2 — App dedicado:
  • "My GPS Coordinates" (Android/iOS)
  • Registra automaticamente ao abrir no local

PADRÃO DE REGISTRO:
  • Coordenadas: latitude, longitude (6 casas decimais)
  • Endereço completo: Rua [Nome], nº [XX], Bairro [Nome], Boa Vista/RR
  • Ponto de referência: "Em frente ao mercado X" / "Próximo ao poste nº YYY"

TRECHOS DE RUA:
  • Registrar ponto inicial (latitude 1, longitude 1)
  • Registrar ponto final (latitude 2, longitude 2)
  • Descrever extensão em metros

ZONA RURAL:
  • Rodovia + km: "BR-174, km 45"
  • Ramal/vicinal: "Ramal do Apiaú, km 12"`,
    metadata: { tipo: 'protocolo', area: 'gps' },
  },
  {
    dominio: 'indicacoes', source_ref: 'campo:coleta-depoimentos-audio',
    chunk_text: `COLETA DE DEPOIMENTOS E ÁUDIOS — Protocolo da Equipe de Campo:

ANTES DE GRAVAR:
  • Pedir permissão explícita: "Posso gravar seu relato para documentar a demanda?"
  • Identificar o morador: nome, telefone (para contato futuro)
  • Explicar o uso: "O áudio será usado no processo legislativo, não publicado nas redes"

DURANTE A GRAVAÇÃO:
  • Perguntas-chave:
    - "Há quanto tempo existe esse problema?"
    - "Já tentou resolver pela Prefeitura? Qual foi a resposta?"
    - "Quantas famílias são afetadas aqui?"
    - "Isso causou algum acidente ou problema de saúde?"
  • Máx 5 minutos por depoimento
  • Formato: MP3 ou M4A

APÓS A COLETA:
  • Transcrever os pontos principais
  • Registrar: nome, data, endereço do depoente
  • Assinatura: solicitar assinar folha de demanda (se possível)

PRIVACIDADE:
  • Não publicar dados pessoais sem autorização
  • Áudios são documentos internos — não compartilhar nas redes sociais`,
    metadata: { tipo: 'protocolo', area: 'depoimentos' },
  },
  {
    dominio: 'indicacoes', source_ref: 'campo:orgaos-responsaveis-bv',
    chunk_text: `TABELA DE ÓRGÃOS RESPONSÁVEIS — Boa Vista/RR:

MUNICIPAL (Prefeitura de Boa Vista):
  • Buracos / pavimentação de ruas → SEMINF (Secretaria Municipal de Infraestrutura)
  • Iluminação pública → SEMURB + Equatorial Energia (concessionária — ligar 116)
  • Limpeza urbana / entulho → SEMUSA (varrição) ou SEMINFRA
  • Podas de árvores → SEMUC (Secretaria de Meio Ambiente e Urbanismo)
  • Saúde / UBS / ambulância → SEMSA (Secretaria Municipal de Saúde)
  • Educação / escola pública → SMEC (Secretaria Municipal de Educação)
  • Praça / área de lazer → SEMUC / SEMDETUR
  • Transporte coletivo → SMTT (Superintendência Municipal de Trânsito)
  • Habitação / regularização fundiária → SEHAB

ESTADUAL (Governo de Roraima):
  • Saneamento / esgoto → CAER (Companhia de Águas e Esgotos de Roraima)
  • Segurança pública → SESP-RR / Polícia Militar
  • Rodovias estaduais → DNIT-RR / DER-RR
  • Saúde hospitalar → SESAU (Secretaria Estadual de Saúde)

FEDERAL:
  • Rodovias federais (BR) → DNIT
  • INSS / previdência → Agência INSS local
  • Habitação federal → CAIXA (programas habitacionais)`,
    metadata: { tipo: 'referencia', area: 'orgaos' },
  },
  {
    dominio: 'indicacoes', source_ref: 'campo:instrucoes-equipe-rua',
    chunk_text: `INSTRUÇÕES PARA A EQUIPE DE RUA — Gabinete da Vereadora Carol Dantas:

AO SAIR PARA CAMPO:
  1. Confirmar o endereço da demanda antes de sair
  2. Levar celular carregado com GPS ativado
  3. Anotar o nome e contato do solicitante

NO LOCAL:
  1. Cumprimentar moradores e se identificar: "Equipe do Gabinete da Vereadora Carol Dantas"
  2. Confirmar o problema relatado
  3. Fotografar (protocolo de fotos — mínimo 3)
  4. Registrar coordenadas GPS
  5. Coletar depoimento se morador aceitar
  6. Registrar quantas famílias são afetadas

AO RETORNAR:
  1. Enviar fotos + GPS para o grupo do gabinete
  2. Preencher o formulário de indicação no sistema
  3. Aguardar revisão da assessoria antes de protocolar

URGÊNCIAS (perigo imediato):
  • Buraco profundo em via movimentada → comunicar à SEMINF e Defesa Civil
  • Fiação elétrica exposta → ligar para Equatorial (116)
  • Árvore caída em via → SEMUC + Corpo de Bombeiros (193)
  Sempre registrar a ocorrência no sistema mesmo após acionar emergência`,
    metadata: { tipo: 'instrucao', area: 'equipe-campo' },
  },
];

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const result = await upsertKnowledge(INDICACOES_CHUNKS, GABINETE_ID);
  return NextResponse.json({ total: INDICACOES_CHUNKS.length, ...result });
}
