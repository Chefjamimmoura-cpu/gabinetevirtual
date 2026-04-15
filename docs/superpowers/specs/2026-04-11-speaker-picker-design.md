# Speaker Picker — Atribuição de Locutor

**Status:** Aprovado 2026-04-11
**Escopo:** UI de edição de transcrição

## Contexto

A página de transcrição (`/sessoes`) permite que a usuária corrija o locutor de um bloco via Shift+clique no nome do locutor. Hoje isso abre `window.prompt()` — janela nativa feia do navegador, fora do padrão visual do sistema. Além disso, só permite **renomear** (texto livre), mas o caso comum é **mesclar** blocos ao locutor correto: "este bloco é o Locutor 2, não o Locutor 4".

## Princípios

1. **Nunca auto-batizar locutores.** O detector sempre gera "Locutor N". Nomes próprios ("Fabiano") só aparecem por ação explícita da usuária, quando há certeza.
2. **Selecionar > renomear.** A ação primária é escolher um locutor existente. Renomear é secundário (progressive disclosure).
3. **Popover ancorado, não modal.** A ação é leve e repetitiva; merece ser rápida e contextual.
4. **Reusar tokens visuais do sistema.** Mesmas cores, radius, sombras e animações do `ConfirmModal` e do `Toast`.

## Componentes

### `src/components/sessoes/speaker-picker.tsx` (novo)

Popover ancorado próximo ao nome do locutor clicado.

**Props:**
```ts
interface SpeakerPickerProps {
  open: boolean;
  anchorRect: DOMRect | null;      // posição do elemento clicado
  currentSpeakerId: string;
  speakers: Array<{
    id: string;
    name: string;
    color: string;
    blockCount: number;
    isManualName: boolean;         // true se batizado (não "Locutor N")
  }>;
  onSelect: (targetSpeakerId: string) => void;  // merge
  onRename: (newName: string) => void;          // rename
  onClose: () => void;
}
```

**Comportamento:**
- Abre com fade+scale (180ms, cubic-bezier(.2,.8,.2,1)), respeita `prefers-reduced-motion`
- Fecha por: click fora, Esc, ×, seleção, rename
- Posicionamento: `position: fixed`, `top = anchorRect.bottom + 6`, `left = anchorRect.left`, clamp pra ficar dentro da viewport
- Largura: ~280px

**Anatomia:**
```
┌─────────────────────────────────────┐
│  ATRIBUIR A UM LOCUTOR         [×] │
├─────────────────────────────────────┤
│  ● Locutor 1          42 blocos    │
│  ● Locutor 2          18 blocos    │
│  ● Locutor 3  (atual)  7 blocos    │  ← não clicável
│  ● Locutor 4           3 blocos    │
│  ● Fabiano  ✏          5 blocos    │  ← ✏ marca nomes próprios
├─────────────────────────────────────┤
│  + Definir nome próprio             │  ← expande inline
└─────────────────────────────────────┘
```

Ao clicar em "+ Definir nome próprio", o link vira um input inline com botões "Aplicar"/"Cancelar" — não troca de tela.

### `src/lib/sessoes/block-edit.ts` (extensão)

Nova função:

```ts
/**
 * Mescla um locutor em outro: todos os blocos com `sourceId` passam a ter `targetId`.
 * Preserva nomes próprios do alvo. Reusa renameAllLocutors para reindexar.
 */
export function mergeLocutors(
  blocks: SpeakerBlock[],
  sourceId: string,
  targetId: string,
): SpeakerBlock[]
```

Se `sourceId === targetId` → retorna `blocks` sem mudança.

### `src/app/(dashboard)/sessoes/page.tsx` (modificação)

- Remover `handleRenameLocutor` que usa `window.prompt()`
- Adicionar state: `pickerState: { open, anchorRect, blockId } | null`
- Shift+clique no nome → abre popover ancorado no `getBoundingClientRect()` do span
- `handleSpeakerPick(targetId)` chama `mergeLocutors(...)` + `persistSegments` + toast "Bloco atribuído a Locutor X"
- `handleSpeakerRename(name)` chama `renameLocutor(...)` (mantém função existente) + persist + toast "Locutor X renomeado para ..."
- Computa `speakers` derivado de `selectedSessao.transcricao.segments` (Map por speakerId)

## Tokens visuais

| Propriedade | Valor |
|---|---|
| Background | `#fff` |
| Border | `1px solid #e5e7eb` |
| Border-radius | `12px` |
| Shadow | `0 12px 32px rgba(15,23,42,.18), 0 2px 6px rgba(15,23,42,.08)` |
| Header bg | `#f8fafc` |
| Header text | `#64748b`, `uppercase`, `letterSpacing .05em`, `0.68rem` |
| Item hover | `#f3f4f6` |
| Item atual | `#eff6ff`, cursor default, opacity .75 |
| Color dot | `10px × 10px`, `border-radius: 50%`, background = `speakerColor` |
| Contador | `#9ca3af`, `0.7rem` |
| Entry animation | `speakerPickerIn 180ms cubic-bezier(.2,.8,.2,1)` |

## Edge cases

1. **Transcrição com só 1 locutor** → popover mostra só o atual (não-clicável); mesmo assim é possível usar "+ Definir nome próprio"
2. **Nome vazio no rename** → ignora, mantém popover aberto
3. **Clique no locutor "(atual)"** → no-op silencioso (não fecha, não mostra toast)
4. **Resize da janela** → popover fecha (seria complexo reposicionar mid-lifecycle)

## Fora de escopo

- Sugestão automática de nomes próprios
- Integração com base de conhecimento de vereadores
- Desfazer (undo) — já existe via CTRL+Click split

## Arquivos afetados

| Arquivo | Natureza |
|---|---|
| `src/components/sessoes/speaker-picker.tsx` | Novo |
| `src/lib/sessoes/block-edit.ts` | +função `mergeLocutors` |
| `src/app/(dashboard)/sessoes/page.tsx` | Remove `window.prompt`, adiciona state + render |
