# Gabinete Virtual - Design System & Brand Guidelines

## 1. Identidade Visual e Logomarca
A nova identidade visual do **Gabinete Virtual** transmite seriedade institucional, sofisticação digital e integração tecnológica. A logomarca apresenta:
- **Ícone:** Um prédio governamental/institucional centralizado, envolto em trilhas de circuito ("placa-mãe"), unindo as esferas do governo tradicional com a hiper-automação da Inteligência Artificial.
- **Tipografia:** Uma fonte *sans-serif* forte e digital (como *Inte*r ou análoga em formato *Bold/Black*), exibida com as palavras "Gabinete" e "Virtual" empilhadas e com espaçamento negativo (`letter-spacing: -0.02em`).

## 2. Paleta de Cores (Colors)

O sistema abandonou o antigo "Azul Neon/Índigo" em favor de uma paleta sofisticada inspirada nos tons da logomarca aprovada:

### **Primary (Tons Escuros e Profundos - "Navy")**
Usados em tipografia de alto contraste, backgrounds de ícones institucionais e gradientes base.
- `--primary-900`: `#050c17`
- `--primary-800`: `#0B192C` (Cor principal do Texto "Gabinete Virtual" na logo)
- `--primary-700`: `#10243f`
- `--primary-600`: `#16325B` (Fundo primário do Ícone da logo)
- `--primary-500`: `#1c4076`
- `--primary-400`: `#29579c`

### **Accent (Tons Claros e Tecnológicos - "Cyan/Digital Blue")**
Usado para ações primárias, CTAs (Call to Actions como o botão "Protocolar"), botões da ALIA e trilhas de circuitos na logo.
- `--accent-500`: `#488DC7` (Cor principal dos circuitos e dos ícones ativos)
- `--accent-400`: `#68A5D6`
- `--accent-300`: `#8CBEF0`

*Nota Técnica:* As cores primárias no Tailwind ou CSS Vars globais foram substituídas globalmente onde o antigo `#3b82f6` (blue-500) operava, sendo mapeadas para os novos códigos `#488DC7` (Accent) e `#1c4076` (Primary Hover/Gradient End).

## 3. Iconografia (Icons)

**Migração Estética:**
A versão antiga do Gabinete Virtual e de seus painéis (Indicações, Pareceres, etc.) utilizava `emojis` nas abas e títulos para separação visual (ex: 📋, 🛡️, ⚡). Esta prática foi **descontinuada**.

**Novo Padrão (Minimalista):**
O sistema agora adota ícones estritamente vetorizados e minimalistas, providos pela biblioteca **Lucide React**. 
- Os ícones operam dentro da paleta de cores brand-safe (ex: cinza chumbo `#4b5563` inativos, e `--accent-500` `#488DC7` ou `--primary-500` `#1c4076` para estado ativo).
- **Sem emojis na interface.**

Exemplos de mapeamento realizado:
- 📥 Inbox (Bruto) → `<Archive />`
- 🛡️ Kanban / Moderação ALIA → `<Shield />`
- 📋 SAPL → `<ClipboardList />`
- ⚡ Chat ALIA → `<Zap />`

## 4. UI / UX Principles
1. **Glassmorphism Base:** Background branco gelo ou puro (`#ffffff` a `#f3f4f6`), mantendo cartões com bordas suaves (`border-radius: 8px`), e leve `box-shadow` na elevação.
2. **"Clean Design":** Foco em dados estruturados legíveis e em telas limpas para minimizar fadiga visual.
3. **Consistência Semântica:** O verde, vermelho e amarelo institucionais para badgets de status (`success`, `danger`, `warning`) continuam em uso por usabilidade universal.
