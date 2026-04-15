# Formatacao do Relatorio — Estilo Diario Oficial

**Data:** 2026-04-13
**Status:** Aprovado
**Escopo:** Formatacao visual do relatorio de sessao plenaria (web + DOCX)
**Arquivos:** 3 (sem arquivo novo, sem dependencia nova)

---

## Contexto

O relatorio de sessao e gerado pelo Gemini em markdown e exibido em 2 destinos:
- Painel web (page.tsx) — renderizacao inline
- Export DOCX (export-docx/route.ts) — documento Word

**Problemas atuais:**
1. Asteriscos `**negrito**` inline aparecem como texto cru na tela (parser so reconhece linhas inteiras em negrito)
2. Estilo visual institucional com cores e decoracoes — usuario quer estilo "diario oficial" sobrio
3. DOCX com mesmos problemas de parsing inline + cores verdes

## Decisoes

- **Abordagem:** Parser regex inline custom (sem dependencia nova)
- **Estilo:** Diario oficial — caixa alta nos titulos, justificado, sem cor, tipografia serif
- **Secoes do relatorio:** Mantidas intactas (5 secoes existentes)
- **Conteudo do Gemini:** Sem mudanca estrutural, apenas instrucao para uso comedido de negrito

---

## Alteracao 1 — Prompt Gemini

**Arquivo:** `src/app/api/sessoes/relatorio/route.ts`

### O que muda

1. Remover asteriscos decorativos do template de cabecalho no SYSTEM_PROMPT:
   - Antes: `**RELATORIO DA SESSAO PLENARIA**`
   - Depois: `RELATORIO DA SESSAO PLENARIA`

2. Adicionar instrucao de uso comedido de negrito:
   > "Use negrito (**) apenas para: nomes de projetos de lei, resultados de votacao (aprovado/rejeitado) e nomes proprios de oradores quando citados pela primeira vez. Evite negrito decorativo."

### O que NAO muda
- Modelo, temperatura, maxOutputTokens
- Secoes 1-5 e suas descricoes
- Regras de conteudo (INAUDIVEL, comunicadores, etc.)

---

## Alteracao 2 — Parser Frontend

**Arquivo:** `src/app/(dashboard)/sessoes/page.tsx` (linhas ~1628-1637)

### Funcao nova: parseInlineMarkdown(text)

```
Entrada: "O **Vereador Fulano** votou a favor do **PLL 123**"
Saida: [
  <span>O </span>,
  <strong>Vereador Fulano</strong>,
  <span> votou a favor do </span>,
  <strong>PLL 123</strong>
]
```

- Regex: `/\*\*(.+?)\*\*/g`
- Retorna array de `<span>` e `<strong>` com keys unicos
- Tratamento especial para `(trecho inaudivel)` mantido (italico cinza)

### Reestilo diario oficial

| Elemento | Antes | Depois |
|---|---|---|
| Titulos `###` | `color: #1f2937`, `fontSize: 1rem`, `borderBottom: 1px #e5e7eb` | `textTransform: uppercase`, `fontWeight: 800`, `borderBottom: 2px solid #1f2937`, `letterSpacing: 0.05em` |
| Paragrafos | `textAlign: left`, sem recuo | `textAlign: justify`, `textIndent: 24px` |
| Bullets `- ` | `marginLeft: 16px`, mostra `- ` cru | `paddingLeft: 32px`, prefixo travessao `–`, sem o `- ` |
| Separadores `---` | `borderTop: 1px #e5e7eb` | `borderTop: 2px solid #374151`, `margin: 24px 0` |
| Linha bold inteira | Regra especial propria | Removida (parseInlineMarkdown cobre) |
| `(trecho inaudivel)` | Vermelho `#dc2626` | Cinza `#6b7280`, italico mantido |
| Container | `fontFamily: Georgia` | Mantido Georgia serif |

---

## Alteracao 3 — Export DOCX

**Arquivo:** `src/app/api/sessoes/export-docx/route.ts` (linhas ~76-107)

### Funcao nova: parseLineToTextRuns(text, baseOptions)

```
Entrada: "O **Vereador Fulano** votou a favor"
Saida: [
  TextRun({ text: "O ", ...baseOptions }),
  TextRun({ text: "Vereador Fulano", bold: true, ...baseOptions }),
  TextRun({ text: " votou a favor", ...baseOptions }),
]
```

- Mesma regex `/\*\*(.+?)\*\*/g`
- `baseOptions` herda font, size, color da linha pai
- Substitui o `TextRun` unico por array de TextRuns

### Reestilo diario oficial no DOCX

| Elemento | Antes | Depois |
|---|---|---|
| Cabecalho "CAMARA MUNICIPAL" | `color: '1a4731'` (verde) | `color: '000000'` (preto) |
| Titulos de secao `###` | `color: '1a4731'`, HeadingLevel.HEADING_3 | `color: '000000'`, `toUpperCase()`, HeadingLevel.HEADING_3 mantido |
| Paragrafos | Alinhamento padrao | `alignment: AlignmentType.JUSTIFIED` |
| Bullets | `bullet: { level: 0 }` | Travessao `–` como prefixo, `indent: { left: 720 }` (1.27cm) |
| Separadores | `color: '999999'` | `color: '374151'` |
| `(trecho inaudivel)` | `color: 'dc2626'` vermelho | `color: '666666'` cinza, italico mantido |
| Font geral | Times New Roman | Mantido |

---

## Fora de escopo

- Mudanca nas 5 secoes do relatorio
- Mudanca no modelo/temperatura do Gemini
- Adicao de dependencias (react-markdown etc.)
- Mudanca no fluxo de geracao ou salvamento
- Mudanca na exportacao de transcricao (tipo: 'transcricao')
