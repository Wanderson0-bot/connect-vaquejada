# Apuração e classificação — diagnóstico e bloqueios

## Diagnóstico do comportamento existente

- `RunResult.points` é um valor informado no fluxo de resultado; o domínio não o calcula a partir de uma tabela aprovada.
- `calculateProvisionalPoints` soma os pontos armazenados dos resultados com status técnico `official`, por inscrição ativa, e ordena pela soma informativa. Esse status significa resultado confirmado no fluxo de gravação; não significa publicação de uma classificação esportiva oficial.
- Antes desta proteção, a função usava o número da senha como segundo critério de ordenação. A tela também atribuía posições sequenciais, inclusive a participantes empatados. Nenhum regulamento fornecido autorizava esses critérios.
- `officialClassificationReadiness` confiava em flags e texto de `competition.scoring` mantidos na configuração do evento. Salvar `approved: true` no cliente não comprova aprovação autorizada no servidor.
- O console de pista agora registra o valor anunciado pelo juiz em cada corrida, registra zero como 0 e não calcula pontos pela distância. O bônus opcional de cinco pontos é configurável por evento, aplicado manualmente com justificativa e mantido separado da pontuação do juiz. O console exibe totais provisórios por inscrição/categoria após a confirmação; isso ainda não é uma apuração oficial.
- Os modelos/migrations atuais não contêm registro de regulamento aprovado com versão, aprovador, documento de referência, histórico, cálculo versionado ou classificação publicada/versionada. Resultado e pontuação podem ser enviados pelo cliente; ainda não são derivados de regulamento aprovado no servidor.
- O CSV existente é um relatório administrativo: inclui informações de inscrição e pagamento. Não é uma exportação pública segura de classificação.

## Proteções implementadas sem inventar regras

- O indicador de prontidão da interface falha fechado até haver aprovação de regulamento registrada e validada no servidor; flags configuradas no cliente não liberam o bloqueio. Este bloqueio de interface não substitui autorização server-side. O fluxo de aprovação/publicação e o registro de regulamento no servidor ainda não existem, e não há uma rota de publicação oficial implementada.
- A soma disponível na tela é explicitamente provisória e não recebe números de posição. O número da senha não é usado como desempate.
- O relatório CSV informa que é provisório, que nenhuma posição oficial foi calculada e que o documento é de uso interno, pois inclui dados de inscrição/pagamento. Não deve ser publicado como classificação.
- Os registros existentes não são apagados ou reescritos por esta mudança. Resultados confirmados continuam sendo consultáveis como registros operacionais.
- Cada inscrição permanece independente, mesmo quando o mesmo vaqueiro possui várias senhas. O console limita corridas por inscrição conforme `racesPerEntry` configurado em cada rodízio e impede que inscrições sem pagamento confirmado entrem na fila.

## Decisões que a organização precisa fornecer

O responsavel confirmou que nao existe regulamento formal aprovado. Regras e criterios ja informados pelo usuario estao registrados em `docs/PENDENCIAS_REGULAMENTO_PDM.md` e devem ser preservados como insumos, nao tratados como inexistentes nem automaticamente como aprovados. A comissao deve organiza-los, resolver lacunas e divergencias, deliberar e aprovar o regulamento aplicavel ao evento, incluindo versao/data de vigencia, categorias/modalidades abrangidas e referencia verificavel. O regulamento precisa especificar, sem lacunas que alterem o resultado:

- fórmula/tabela de pontuação e quais resultados/etapas entram no cálculo;
- significado de zero, retorno, ausência, penalidade e desclassificação; elegibilidade e tratamento de resultados incompletos/corrigidos;
- sequência e aplicação dos critérios de desempate; o que fazer quando todos os critérios deixam empate;
- quem registra, valida e corrige resultados, quem aprova o regulamento e quem confere/aprova/publica a classificação;
- como uma mudança no regulamento ou resultado afeta apurações/publicações anteriores.

Também são necessários exemplos fictícios ou oficiais autorizados, com entradas e resultado esperado, conferidos independentemente pela organização. Sem esse material, não se deve produzir campeão, posição oficial, motor de pontuação ou critério substituto.

## Trabalho ainda necessário após receber o regulamento

1. Modelar no servidor as versões imutáveis das regras aprovadas e suas aprovações autenticadas, limitadas ao evento/parque; não confiar em sinalizadores enviados pelo navegador.
2. Implementar a apuração determinística versionada, usando os pontos registrados pelo juiz e as decisões esportivas específicas aprovadas; bloquear dados ausentes, inconsistentes ou pendentes.
3. Persistir snapshots de resultados/regras usados em cada apuração, responsáveis, conferência, publicação e revisões, preservando versões publicadas.
4. Implementar permissões server-side para aprovação, conferência e publicação; validar isolamento por parque/evento.
5. Separar relatório administrativo restrito da publicação pública, e testar consistência de versão entre tela e arquivo sem dados financeiros/privados na publicação.
6. Executar testes com os casos de referência aprovados, suíte de regressão e homologação em ambiente de teste; nenhum projeto remoto foi alterado nesta etapa.

**Situação atual:** classificação oficial e publicação permanecem bloqueadas. A mudança presente é uma proteção de UX/domínio e de exportação; não constitui homologação esportiva nem autorização para usar a apuração em competição real.
