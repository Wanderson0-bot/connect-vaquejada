# Connect Vaquejada — pacote de trabalho

Este pacote preserva a aplicação existente e inclui uma primeira melhoria de interface responsiva e navegação pública para detalhes de eventos. Não é uma homologação de produção e não deve ser tratado como um sistema integralmente validado.

## Requisitos
- Node.js 22.16+ (recomendado Node 24 LTS quando disponível)
- npm
- Projeto Supabase configurado para autenticação e dados remotos, conforme `supabase/`

## Instalação
1. Extraia o ZIP para uma pasta local.
2. Copie `.env.example` para `.env.local`.
3. Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os valores do seu projeto.
4. No terminal, dentro da pasta do projeto, execute:
   ```sh
   npm ci
   npm run dev
   ```
5. Para validar o build, execute `npm run build`.
6. Para iniciar o coordenador local, configure as variáveis indicadas em `coordinator/.env.example` e execute `npm run coordinator`.

## Mudanças nesta entrega
- Refinamento responsivo complementar de estilos e estados de foco acessíveis.
- Detalhe público de evento em `/eventos/:id`, utilizando apenas dados retornados pelo endpoint público existente.
- Links de calendário para abrir o detalhe do evento e retornar à listagem.
- Documentação de instalação e limitações conhecidas.
- Segredos locais, caches e artefatos temporários excluídos do pacote.

## Limitações que permanecem e precisam de correção/teste
- A auditoria original identificou que o coordenador rejeita gravações de `track_states`; o fluxo da pista em rede não deve ser considerado homologado.
- O teste de backup SQLite pode falhar em Node 22 por uso de `DatabaseSync.serialize()`, que não existe nessa API. O backup precisa ser corrigido e testado antes de uso em produção.
- A bateria de testes completa e o build não foram validados nesta sessão, pois a instalação de dependências não concluiu. Alguns testes Node sem dependências passaram, outros falharam por falta de TypeScript/dependências ou pela falha do backup.
- A sincronização do coordenador SQLite com Supabase não está implementada no código auditado.
- Não há site público completo de parque nem publicação pública de classificações/resultados nesta entrega.
- A aplicação precisa ser testada com Supabase configurado, contas e funções reais, múltiplos dispositivos, perda/reconexão de rede e restauração de backup.

## Segurança
Nunca inclua `.env.local`, tokens, chaves privadas ou bancos reais ao compartilhar o projeto. As migrações Supabase são fornecidas como arquivos; este pacote não executa nem aplica migrações remotas automaticamente.
