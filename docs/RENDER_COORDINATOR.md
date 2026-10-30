# Preparação do coordenador para Render

## Estrutura e diretório

O arquivo do serviço é `coordinator/server.mjs`, mas o pacote e o lockfile ficam na raiz. Portanto, no Render, deixe **Root Directory** vazio (raiz do repositório), não `coordinator/`.

- Runtime: Node
- Build command: `npm ci`
- Start command: `npm run coordinator`
- Node: `22.13.0` ou superior (`package.json` declara `engines.node`)
- Persistent Disk: monte em `/var/data`

O servidor usa o `PORT` fornecido pelo Render; `CONNECT_PDM_PORT` (padrão `8787`) é fallback para execução local. Defina `CONNECT_PDM_DB=/var/data/connect-pdm.sqlite`. SQLite criará o arquivo e os auxiliares WAL no volume persistente.

## Variáveis obrigatórias no serviço

- `CONNECT_PDM_PARK_ID`: ID do único parque atendido por esta instância.
- `CONNECT_PDM_OPERATOR_CREDENTIALS`: lista JSON não vazia de credenciais individuais. Cada entrada precisa ter `userId` UUID Auth, token aleatório exclusivo com pelo menos 32 caracteres, `role` permitido, `expiresAt` ISO-8601 futuro e `disabled: false`. Nunca use o mesmo token entre operadores.
- `CONNECT_PDM_DB=/var/data/connect-pdm.sqlite`
- `CONNECT_PDM_TRUST_PROXY_TLS=true`: opt-in explícito para TLS encerrado no proxy do Render.
- `CONNECT_PDM_ALLOWED_ORIGINS`: origens exatas que podem fazer chamadas cross-origin, por exemplo `https://seu-app.vercel.app` e o domínio customizado, separadas por vírgula.

Não defina `CONNECT_PDM_TLS_CERT`/`CONNECT_PDM_TLS_KEY` junto com `CONNECT_PDM_TRUST_PROXY_TLS=true`. Não defina `CONNECT_PDM_ALLOW_INSECURE_LAN=true`.

O modo proxy usa HTTP apenas no trecho interno entre Render proxy e processo Node; o servidor não examina `X-Forwarded-*`, não autentica por cabeçalhos de proxy e continua exigindo bearer individual validado a cada chamada protegida. CORS é uma allowlist de navegador, não uma barreira contra clientes fora do browser.

## Limites e revisão antes de publicar

Esta configuração prepara o processo para rodar em Render, mas não publica nada. Um Web Service público torna o coordenador acessível pela internet. O serviço ainda usa credenciais estáticas provisionadas manualmente, não valida sessão/claims do Neon Auth, não sincroniza SQLite com Neon, não oferece proteção contra abuso baseada em IP e não tem revisão operacional de recuperação do volume. TLS e tokens individuais não substituem esses controles. Não trate o serviço como ponte Neon nem como pronto para dados de um evento real apenas por iniciar no Render. Revise a exposição pública e o ciclo de emissão/rotação/revogação de credenciais antes de usar dados operacionais.

Este serviço não aplica migrations SQL do Neon nem precisa de credenciais de banco. Faça backup do SQLite e manifeste separadamente; volume persistente não substitui backup externo.
