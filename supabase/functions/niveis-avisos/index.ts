// Escada de comissão dos afiliados: avisa por e-mail quem subiu ou desceu de nível.
// Roda no dia 1, às 10h de Brasília (pg_cron "afiliados-niveis-avisos"); só manda o que ainda não foi enviado.
// Níveis: Bronze, Prata, Ouro e Diamante (Matheus, 30/10/2026).
// Nenhum dado de cliente. Publicada no Supabase com o util.ts ao lado (import "./util.ts").
import { adminDb, enviarEmail, moldeEmail, esc, json, SITE_PARCEIROS } from "../_shared/util.ts";

const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number) => `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const nomeMes = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("pt-BR", { month: "long", timeZone: "UTC" });
function somaMes(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n, 1);
  return d.toISOString().slice(0, 10);
}

const botao = `<p><a href="${SITE_PARCEIROS}/entrar" style="display:inline-block;background:#004236;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Ver no meu painel</a></p>`;
const linha = (rotulo: string, valor: string, forte = false) =>
  `<tr><td style="padding:8px 0;color:#5f6966">${rotulo}</td><td style="padding:8px 0;text-align:right;${forte ? "font-weight:bold;font-size:18px;color:#004236" : ""}">${valor}</td></tr>`;
const tabela = (linhas: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #d6ddd9;border-bottom:1px solid #d6ddd9;margin:6px 0 16px">${linhas}</table>`;

Deno.serve(async () => {
  const db = adminDb();
  const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const mesAtual = hoje.slice(0, 8) + "01";

  const { data: niveis } = await db.from("niveis").select("nivel,nome,minimo,comissao_pct").order("nivel");
  const nv = new Map((niveis ?? []).map((n: any) => [n.nivel, n]));

  const { data: pend, error } = await db.from("parceiro_nivel_mes")
    .select("parceiro_id,mes_ref,nivel,nivel_anterior,faturamento_mes_anterior,mudanca,parceiros(nome,email,status)")
    .in("mudanca", ["subiu", "desceu"]).is("email_enviado_em", null).eq("mes_ref", mesAtual);
  if (error) return json({ erro: error.message }, 500);

  const resultado = { enviados: 0, falhas: 0 };
  for (const m of pend ?? []) {
    const p: any = (m as any).parceiros;
    if (!p || p.status !== "aprovada" || !p.email) continue;
    const primeiro = esc(String(p.nome).split(" ")[0]);
    const novo: any = nv.get(m.nivel);
    const ant: any = nv.get(m.nivel_anterior);
    const mesAnt = nomeMes(somaMes(m.mes_ref, -1));
    const mes = nomeMes(m.mes_ref);
    const mesSeg = nomeMes(somaMes(m.mes_ref, 1));
    let assunto = "", html = "";

    if (m.mudanca === "subiu") {
      const prox: any = nv.get(m.nivel + 1);
      const proximo = prox
        ? `<p>Próximo degrau: vendendo ${brl(prox.minimo)} em ${mes}, você vai para o nível ${prox.nome} e ganha ${pct(prox.comissao_pct)} em ${mesSeg}.</p>`
        : `<p>Você chegou ao nível mais alto do programa. Para continuar nele, é só manter as vendas acima de ${brl(novo.minimo)} por mês.</p>`;
      assunto = `Parabéns, ${primeiro}! Você subiu para o nível ${novo.nome}`;
      html = moldeEmail(`Parabéns, ${primeiro}! Você subiu de nível`,
        `<p>Em ${mesAnt} você vendeu <strong>${brl(m.faturamento_mes_anterior)}</strong> com o seu cupom e subiu para o <strong>nível ${novo.nome}</strong>.</p>
         ${tabela(
           linha("Nível anterior", `${ant?.nome ?? ""} (${pct(ant?.comissao_pct ?? 0)})`) +
           linha(`Sua comissão em ${mes}`, pct(novo.comissao_pct), true))}
         <p>A comissão nova vale para todas as vendas de ${mes}.</p>
         ${proximo}
         ${botao}`);
    } else {
      assunto = `Seu nível de comissão em ${mes}`;
      html = moldeEmail(`${primeiro}, seu nível em ${mes}`,
        `<p>Em ${mesAnt} as vendas com o seu cupom somaram <strong>${brl(m.faturamento_mes_anterior)}</strong>, abaixo dos ${brl(ant?.minimo ?? 0)} do nível ${ant?.nome ?? ""}.</p>
         ${tabela(
           linha("Seu nível agora", novo.nome) +
           linha(`Sua comissão em ${mes}`, pct(novo.comissao_pct), true))}
         <p>Para voltar ao nível ${ant?.nome ?? ""} (${pct(ant?.comissao_pct ?? 0)}) em ${mesSeg}, é só vender ${brl(ant?.minimo ?? 0)} em ${mes}. O nível cai no máximo um degrau por mês, e sobe direto para a faixa que você alcançar.</p>
         ${botao}`);
    }

    const ok = await enviarEmail(p.email, assunto, html);
    if (ok) {
      await db.from("parceiro_nivel_mes").update({ email_enviado_em: new Date().toISOString() })
        .eq("parceiro_id", m.parceiro_id).eq("mes_ref", m.mes_ref);
      resultado.enviados++;
    } else resultado.falhas++;
  }
  await db.from("controle").upsert({ chave: "niveis_avisos_resultado", valor: JSON.stringify({ quando: new Date().toISOString(), ...resultado }) });
  return json(resultado);
});
