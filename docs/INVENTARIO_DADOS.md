# Inventário de dados e recuperação

## Situação atual

As migrations do Connect Vaquejada estão aplicadas e verificadas no branch Neon `TESTE`. O projeto decidiu iniciar sem os registros anteriores; portanto, nenhuma carga de dados antiga foi realizada. Cadastre novamente no Neon os usuários, parques, eventos, inscrições e demais informações necessárias.

| Superfície | Dados | Recuperação |
| --- | --- | --- |
| Neon Auth e PostgreSQL | Identidades e dados conectados do aplicativo. O schema é versionado em `neon/migrations/`. | Use os recursos de backup/restore do Neon e teste a restauração em branch isolado. A aplicação não gera backup integral do Postgres. |
| IndexedDB (`pdm-local`) | Dados locais do navegador e filas offline. | O backup JSON da aplicação cobre os dados operacionais exportáveis, mas não todas as stores técnicas. Não sincroniza automaticamente com Neon. |
| Coordenador LAN (SQLite) | Registros, versões, operações e conflitos do modo de rede local. | `npm run coordinator:backup` cria cópias SQLite. Esses dados são independentes do banco Neon. |

Não há integração ativa com o banco anterior nem processo de importação de registros. Dados existentes em navegadores ou em bancos locais permanecem separados do Neon; importe-os manualmente somente se o projeto decidir fazê-lo no futuro, com procedimento próprio e validação de IDs e relacionamentos.

Consulte [Coordenador local](./COORDENADOR_LOCAL.md) para backup e recuperação SQLite e [Migração Neon](./MIGRACAO_NEON.md) para configuração e verificação do banco conectado.
