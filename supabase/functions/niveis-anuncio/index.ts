// Anúncio da escada de comissão (Bronze, Prata, Ouro e Diamante) aos afiliados: envio único.
// Textos aprovados por Matheus em 30/10/2026. Publicada no Supabase com o util.ts ao lado (import "./util.ts").
// Destinatários: função anuncio_escada_destinatarios() (aprovados, ativados, cupom ativo, campanha com escada).
// Ações (POST JSON):
//   { acao: "previa" }                      lista quem recebe (só @ e nível), sem mandar nada
//   { acao: "teste", token }                manda um exemplo só para adm@99kjoias.com.br
//   { acao: "enviar", token }               manda a todos, uma vez só (fica registrado em controle)
// O token fica na tabela controle (chave anuncio_escada_token); quem não tem o token não envia nada.
import { adminDb, enviarEmail, moldeEmail, esc, json, SITE_PARCEIROS } from "../_shared/util.ts";

const pct = (n: number) => `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const botao = `<p><a href="${SITE_PARCEIROS}/entrar" style="display:inline-block;background:#004236;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Ver no meu painel</a></p>`;
const th = 'style="padding:8px 6px;text-align:left;color:#5f6966;font-weight:normal;border-bottom:1px solid #d6ddd9"';
const tr = (nome: string, faixa: string, p: string, destaque: boolean) => {
  const bg = destaque ? "background:#f3e9cc;" : "";
  return `<tr><td style="padding:8px 6px;${bg}">${nome}</td><td style="padding:8px 6px;${bg}">${faixa}</td><td style="padding:8px 6px;text-align:right;font-weight:bold;color:#004236;${bg}">${p}</td></tr>`;
};

const ASSUNTO = "Bronze, Prata, Ouro e Diamante: sua comissão agora sobe com as suas vendas";

function emailAnuncio(d: { nome: string; desconto_pct: number; nivel_nome: string; nivel_pct: number }): string {
  const primeiro = esc(String(d.nome).split(" ")[0]);
  const escada = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;border-collapse:collapse">
<tr><th ${th}>Nível</th><th ${th}>Vendas no mês</th><th ${th} align="right">Comissão</th></tr>
${tr("Bronze", "até R$ 1.500", "7%", d.nivel_nome === "Bronze")}${tr("Prata", "de R$ 1.500 a R$ 4.000", "10%", d.nivel_nome === "Prata")}${tr("Ouro", "de R$ 4.000 a R$ 8.000", "12%", d.nivel_nome === "Ouro")}${tr("Diamante", "acima de R$ 8.000", "15%", d.nivel_nome === "Diamante")}</table>`;
  return moldeEmail(`${primeiro}, sua comissão agora tem níveis`,
    `<p>A partir de novembro, a comissão do Programa de Afiliados 99K passa a subir conforme você vende. Quanto mais vendas com o seu cupom, maior a porcentagem que você recebe.</p>
 ${escada}
 <p style="font-family:Karla,Arial,sans-serif;font-weight:bold;font-size:17px;margin:18px 0 6px">Como funciona</p>
 <ul style="padding-left:20px;margin:0 0 16px">
  <li style="margin-bottom:6px">O que você vende em um mês define o seu nível no mês seguinte, e a comissão nova vale para todas as vendas desse mês.</li>
  <li style="margin-bottom:6px">Você sobe direto para a faixa que alcançar. Vendeu R$ 8.000 em um mês? No mês seguinte já é Diamante e recebe 15%, mesmo saindo do Bronze.</li>
  <li style="margin-bottom:6px">Se vender abaixo do seu nível, você desce só um nível por vez.</li>
  <li>A mudança é automática. Quando o seu nível muda, você recebe um e-mail no dia 1.</li>
 </ul>
 <div style="background:#00261f;color:#ffffff;border-radius:10px;padding:16px 18px;margin:0 0 16px">
  <div style="color:#f3e9cc;font-size:13px">Seu nível em novembro</div>
  <div style="font-family:Karla,Arial,sans-serif;font-size:22px;font-weight:bold">${esc(d.nivel_nome)}: ${pct(d.nivel_pct)} de comissão</div>
 </div>
 <p>Seu cupom continua o mesmo: quem compra com ele segue ganhando ${pct(d.desconto_pct)} de desconto.</p>
 <p>No seu painel você acompanha, em tempo real, quanto já vendeu no mês e quanto falta para o próximo nível.</p>
 ${botao}
 <p style="color:#5f6966;font-size:13px">As regras completas do programa foram atualizadas e estão em afiliados.99kjoias.com.br. Dúvidas: adm@99kjoias.com.br.</p>`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);
  const b = await req.json().catch(() => ({}));
  const db = adminDb();

  const { data: dest, error } = await db.rpc("anuncio_escada_destinatarios");
  if (error) return json({ erro: error.message }, 500);
  const lista = (dest ?? []) as any[];

  if (b.acao === "previa") {
    const { data: ja } = await db.from("controle").select("valor").eq("chave", "anuncio_escada_enviado").maybeSingle();
    return json({ ja_enviado: ja?.valor ?? null, total: lista.length, destinatarios: lista.map((d) => ({ codigo: d.codigo, nivel: d.nivel_nome, comissao: d.nivel_pct, desconto: d.desconto_pct })) });
  }

  const { data: tk } = await db.from("controle").select("valor").eq("chave", "anuncio_escada_token").maybeSingle();
  if (!tk?.valor || b.token !== tk.valor) return json({ erro: "sem autorização" }, 401);

  if (b.acao === "teste") {
    const exemplo = lista[0] ?? { nome: "Afiliado", desconto_pct: 7, nivel_nome: "Bronze", nivel_pct: 7 };
    const ok = await enviarEmail("adm@99kjoias.com.br", "[Teste] " + ASSUNTO, emailAnuncio(exemplo));
    return json({ teste_enviado: ok });
  }

  if (b.acao === "enviar") {
    const { data: ja } = await db.from("controle").select("valor").eq("chave", "anuncio_escada_enviado").maybeSingle();
    if (ja?.valor) return json({ erro: "o anúncio já foi enviado", em: ja.valor }, 409);
    const res = { enviados: 0, falhas: [] as string[] };
    for (const d of lista) {
      if (!d.email) { res.falhas.push(d.codigo); continue; }
      const ok = await enviarEmail(d.email, ASSUNTO, emailAnuncio(d));
      if (ok) res.enviados++; else res.falhas.push(d.codigo);
    }
    await db.from("controle").upsert({ chave: "anuncio_escada_enviado", valor: JSON.stringify({ quando: new Date().toISOString(), ...res }) });
    return json(res);
  }
  return json({ erro: "ação desconhecida" }, 400);
});
