# Programa de Afiliados 99K

Sistema próprio de afiliados (influenciadores e divulgadores) da 99K Joias, no lugar da Adzy.
Endereço: https://afiliados.99kjoias.com.br

## Páginas (pasta `public/`, publicadas pelo Cloudflare Pages a cada mudança neste repositório)

| Página | Para quem | O que faz |
|---|---|---|
| `index.html` | Público | Apresenta o programa e recebe o cadastro (dados, endereço, CPF, @, código desejado, coleção preferida, chave Pix, aceite das regras) |
| `entrar.html` | Afiliados e lojista | Login, esqueci minha senha e nova senha |
| `painel.html` | Afiliado | Cupom, condições da campanha, vendas e comissão do mês em tempo real, meses fechados |
| `admin.html` | Lojista | Fila de moderação, afiliados, vendas, fechamentos (a pagar / pagamento realizado, com comprovante do Pix em PDF ou imagem), campanhas, coleções do cadastro |

## Servidor (Supabase, projeto `99k-parceiros`, São Paulo)

Funções em `supabase/functions`:

- `cadastro`: cria o login e o cadastro em análise.
- `admin`: ações do lojista (aprovar e criar o cupom na Shopify, recusar, pausar, encerrar, campanhas, marcar pago).
- `shopify-webhook`: recebe da Shopify os avisos de pedido pago e cancelado.
- `conferencia`: de hora em hora, liga os avisos da Shopify, relê os pedidos das últimas 72 horas e atualiza as coleções.
- `niveis-avisos`: no dia 1, às 10h de Brasília, manda o e-mail de quem subiu (parabéns) ou desceu de nível.
- `niveis-anuncio`: e-mail único de anúncio da escada aos afiliados (prévia, teste para adm@ e envio, protegido por token guardado no banco).

Rotinas no banco (pg_cron): conferência de hora em hora (minuto 17) e fechamento do mês no dia 1, 00h05 de Brasília.

## Regras de negócio (decididas por Matheus em 14/10/2026)

- Comissão sobre o valor pago pelas peças, depois de todos os descontos, sem frete.
- Escada de comissão (Matheus, 30/10/2026), só nas campanhas marcadas com escada (Campanha padrão e Especial), para as vendas a partir de novembro de 2026: Bronze 7% até R$1.500 no mês; Prata 10% de R$1.500 a R$4.000; Ouro 12% de R$4.000 a R$8.000; Diamante 15% acima de R$8.000. O que o afiliado vende num mês define o nível do mês seguinte inteiro; sobe direto, desce um nível por vez; e-mail na subida e na descida, no dia 1 às 10h. O desconto do cupom continua vindo da campanha. Detalhe em `supabase/migrations/20261030_escada_niveis.md`.
- Só conta pedido pago. Cancelado sai; devolvido mantém a comissão.
- Mês pelo horário de Brasília, pela data do pedido. Fecha no último dia.
- Pedido de mês já fechado cancelado depois: desconta no fechamento seguinte, como ajuste.
- Comprovante do Pix: o lojista anexa no fechamento (pasta privada `comprovantes`, até 5 MB); o afiliado vê só os dele no painel.
- Aviso de venda por e-mail: só para quem aceitou (na ativação ou no painel, em "Avisos por e-mail"); pedidos com mais de 3 dias achados pela conferência não geram aviso.
- Afiliado recusado ou encerrado pode se cadastrar de novo e volta para a fila de análise.
- Compra do próprio afiliado com o próprio cupom (mesmo CPF, e-mail, telefone ou CEP + número do cadastro): fica registrada como "propria", sem comissão e fora do ranking. O lojista pode tirar ou devolver a comissão de um pedido antes do fechamento. Os dados de contato do pedido só são comparados, nunca guardados.
- Cupom combina com o desconto progressivo e não combina com outro cupom.
- O sistema só calcula e mostra; o pagamento é feito por Matheus ou Isabelle.
- Nenhum dado da cliente é guardado: só número do pedido, data, valor e cupom.

## Segredos (configurados no painel do Supabase, nunca neste repositório)

`SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` (app do Dev Dashboard da Shopify), e opcionais `RESEND_API_KEY`, `EMAIL_REMETENTE`, `EMAIL_AVISO_LOJISTA`.

## Nomenclatura

Nas telas e e-mails o nome é sempre **afiliado(s)** (decisão de Matheus, 14/10/2026). Os nomes internos do banco (tabela `parceiros`, coluna `parceiro_id`) ficaram como estavam. Endereço oficial: afiliados.99kjoias.com.br (o antigo parceiros.99kjoias.com.br redireciona para ele).
