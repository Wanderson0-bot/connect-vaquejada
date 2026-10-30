# Guia rápido do Connect Vaquejada

## Escolha a área certa

| O que você quer fazer | Onde entrar | Quem pode acessar |
| --- | --- | --- |
| Ver eventos divulgados | `/` ou `/eventos` | Visitantes |
| Administrar a plataforma e os parques | `/connect` | Equipe Connect com função administrativa ativa |
| Operar um parque ou evento | `/operacao` | Conta com vínculo e permissões ativos |

O endereço da página só abre a tela. Ele não concede acesso: Neon Auth valida a sessão e o Neon PostgreSQL aplica as permissões por meio da Data API e das policies RLS.

O modo conectado só funciona depois que Auth, Data API e as migrations do Connect estiverem configurados no projeto Neon. Consulte [Migração para Neon](./MIGRACAO_NEON.md) para os pré-requisitos e o estado da homologação.

## Primeiro acesso da equipe Connect

1. Crie a conta da pessoa no Neon Auth.
2. Um operador confiável do banco precisa conceder a primeira função `platform_admin`. O aplicativo não oferece autoprovisionamento administrativo.
3. Entre no site com essa conta e abra `/connect`.
4. No painel, escolha **Parques → Cadastrar primeiro parque**.
5. Abra o perfil do parque para cadastrar eventos e continuar a configuração.

Se ainda não existe parque, isso não impede a entrada de um administrador Connect. O primeiro bloqueio é a função administrativa da conta.

## Primeiro acesso de um parque

1. Um administrador Connect cadastra o parque.
2. No perfil do parque, crie um convite individual para o responsável.
3. Copie o link gerado e envie manualmente ao mesmo endereço de email informado. O sistema não envia convites por email automaticamente.
4. A pessoa abre o link, cria a conta ou entra com a conta existente e confirma o email, se solicitado.
5. Depois da validação, o vínculo do parque é ativado e a conta segue para `/operacao`.

Convites de equipe operacional são associados a eventos. O perfil do parque e a operação não dão acesso ao painel Connect.

## Rotina operacional

1. Em **Vaquejadas**, cadastre ou selecione um evento.
2. Em **Inscrições e senhas**, registre e acompanhe inscrições.
3. Em **Pista e resultados**, opere somente as ações autorizadas ao seu perfil.
4. Consulte **Backup** para exportar os dados disponíveis e **Auditoria** para revisar alterações, quando essas áreas estiverem disponíveis ao seu perfil.

Resultados e totais provisórios não equivalem a classificação oficial. A tela de cada função mostra apenas operações que o servidor autorizou.

## Entenda onde os dados ficam

- **Neon conectado:** autenticação Neon Auth e dados PostgreSQL sujeitos às policies e permissões do servidor.
- **Local/IndexedDB:** dados guardados neste navegador e aparelho; não são login e não sincronizam entre dispositivos.
- **Coordenador LAN:** pode compartilhar dados locais entre aparelhos configurados na rede; não significa sincronização com Neon.

Observe o indicador de estado na operação. “Local”, “pendente”, “bloqueado” e “sincronizado” representam estados distintos; uma mensagem de sincronização só aparece depois de confirmação do serviço.

## Se um convite não funcionar

- Entre com o mesmo email que recebeu o convite e confirme-o no Neon Auth.
- Para convite que exige confirmação, volte ao mesmo navegador onde abriu o link; o sistema guarda ali o token temporário até validar o acesso.
- Convites expirados, revogados, usados por outro email ou incompatíveis com o perfil são recusados pelo servidor. Peça um novo convite ao administrador.
- A tela exibe um link porque o envio automático por email ainda não está integrado.
