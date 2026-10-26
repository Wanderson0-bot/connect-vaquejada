# Publicação pública de eventos

## Fluxo

1. O responsável autenticado do parque confirma a descrição e a lista de premiações autorizadas para divulgação. O banco associa a confirmação ao evento e à identidade que a realizou.
2. Uma pessoa com papel `platform_admin` revisa o snapshot e registra a justificativa da aprovação.
3. A mesma função administrativa libera a publicação em uma ação separada. A RPC pública não retorna eventos apenas confirmados ou aprovados.
4. A pessoa administradora pode retirar um evento publicado, com justificativa auditada. O parque pode então confirmar novamente e reiniciar o fluxo de revisão.

## Dados expostos

A RPC pública `list_public_events` retorna somente nome do evento, local, período, categorias, premiações confirmadas, resumo público, nome e município/UF do parque e data de publicação. Os dados são servidos do snapshot confirmado; alterações internas posteriores não mudam silenciosamente o conteúdo aprovado. Inscrições, pagamentos, contatos privados, configuração esportiva, auditoria e resultados/classificação não são incluídos.

## Ativação

Aplicar `202610250021_public_event_publication.sql` depois de `202610240020_park_name_identity.sql`. Conferir as permissões dos RPCs e executar os testes de integração em Supabase de homologação antes de habilitar no ambiente do evento. O dashboard administrativo passa a contar publicações reais após a migration.

## Limite

Este módulo publica informações de agenda. Não aprova regulamento, não calcula classificação e não publica resultados esportivos. Esses recursos precisam de regras da comissão formalmente aprovadas, versão imutável do cálculo, aprovação de resultados e testes comparativos com casos oficiais.

## Aplicação

Aplicar `202610250021_public_event_publication.sql` e `202610250022_connect_park_code.sql` em ordem, após as migrations anteriores. O código Connect de parque é uma referência administrativa gerada pelo servidor; ele não autentica nem autoriza usuários.
