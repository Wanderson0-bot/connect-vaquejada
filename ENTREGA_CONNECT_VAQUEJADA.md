# Connect Vaquejada — entrega e configuração atual

O runtime conectado usa Neon Auth, Neon Data API e PostgreSQL. As 25 migrations foram aplicadas e verificadas no branch `TESTE`. Os dados antigos não foram importados por decisão do projeto; cadastre novamente os usuários, parques e eventos necessários.

## Requisitos

- Node.js 22.13 ou superior e npm.
- Projeto Neon com Auth e Data API configurados para o branch usado pelo aplicativo.
- Para validar/aplicar migrations, conexão PostgreSQL direta do branch de teste, sem `-pooler`.

## Instalação local

1. Use `.env.example` como referência e configure as variáveis necessárias em `.env.local`, sem compartilhar credenciais.
2. Execute `npm ci` e `npm run dev`.
3. Confira o build com `npm run build` e os testes com `npm test`.
4. Para consultar hashes e verificar o journal, siga [Migração Neon](./docs/MIGRACAO_NEON.md). A verificação remota é somente leitura; não reaplique migrations já concluídas.
5. O coordenador local continua usando SQLite; consulte [Coordenador local](./docs/COORDENADOR_LOCAL.md).

## Limites

Os dados de Neon, IndexedDB e SQLite do coordenador são superfícies separadas. A aplicação não os sincroniza ou importa automaticamente. O adaptador de autenticação com nome legado é parte do SDK Neon e não configura uma conexão ao serviço anterior. Não inclua arquivos `.env` ou credenciais no pacote.
