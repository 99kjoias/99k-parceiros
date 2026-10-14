// Ativação do afiliado aprovado (página pública com o link de ativação).
// O afiliado escolhe o código do cupom, informa a chave Pix e cria a senha.
// O cupom é criado na Shopify nessa hora: a aprovação de Matheus veio antes, no painel do lojista.
import { adminDb, cors, erro, json, esc, enviarEmail, moldeEmail, SITE_PARCEIROS } from "../_shared/util.ts";
import { codigoExisteNaLoja, criarCupom, desativarCupom } from "../_shared/shopify.ts";
import { hashToken } from "../_shared/ativacao.ts";

const so = (s: unknown) => String(s ?? "").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return erro("Método não permitido.", 405);

  let b: any;
  try { b = await req.json(); } catch (_) { return erro("Dados inválidos."); }
  const token = so(b.token);
  if (token.length < 20) return erro("Link de ativação inválido.", 404);

  const db = adminDb();
  const { data: p } = await db.from("parceiros")
    .select("id,nome,email,status,campanha_id,ativado_em,ativacao_expira")
    .eq("ativacao_hash", await hashToken(token)).maybeSingle();

  if (!p || p.status !== "aprovada" || p.ativado_em) {
    return erro("Este link não vale mais. Se você já ativou, entre no painel com o seu e-mail e senha. Se não, peça um link novo à 99K.", 404);
  }
  if (!p.ativacao_expira || Date.parse(p.ativacao_expira) < Date.now()) {
    return erro("Este link venceu. Peça um link novo à 99K.", 410);
  }
  const { data: camp } = await db.from("campanhas").select("desconto_pct,comissao_pct").eq("id", p.campanha_id).maybeSingle();

  if (b.acao === "consultar") {
    return json({ ok: true, nome: String(p.nome).split(" ")[0], email: p.email, desconto_pct: camp?.desconto_pct, comissao_pct: camp?.comissao_pct });
  }
  if (b.acao !== "ativar") return erro("Ação desconhecida.");

  const codigo = so(b.codigo).toUpperCase();
  const pix = so(b.pix);
  const senha = String(b.senha ?? "");
  if (!/^[A-Z0-9]{4,20}$/.test(codigo)) return erro("O código do cupom precisa ter de 4 a 20 letras ou números, sem espaço nem acento.");
  if (pix.length < 5 || pix.length > 140) return erro("Informe a chave Pix.");
  if (senha.length < 8 || senha.length > 72) return erro("A senha precisa ter pelo menos 8 caracteres.");
  if (!camp) return erro("Sua campanha não foi encontrada. Fale com a 99K.", 500);

  const { data: livre } = await db.rpc("codigo_disponivel", { p_codigo: codigo });
  if (!livre) return erro("Esse código já está em uso. Escolha outro.");
  try {
    if (await codigoExisteNaLoja(codigo)) return erro("Esse código já existe na loja. Escolha outro.");
  } catch (_) {
    return erro("Não foi possível falar com a loja agora. Tente de novo em instantes.", 503);
  }

  // 1) cupom na Shopify
  let idShopify: string;
  try { idShopify = await criarCupom(codigo, Number(camp.desconto_pct)); }
  catch (_) { return erro("Não foi possível criar o cupom agora. Tente de novo em instantes.", 503); }

  // 2) cupom no programa
  const { data: cupom, error: e1 } = await db.from("cupons")
    .insert({ parceiro_id: p.id, campanha_id: p.campanha_id, codigo, shopify_discount_id: idShopify, status: "ativo" })
    .select("id").single();
  if (e1 || !cupom) {
    await desativarCupom(idShopify).catch(() => {});
    return erro("Esse código acabou de ser escolhido por outra pessoa. Escolha outro.");
  }

  // 3) senha do painel
  const { error: e2 } = await db.auth.admin.updateUserById(p.id, { password: senha });
  if (e2) {
    await desativarCupom(idShopify).catch(() => {});
    await db.from("cupons").delete().eq("id", cupom.id);
    return erro("Não foi possível salvar a senha. Tente outra senha.", 400);
  }

  // 4) conclui a ativação (o link deixa de valer)
  await db.from("parceiros").update({
    codigo_desejado: codigo, chave_pix: pix, ativado_em: new Date().toISOString(), avisar_vendas: b.avisar_vendas === true,
    ativacao_hash: null, ativacao_expira: null,
  }).eq("id", p.id);

  await enviarEmail(p.email, `Seu cupom ${codigo} está ativo`, moldeEmail(
    `Tudo pronto, ${esc(String(p.nome).split(" ")[0])}`,
    `<p>O seu cupom <strong>${codigo}</strong> já vale no site da 99K. Agora é divulgar!</p>
     <p><a href="${SITE_PARCEIROS}/entrar" style="display:inline-block;background:#004236;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Abrir meu painel</a></p>
     <p>Para entrar no painel, use este e-mail e a senha que você criou.</p>`));

  const avisar = Deno.env.get("EMAIL_AVISO_LOJISTA");
  if (avisar) {
    await enviarEmail(avisar, `Cupom ativado: ${codigo}`, moldeEmail("Afiliado ativou o cupom",
      `<p><strong>${esc(p.nome)}</strong> ativou o cupom <strong>${codigo}</strong>.</p>
       <p><a href="${SITE_PARCEIROS}/admin" style="color:#004236">Abrir o painel do lojista</a></p>`));
  }
  return json({ ok: true, email: p.email, codigo });
});
