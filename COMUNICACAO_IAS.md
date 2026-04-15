# COMUNICAÇÃO ENTRE IAs — Sessão de 30/03/2026

## De: Antigravity (Google Gemini) → Para: Claude (Anthropic)
**Data:** 30/03/2026
**Contexto:** Módulo CADIN (Diários Oficiais), Automação ALIA (Aniversariantes), Modais de UI e Correção de Contexto Temporal da IA.

---

## O QUE FOI FEITO AGORA (Upgrade de UI/UX e Modais)

Acabo de concluir uma grande refatoração de interface que deve subir no próximo **Deploy**:
1. **Configurações de Gabinete:** O arquivo `src/components/configuracoes/gabinete-form.tsx` foi totalmente reestilizado para usar estética *Glassmorphism/Premium*. Substituí os `<input type="checkbox">` de comissões por pílulas visuais interativas.
2. **Topbar Integrado:** O `src/components/topbar.tsx` agora abriga dois novos modais:
   - **Menu do Usuário (Sino & Avatar):** Com dropdown animado contendo "Minha Conta", "Meu Plano (SaaS)" e "Sair".
   - **Ajuda do Sistema:** Um modal completo criado em `src/components/ui/system-help-modal.tsx` que serve como documentação viva do sistema (explicando CADIN, Pareceres, Indicações e ALIA).
3. **Migração do Plano SaaS:** Removi o `IAPlanManager` da aba de Inteligência Artificial nas configurações administrativas e o embuti no perfil do usuário `src/components/ui/user-settings-modal.tsx` para garantir que o plano SaaS seja inerente ao usuário logado e não ao gabinete como um todo.

**Instrução de Deploy (Claude):**
O usuário autorizou o Deploy dessas alterações. Por favor, assuma o controle (git add/commit/push) e suba as atualizações para a Vercel/VPS. Certifique-se de validar se o build não quebra devido a novas importações do `lucide-react` (ícones novos adicionados).

---

## O QUE EU FIZ (Sessão Anterior)

Nesta sessão foquei em modernizar a extração de inteligência do CADIN, na automação de disparos pelo WhatsApp, padronização de UI (Alertas) e correção de alucinação térmica / temporal da ALIA.

### 1. Refatoração do Motor de Monitoramento de D.O. (Diários Oficiais)
- `src/app/api/cadin/do-jobs/process/route.ts`: Ajustei o prompt do Gemini para filtrar **somente cargos de alto/médio escalão** (Secretários, Diretores, Comandantes), parando de trazer lixo operacional (estagiários, assistentes).
- **Matching Inteligente:** A rota agora busca similaridade exata pelo nome completo usando o banco. Caso a IA encontre uma "Nova Autoridade" que ainda não existe na base, o `person_id` vai como `null` para a tabela de rascunhos (`cadin_pending_updates`).
- `src/app/api/cadin/pending-updates/[id]/route.ts`: Refatorei o _gateway_ de aprovação humana. Agora, se um *Draft* for avaliado no Painel e a pessoa/órgão não existir, a API fará a **criação dinâmica** da Pessoa (`cadin_persons`) e do Órgão (`cadin_organizations`) no momento do aceite, vinculando imediatamente a nomeação na tabela `cadin_appointments`.
- `src/components/cadin-core/cadin-dashboard.tsx`: Adaptei o Frontend para exibir um Badge azul chamativo **"NOVA AUTORIDADE"** caso a IA sinalize que encontrou alguém inédito no D.O.

### 2. Automação ALIA: Aniversariantes do Dia
- `src/app/api/cron/alia-birthdays/route.ts`: **(NOVO ENDPOINT)** Criei uma rota segura (protegida por `CRON_SECRET`) que levanta e varre os aniversariantes do dia (`cadin_persons`) todos os dias.
- Ele unifica o Cargo, Telefones, Endereço e Órgão do aniversariante e envia o relatório em tempo real formatado de forma elegante pelo WhatsApp (utilizando a Evolution API já configurada).
- A automação coleta os telefones alvo através do `process.env.ALIA_NOTIFY_NUMBERS`.

### 3. Padronização de Modais de UI (Fim dos window.alert)
- `src/components/cadin-core/cadin-dashboard.tsx`: Substituí os antigos modais nativos do navegador (`window.alert`) que travavam a tela de forma deselegante, por modais React com design Glassmorphism (Glass-card). O estado global (`infoModal`) agora controla a finalização de sincronias bem-sucedidas do D.O e as mensagens de importação em CSV.

### 4. Correção de Alucinação de Datas da ALIA (Backend Leve)
- `src/app/api/laia/chat/route.ts`: A ALIA estava alucinando datas (ex: afirmando que amanhã era 27 de Outubro). Inseri o contexto de **Data/Hora Atual** no `ALIA_SYSTEM_PROMPT` dinamicamente via backend e incluí a instrução de tratar perguntas relativas a "amanhã" calculando D+1 e enviando pra function de consulta.

---

## O QUE VOCÊ DEVE FAZER (Claude)

### 1. Preparar Deploy Cloud Global
O usuário indicou que fará mais algumas implementações locais, porém, **assim que o sinal verde for dado**, você deve assumir as rédeas do *Deploy* para refletir essas mudanças no servidor de produção (`gabinete.wonetechnology.cloud`).

Cuidado com as seguintes variáveis de ambiente recém-criadas ou atualizadas que precisarão ir para a Nuvem de produção obrigatoriamente:

```env
# Necessário para proteger a nova Cron Job de disparos
CRON_SECRET=<Gere um secret seguro caso não exista>

# Endpoints da Evolution API
EVOLUTION_API_URL=https://<sua-instancia-evolution>
EVOLUTION_API_KEY=<sua-chave>
EVOLUTION_INSTANCE=gabinete-carol

# Números de telefone alvo das automações WhatsApp
ALIA_NOTIFY_NUMBERS=5511999999999,5511888888888 
```

### 2. Configurar CRON JOB (Deploy no Vercel ou VPS)
Como criei o novo endpoint `/api/cron/alia-birthdays/route.ts`, você precisa garantir que ele seja disparado todos os dias (Ex: às 08h00 da manhã).
- **Se for VPS/n8n:** Configure um gatilho para fazer um `GET` no `https://gabinete.wonetechnology.cloud/api/cron/alia-birthdays` passando o header `Authorization: Bearer $CRON_SECRET`.
- **Se for Vercel:** Certifique-se de adicionar ao arquivo `vercel.json` o cron diário.

### 3. Configuração do Google Calendar API (Novo Módulo)
O usuário já gerou a credencial principal no Google Cloud Platform para a integração do calendário do gabinete. Adicione ao `.env` do projeto (tanto local quanto na VPS) as seguintes chaves:

```env
# Credenciais Google OAuth2 para a funcionalidade de Agenda/Calendar
GOOGLE_CLIENT_ID=597204074940-lsdprla0dpcdv9gsjp8opmnebufbp0rm.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<Solicitar ao usuário o Client Secret caso necessário, pois não foi repassado no log>
```
Lembre-se de configurar a biblioteca do Google APIs (ou o provedor do `NextAuth`) utilizando essas chaves para autenticar a conta oficial do gabinete no deploy.

### 4. Continuidade Extra ("Padronização do window.confirm")
Ainda restam alguns botões com comportamentos do tipo `window.confirm()` (Ações destrutivas de apagar/deletar). Recomenda-se seguir a mesma padronização feita hoje, transformando-os em alertas em estilo Glass Dialog no React, para extinguir completamente o Javascript Alert arcaico de toda a aplicação.

---
**Fim da transmissão.**
