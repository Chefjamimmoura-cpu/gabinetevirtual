// Disclaimer Registry — resolve o texto de proteção jurídica que vai no topo
// da folha dedicada de assinaturas. Caminho A: template único parametrizado.
//
// Estrutura fixa (não alterar sem revisão jurídica):
//   PREFIX + " " + descrição + ". " + SUFFIX
//
// A descrição varia por DocumentKind e é montada deterministicamente a partir
// dos campos de DisclaimerContext.

import type { DisclaimerContext } from './types';

const PREFIX = 'Assinaturas apostas a este documento referem-se, EXCLUSIVAMENTE,';
const SUFFIX =
  'A presente ressalva visa garantir a segurança jurídica e a lisura deste instrumento legislativo.';

const DEFAULT_AUTOR = 'Vereadora Carol Dantas';

export function resolveDisclaimer(ctx: DisclaimerContext): string {
  const middle = (ctx.descricaoOverride?.trim() || buildDescription(ctx)).trim();
  return `${PREFIX} ${middle}. ${SUFFIX}`;
}

function buildDescription(ctx: DisclaimerContext): string {
  const data = formatData(ctx.data);
  const autor = (ctx.autor || DEFAULT_AUTOR).trim();
  const com = ctx.comissao;
  const mat = ctx.materia;

  const materiaRef = mat ? `${mat.tipo_sigla} nº ${mat.numero}/${mat.ano}` : '';
  const dataSufixo = (genero: 'm' | 'f') =>
    data ? `, ${genero === 'f' ? 'datada' : 'datado'} de ${data}` : '';

  switch (ctx.kind) {
    case 'parecer_comissao':
      return collapse(
        `ao Parecer da ${com?.nome ?? 'Comissão'}` +
          (materiaRef ? ` sobre o ${materiaRef}` : '') +
          ` de autoria da ${autor}` +
          dataSufixo('m'),
      );
    case 'ata_comissao':
      return collapse(
        `à ATA da reunião da ${com?.nome ?? 'Comissão'}` + (data ? ` realizada em ${data}` : ''),
      );
    case 'parecer_relatoria':
      return collapse(
        `ao Parecer de Relatoria` +
          (materiaRef ? ` sobre o ${materiaRef}` : '') +
          ` de autoria da ${autor}` +
          dataSufixo('m'),
      );
    case 'pll':
      return collapse(
        `ao Projeto de Lei do Legislativo (PLL)` +
          (mat ? ` nº ${mat.numero}/${mat.ano}` : '') +
          ` de autoria da ${autor}` +
          dataSufixo('m'),
      );
    case 'pdl':
      return collapse(
        `ao Projeto de Decreto Legislativo (PDL)` +
          (mat ? ` nº ${mat.numero}/${mat.ano}` : '') +
          ` de autoria da ${autor}` +
          dataSufixo('m'),
      );
    case 'requerimento_urgencia':
      return collapse(
        `ao Requerimento de Urgência Especial` +
          (materiaRef ? ` para tramitação do ${materiaRef}` : '') +
          ` de autoria da ${autor}` +
          dataSufixo('m'),
      );
    case 'indicacao':
      return collapse(
        `à Indicação` +
          (mat ? ` nº ${mat.numero}/${mat.ano}` : '') +
          ` de autoria da ${autor}` +
          dataSufixo('f'),
      );
    case 'oficio':
      return collapse(
        `ao Ofício` +
          (mat ? ` nº ${mat.numero}/${mat.ano}` : '') +
          ` de autoria da ${autor}` +
          dataSufixo('m'),
      );
    case 'generico':
    default:
      return collapse(`ao documento de autoria da ${autor}` + dataSufixo('m'));
  }
}

function formatData(data?: string): string {
  if (!data) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(data);
  if (!iso) return data.trim();
  const [, y, mo, d] = iso;
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  const idx = parseInt(mo, 10) - 1;
  if (idx < 0 || idx > 11) return data.trim();
  return `${parseInt(d, 10)} de ${meses[idx]} de ${y}`;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
