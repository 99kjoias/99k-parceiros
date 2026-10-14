# Programa de Afiliados 99K

Sistema próprio de afiliados (influenciadores e divulgadores) da 99K Joias, no lugar da Adzy.
Endereço: https://afiliados.99kjoias.com.br

## Páginas (pasta `public/`, publicadas pelo Cloudflare Pages a cada mudança neste repositório)

| Página | Para quem | O que faz |
|---|---|---|
| `index.html` | Público | Apresenta o programa e recebe o cadastro (dados, endereço, CPF, @, código desejado, coleção preferida, chave Pix, aceite das regras) |
| `entrar.html` | Afiliados e lojista | Login, esqueci minha senha e nova senha |
| `painel.html` | Afiliado | Cupom, condições da campanha, vendas e comissão do mês em tempo real, meses fechados |
| `admin.html` | Lojista | Fila de moderação, afiliados, vendas, fechamentos (marcar pago), campanhas, coleções do cadastro |

## Servidor (Supabase, projeto `99k-parceiros`, São Paulo)

Funções em `supabase/functions`:

- `cadastro`: cria o login e o cadastro em análise.
- `admin`: ações do lojista (aprovar e criar o cupom na Shopify, recusar, pausar, encerrar, campanhas, marcar pago).
- `shopify-webhook`: recebe da Shopify os avisos de pedido pago e cancelado.
- `conferencia`: de hora em hora, liga os avisos da Shopify, relê os pedidos das últimas 72 horas e atualiza as coleções.

Rotinas no banco (pg_cron): conferência de hora em hora (minuto 17) e fechamento do mês no dia 1, 00h05 de Brasília.

## Regras de negócio (decididas por Matheus em 14/10/2026)

- Comissão sobre o valor pago pelas peças, depois de todos os descontos, sem frete.
- Só conta pedido pago. Cancelado sai; devolvido mantém a comissão.
- Mês pelo horário de Brasília, pela data do pedido. Fecha no último dia.
- Pedido de mês já fechado cancelado depois: desconta no fechamento seguinte, como ajuste.
- Cupom combina com o desconto progressivo e não combina com outro cupom.
- O sistema só calcula e mostra; o pagamento é feito por Matheus ou Isabelle.
- Nenhum dado da cliente é guardado: só número do pedido, data, valor e cupom.

## Segredos (configurados no painel do Supabase, nunca neste repositório)

`SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` (app do Dev Dashboard da Shopify), e opcionais `RESEND_API_KEY`, `EMAIL_REMETENTE`, `EMAIL_AVISO_LOJISTA`.

## Nomenclatura

Nas telas e e-mails o nome é sempre **afiliado(s)** (decisão de Matheus, 14/10/2026). Os nomes internos do banco (tabela `parceiros`, coluna `parceiro_id`) ficaram como estavam. Endereço oficial: afiliados.99kjoias.com.br (o antigo parceiros.99kjoias.com.br redireciona para ele).
