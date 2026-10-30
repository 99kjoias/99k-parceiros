# Escada de comissão (30/10/2026)

Aplicado direto no projeto Supabase `99k-parceiros` (migrações `escada_niveis_afiliados` e
`escada_previsao_respeita_nivel_definido`). Resumo do que existe no banco:

- `niveis`: 1 = 7% (a partir de R$0), 2 = 10% (R$1.500), 3 = 12% (R$4.000), 4 = 15% (R$8.000).
- `parceiros.nivel`: nível atual do afiliado (padrão 1).
- `parceiro_nivel_mes`: nível de cada afiliado em cada mês, com o nível anterior, o faturamento do
  mês anterior, a mudança (`inicial`, `subiu`, `desceu`, `manteve`) e quando o e-mail saiu.
- `escada_inicio()` = 2026-11-01: vendas de outubro ficam com a comissão da campanha.
- Gatilho `vendas_preparar`: a partir de novembro, a comissão da venda vem do nível do afiliado no
  mês da venda (o desconto do cupom continua vindo da campanha).
- `definir_niveis(mes)`: chamada no fim de `fechar_mes` (dia 1, 00h05). Faturamento = vendas válidas
  do mês (valor pago pelas peças, sem frete; devolvida conta). Sobe direto para a faixa alcançada;
  abaixo do piso do nível atual, desce um nível só. Nível já definido para o mês seguinte não é
  sobrescrito. Vendas do mês novo registradas antes do fechamento passam para a comissão nova.
- `meu_nivel()` (painel do afiliado) e `niveis_afiliados()` (lojista).
- Nível inicial de novembro: Raquel e Rapha no nível 2 (decisão de Matheus); os demais pelas
  vendas de outubro.
- Função `niveis-avisos` + pg_cron `afiliados-niveis-avisos` (todo dia, 00h20 de Brasília): e-mail de
  parabéns na subida e aviso neutro na descida.

## Ajustes de 30/10/2026, noite (migração `escada_nomes_e_campanhas`)

- Níveis com nome (Matheus): Bronze (7%), Prata (10%), Ouro (12%), Diamante (15%). Coluna `niveis.nome`.
- `campanhas.escada`: a escada vale só nas campanhas marcadas (Campanha padrão e Especial). Nas outras,
  a venda segue com a comissão da campanha e o fechamento não mexe no nível.
- E-mails de nível (`niveis-avisos`): só no dia 1, às 10h de Brasília (pg_cron `0 13 1 * *`).
