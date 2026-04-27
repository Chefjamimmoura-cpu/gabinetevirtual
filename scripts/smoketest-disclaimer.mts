import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const { generateParecerComissaoDocx, generateAtaDocx } = await import('../src/lib/parecer/generate-docx');
  const { resolveDisclaimer } = await import('../src/lib/docs/index');

  const OUT_DIR = path.resolve(process.cwd(), '_smoketest_out');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const membros = [
    { nome: 'Carol Dantas', cargo: 'presidente' as const },
    { nome: 'Zezinho da Saude', cargo: 'vice-presidente' as const },
    { nome: 'Maria Silva', cargo: 'membro' as const },
  ];

  const parecerText = [
    'Trata-se de Projeto de Lei do Legislativo (PLL) numero 88/2026 que dispoe sobre tema X.',
    '',
    'Apos analise juridica, esta Comissao entende que o referido projeto esta em conformidade com o ordenamento juridico vigente.',
    '',
    'Diante do exposto, esta Comissao manifesta-se pelo VOTO FAVORAVEL ao Projeto de Lei do Legislativo numero 88/2026.',
  ].join('\n');

  const ataText =
    'AO DIA 27 DE ABRIL DO ANO DE 2026, REUNIU-SE A COMISSAO DE ASSUNTOS SOCIAIS E POLITICOS (CASP), SOB A PRESIDENCIA DA VEREADORA CAROL DANTAS, COM A PRESENCA DOS DEMAIS MEMBROS PARA APRECIACAO DAS MATERIAS EM PAUTA.';

  console.log('[smoketest] iniciando...');

  const disclaimerParecer = resolveDisclaimer({
    kind: 'parecer_comissao',
    comissao: { nome: 'Comissao de Assuntos Sociais e Politicos (CASP)', sigla: 'CASP' },
    materia: { tipo_sigla: 'PLL', numero: 88, ano: 2026 },
    data: '2026-04-27',
  });
  console.log('[smoketest] disclaimer parecer:', disclaimerParecer.slice(0, 80) + '...');

  const parecerBuf = await generateParecerComissaoDocx(parecerText, {
    commissionNome: 'Comissao de Assuntos Sociais e Politicos (CASP)',
    commissionSigla: 'CASP',
    membros,
    disclaimer: disclaimerParecer,
  });
  const parecerPath = path.join(OUT_DIR, 'test_parecer.docx');
  fs.writeFileSync(parecerPath, parecerBuf);
  console.log('[smoketest] parecer.docx:', parecerBuf.length, 'bytes ->', parecerPath);

  const disclaimerAta = resolveDisclaimer({
    kind: 'ata_comissao',
    comissao: { nome: 'Comissao de Assuntos Sociais e Politicos (CASP)', sigla: 'CASP' },
    data: '2026-04-27',
  });

  const ataBuf = await generateAtaDocx(ataText, {
    commissionNome: 'Comissao de Assuntos Sociais e Politicos (CASP)',
    commissionSigla: 'CASP',
    membros,
    dataStr: '27 DE ABRIL DE 2026',
    disclaimer: disclaimerAta,
  });
  const ataPath = path.join(OUT_DIR, 'test_ata.docx');
  fs.writeFileSync(ataPath, ataBuf);
  console.log('[smoketest] ata.docx:', ataBuf.length, 'bytes ->', ataPath);

  console.log('[smoketest] OK');
}

main().catch((err) => {
  console.error('[smoketest] FALHOU:', err);
  process.exit(1);
});
