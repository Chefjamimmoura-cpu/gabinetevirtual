/**
 * create-odt-templates.js
 *
 * Gera os templates ODT em public/templates/ usando PizZip.
 * Um arquivo ODT é um ZIP contendo:
 *   - mimetype         (sem compressão)
 *   - META-INF/manifest.xml
 *   - styles.xml
 *   - content.xml      (texto do documento com {{variáveis}} docxtemplater)
 *
 * Executar: node scripts/create-odt-templates.js
 */

const PizZip = require('pizzip');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, '..', 'public', 'templates');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── ODT skeleton ───────────────────────────────────────────────────────────────

const MIMETYPE = 'application/vnd.oasis.opendocument.text';

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"
                   manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  office:version="1.3">
  <office:styles>
    <style:default-style style:family="paragraph">
      <style:paragraph-properties fo:text-align="justify"/>
      <style:text-properties fo:font-size="12pt" fo:font-family="Times New Roman"/>
    </style:default-style>
    <style:style style:name="Heading" style:family="paragraph" style:class="text">
      <style:text-properties fo:font-size="14pt" fo:font-weight="bold" fo:text-align="center"/>
    </style:style>
    <style:style style:name="Standard" style:family="paragraph" style:class="text">
      <style:text-properties fo:font-size="12pt"/>
    </style:style>
    <style:style style:name="Bold" style:family="paragraph">
      <style:text-properties fo:font-weight="bold"/>
    </style:style>
  </office:styles>
  <office:automatic-styles>
    <style:page-layout style:name="pm1">
      <style:page-layout-properties
        fo:page-width="21.001cm"
        fo:page-height="29.7cm"
        style:print-orientation="portrait"
        fo:margin-top="3cm"
        fo:margin-bottom="2cm"
        fo:margin-left="3cm"
        fo:margin-right="2cm"/>
    </style:page-layout>
  </office:automatic-styles>
  <office:master-styles>
    <style:master-page style:name="Standard" style:page-layout-name="pm1"/>
  </office:master-styles>
</office:document-styles>`;

// ── helpers ────────────────────────────────────────────────────────────────────

function p(text, align = 'justify') {
  return `<text:p text:style-name="Standard" fo:text-align="${align}">${escXml(text)}</text:p>`;
}

function pBold(text, align = 'center') {
  return `<text:p text:style-name="Heading" fo:text-align="${align}"><text:span text:style-name="Bold">${escXml(text)}</text:span></text:p>`;
}

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Preserve {{ }} as-is (docxtemplater placeholders — don't escape braces)
function tpl(s) {
  return s; // raw — the surrounding XML will be escaped by p() but tpl vars need to stay as {{...}}
}

function pRaw(xmlContent) {
  return `<text:p text:style-name="Standard">${xmlContent}</text:p>`;
}

function pageBreak() {
  return `<text:p text:style-name="Standard"><text:soft-page-break/></text:p>`;
}

function buildContent(bodyXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  office:version="1.3">
  <office:body>
    <office:text>
${bodyXml}
    </office:text>
  </office:body>
</office:document-content>`;
}

function makeOdt(contentXml) {
  const zip = new PizZip();
  zip.file('mimetype', MIMETYPE, { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', MANIFEST);
  zip.file('styles.xml', STYLES);
  zip.file('content.xml', contentXml);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ── Template 1: parecer_relator.odt ───────────────────────────────────────────

function buildParecerRelator() {
  const body = [
    // Cabeçalho
    pRaw(`<text:span fo:text-align="center" fo:font-weight="bold">CÂMARA MUNICIPAL DE {{municipio}}</text:span>`),
    pRaw(`<text:span fo:text-align="center">{{comissao.nome}}</text:span>`),
    `<text:p text:style-name="Standard"/>`,

    // Título
    pRaw(`<text:span fo:font-weight="bold" fo:text-align="center">{{titulo}}</text:span>`),
    `<text:p text:style-name="Standard"/>`,

    // Dados da matéria
    pRaw(`<text:span fo:font-weight="bold">MATÉRIA:</text:span> {{materia.tipo_sigla}} Nº {{materia.numero}}/{{materia.ano}}`),
    pRaw(`<text:span fo:font-weight="bold">EMENTA:</text:span> {{materia.ementa}}`),
    pRaw(`<text:span fo:font-weight="bold">RELATOR(A):</text:span> {{parlamentar.nome_completo}} ({{cargo_relator}})`),
    pRaw(`<text:span fo:font-weight="bold">DATA:</text:span> {{data_extenso}}`),
    `<text:p text:style-name="Standard"/>`,

    // Relatório
    pRaw(`<text:span fo:font-weight="bold">I — RELATÓRIO</text:span>`),
    `<text:p text:style-name="Standard">{{texto_relatorio}}</text:p>`,
    `<text:p text:style-name="Standard"/>`,

    // Voto
    pRaw(`<text:span fo:font-weight="bold">II — VOTO</text:span>`),
    `<text:p text:style-name="Standard">{{texto_voto_fundamentado}}</text:p>`,
    `<text:p text:style-name="Standard"/>`,

    // Conclusão
    pRaw(`Ante o exposto, voto <text:span fo:font-weight="bold">{{voto}}</text:span> à presente proposição.`),
    `<text:p text:style-name="Standard"/>`,
    pRaw(`{{municipio}}, {{data_extenso}}.`),
    `<text:p text:style-name="Standard"/>`,
    `<text:p text:style-name="Standard"/>`,
    pRaw(`_____________________________________________`),
    pRaw(`<text:span fo:font-weight="bold">{{parlamentar.nome_completo}}</text:span>`),
    pRaw(`{{cargo_relator}} — {{comissao.nome}}`),
  ].join('\n');

  return buildContent(body);
}

// ── Template 2: parecer_comissao.odt ──────────────────────────────────────────

function buildParecerComissao() {
  const body = [
    pRaw(`<text:span fo:text-align="center" fo:font-weight="bold">CÂMARA MUNICIPAL DE {{municipio}}</text:span>`),
    pRaw(`<text:span fo:text-align="center">{{comissao.nome}}</text:span>`),
    `<text:p text:style-name="Standard"/>`,

    pRaw(`<text:span fo:font-weight="bold" fo:text-align="center">{{titulo}}</text:span>`),
    `<text:p text:style-name="Standard"/>`,

    pRaw(`<text:span fo:font-weight="bold">MATÉRIA:</text:span> {{materia.tipo_sigla}} Nº {{materia.numero}}/{{materia.ano}}`),
    pRaw(`<text:span fo:font-weight="bold">EMENTA:</text:span> {{materia.ementa}}`),
    pRaw(`<text:span fo:font-weight="bold">PRESIDENTE:</text:span> {{parlamentar.nome_completo}}`),
    pRaw(`<text:span fo:font-weight="bold">DATA DA REUNIÃO:</text:span> {{data_extenso}}`),
    `<text:p text:style-name="Standard"/>`,

    pRaw(`<text:span fo:font-weight="bold">PARECER DA COMISSÃO</text:span>`),
    `<text:p text:style-name="Standard">{{texto_relatorio}}</text:p>`,
    `<text:p text:style-name="Standard"/>`,

    `<text:p text:style-name="Standard">{{texto_voto_fundamentado}}</text:p>`,
    `<text:p text:style-name="Standard"/>`,

    pRaw(`A <text:span fo:font-weight="bold">{{comissao.nome}}</text:span>, por seus membros presentes, vota <text:span fo:font-weight="bold">{{voto}}</text:span> à presente proposição.`),
    `<text:p text:style-name="Standard"/>`,
    pRaw(`{{municipio}}, {{data_extenso}}.`),
    `<text:p text:style-name="Standard"/>`,
    `<text:p text:style-name="Standard"/>`,
    pRaw(`_____________________________________________`),
    pRaw(`<text:span fo:font-weight="bold">{{parlamentar.nome_completo}}</text:span>`),
    pRaw(`Presidente — {{comissao.nome}}`),
  ].join('\n');

  return buildContent(body);
}

// ── Template 3: ata_comissao.odt ──────────────────────────────────────────────

function buildAtaComissao() {
  const body = [
    pRaw(`<text:span fo:text-align="center" fo:font-weight="bold">CÂMARA MUNICIPAL DE {{municipio}}</text:span>`),
    pRaw(`<text:span fo:text-align="center">{{comissao.nome}}</text:span>`),
    `<text:p text:style-name="Standard"/>`,

    pRaw(`<text:span fo:font-weight="bold" fo:text-align="center">ATA DE REUNIÃO DA {{comissao.nome}}</text:span>`),
    `<text:p text:style-name="Standard"/>`,

    pRaw(`Aos {{data_extenso}}, reuniu-se a <text:span fo:font-weight="bold">{{comissao.nome}}</text:span> da Câmara Municipal de {{municipio}}, sob a presidência de <text:span fo:font-weight="bold">{{parlamentar.nome_completo}}</text:span>.`),
    `<text:p text:style-name="Standard"/>`,

    pRaw(`<text:span fo:font-weight="bold">PAUTA:</text:span>`),
    pRaw(`{{materia.tipo_sigla}} Nº {{materia.numero}}/{{materia.ano}} — {{materia.ementa}}`),
    `<text:p text:style-name="Standard"/>`,

    pRaw(`<text:span fo:font-weight="bold">DELIBERAÇÕES:</text:span>`),
    `<text:p text:style-name="Standard">{{texto_relatorio}}</text:p>`,
    `<text:p text:style-name="Standard"/>`,

    pRaw(`<text:span fo:font-weight="bold">RESULTADO DA VOTAÇÃO:</text:span> {{voto}}`),
    `<text:p text:style-name="Standard"/>`,
    pRaw(`Nada mais havendo a tratar, a sessão foi encerrada, lavrando-se a presente Ata que, lida e aprovada, vai assinada.`),
    `<text:p text:style-name="Standard"/>`,
    pRaw(`{{municipio}}, {{data_extenso}}.`),
    `<text:p text:style-name="Standard"/>`,
    `<text:p text:style-name="Standard"/>`,
    pRaw(`_____________________________________________`),
    pRaw(`<text:span fo:font-weight="bold">{{parlamentar.nome_completo}}</text:span>`),
    pRaw(`Presidente — {{comissao.nome}}`),
  ].join('\n');

  return buildContent(body);
}

// ── Gerar arquivos ─────────────────────────────────────────────────────────────

const templates = [
  { file: 'parecer_relator.odt',  content: buildParecerRelator() },
  { file: 'parecer_comissao.odt', content: buildParecerComissao() },
  { file: 'ata_comissao.odt',     content: buildAtaComissao() },
];

for (const { file, content } of templates) {
  const buf = makeOdt(content);
  const dest = path.join(OUT_DIR, file);
  fs.writeFileSync(dest, buf);
  console.log(`✅ ${file} — ${(buf.length / 1024).toFixed(1)} KB`);
}

console.log('\nTemplates criados em public/templates/');
