# Auditoria técnica do coordenador local

Data: 2026-10-22

## Correção aplicada nesta revisão

- O servidor agora valida as ações permitidas por tipo de registro:
  - `events`: `create`, `update`
  - `entries`: `create`, `update`
  - `reservations`: `create`, `update`, `convert`
  - `run_results`: `create`, `confirm`, `correct`
- Isso bloqueia, por exemplo, uma operação `confirm` usada para alterar diretamente um evento ou uma inscrição.
- A conversão de reserva agora também exige que o evento e o número do payload continuem iguais aos da reserva original.

## Verificações executadas

- `npm test`: 16 testes passaram.
- `node node_modules/typescript/bin/tsc -b`: passou.
- O build Vite não pôde ser revalidado neste ambiente Linux porque o `node_modules` fornecido no ZIP não contém o binário opcional `@rollup/rollup-linux-x64-gnu`; isso é compatível com dependências instaladas em outro sistema operacional. Não significa que o build de origem esteja quebrado. Reinstale as dependências no ambiente de destino e execute `npm run build`.

## Limitações que continuam abertas

- Não foi implementada sincronização coordenador ↔ Supabase.
- Não existe interface de resolução/reconciliação de conflitos.
- O token compartilhado do coordenador não substitui contas individuais, papéis ou autorização por operação.
- A rota de saúde não autenticada retorna apenas um estado genérico; as demais rotas de API continuam exigindo credenciais. Evite expor a porta do coordenador à internet.
- A sincronização e a fila IndexedDB não foram validadas em navegadores/aparelhos reais, rede local com vários dispositivos ou interrupção/restauração da internet.
- Não foram executados testes de isolamento entre parques contra um projeto Supabase real.
- Pista completa, permissões da equipe, classificação avançada, locução, portal público, financeiro completo e gestão comercial seguem pendentes.

## Critério de liberação

Não usar em competição oficial até concluir testes multiaparelho em rede isolada, testes de queda e retorno da rede, reconciliação de conflitos, validação de permissões/RLS em Supabase e ensaio operacional com backup e restauração.


### Endurecimento adicional desta rodada

- O coordenador não inicia mais por padrão em interfaces de rede sem HTTPS, pois o token Bearer protege todas as operações e não deve trafegar em texto claro no Wi-Fi. A exceção de laboratório é explícita e documentada.
- Adicionado teste automatizado que verifica o bloqueio da configuração insegura.

### Protocolo de replay e conflitos — 23/10/2026

- A idempotência agora compara operador, dispositivo, tipo/ID de entidade, ação, versão-base e payload JSON canônico. Reuso de ID com outro envelope é recusado e persistido em `operation_attempts`; somente `park_manager` pode consultar `/api/operation-attempts`.
- O resultado de cada operação aceita ou conflitante é persistido na mesma transação SQLite da gravação operacional e do log. Repetir uma requisição após perda de resposta, reinício ou restauração devolve o resultado original. A inicialização adiciona a coluna necessária e recupera respostas de operações antigas a partir do log/conflito existente.
- Conflitos devolvem versão atual, registro atual e referência persistente; a operação recusada e seu estado conflitante continuam no SQLite para revisão. Campos extras na raiz de uma operação são recusados.
- Testes HTTP/SQLite isolados cobrem replay idêntico e adulterado, usuário/aparelho distintos, disputa concorrente de versão, rollback de conversão inválida, recuperação após reinício e cópia/restauração temporária do banco. A pista continua bloqueada.

Essas verificações automatizadas não homologam aparelhos reais, a fila IndexedDB no navegador, certificados TLS nos dispositivos, Wi-Fi sem internet externa, nem a restauração operacional em hardware separado. Os critérios de liberação do evento oficial permanecem pendentes.
