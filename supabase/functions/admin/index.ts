// Ações do painel do lojista. Só quem está na tabela admins consegue usar.
// Cada ação que muda a Shopify parte de um clique de Matheus (exceção à regra de só leitura,
// autorizada por ele em 14/10/2026 apenas para os cupons do programa).
import { adminDb, cors, erro, json, enviarEmail, moldeEmail, esc, SITE_PARCEIROS } from "../_shared/util.ts";
import { codigoExisteNaLoja, criarCupom, mudarDescontoCupom, desativarCupom, ativarCupom } from "../_shared/shopify.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return erro("Método não permitido.", 405);

  // Quem está chamando?
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const db = adminDb();
  const { data: u } = jwt ? await db.auth.getUser(jwt) : { data: null as any };
  if (!u?.user) return erro("Entre de novo no painel.", 401);
  const { data: adm } = await db.from("admins").select("user_id").eq("user_id", u.user.id).maybeSingle();
  if (!adm) return erro("Acesso só para o lojista.", 403);

  let b: any;
  try { b = await req.json(); } catch (_) { return erro("Dados inválidos."); }

  try {
    switch (b.acao) {
      case "aprovar": return json(await aprovar(db, b));
      case "recusar": return json(await recusar(db, b));
      case "encerrar": return json(await encerrar(db, b));
      case "pausar_cupom": return json(await pausar(db, b, true));
      case "reativar_cupom": return json(await pausar(db, b, false));
      case "mudar_campanha": return json(await mudarCampanha(db, b));
      case "salvar_campanha": return json(await salvarCampanha(db, b));
      case "marcar_pago": return json(await marcarPago(db, b));
      case "colecao_visivel": {
        const { error } = await db.from("colecoes").update({ ativa: !!b.ativa }).eq("handle", String(b.handle));
        if (error) throw error;
        return json({ ok: true });
      }
      default: return erro("Ação desconhecida.");
    }
  } catch (e) {
    return erro(e instanceof Error ? e.message : "Não foi possível concluir.", 400);
  }
});

async function buscarParceira(db: any, id: string) {
  const { data } = await db.from("parceiros").select("*").eq("id", id).maybeSingle();
  if (!data) throw new Error("Afiliado não encontrado.");
  return data;
}

async function aprovar(db: any, b: any) {
  const p = await buscarParceira(db, b.parceiro_id);
  if (p.status !== "pendente") throw new Error("Este cadastro já foi analisado.");
  const codigo = String(b.codigo || p.codigo_desejado).toUpperCase().trim();
  if (!/^[A-Z0-9]{4,20}$/.test(codigo)) throw new Error("O código precisa ter de 4 a 20 letras ou números.");

  const { data: camp } = await db.from("campanhas").select("*").eq("id", b.campanha_id).eq("ativa", true).maybeSingle();
  if (!camp) throw new Error("Escolha uma campanha ativa.");

  const { data: jaUsado } = await db.from("cupons").select("id").eq("codigo", codigo).maybeSingle();
  if (jaUsado) throw new Error(`O código ${codigo} já é de outro afiliado.`);
  if (await codigoExisteNaLoja(codigo)) throw new Error(`Já existe um cupom ${codigo} na Shopify. Escolha outro código.`);

  const idShopify = await criarCupom(codigo, Number(camp.desconto_pct));
  const { error: e1 } = await db.from("cupons").insert({
    parceiro_id: p.id, campanha_id: camp.id, codigo, shopify_discount_id: idShopify, status: "ativo",
  });
  if (e1) { await desativarCupom(idShopify).catch(() => {}); throw new Error("Cupom criado na Shopify, mas não foi salvo aqui. Ele foi desativado; tente de novo."); }

  await db.from("parceiros").update({ status: "aprovada", campanha_id: camp.id, aprovado_em: new Date().toISOString(), codigo_desejado: codigo }).eq("id", p.id);

  const pct = (n: number) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%";
  const primeiro = esc(String(p.nome).split(" ")[0]);
  const enviado = await enviarEmail(p.email, "Seu cadastro no Programa de Afiliados 99K foi aprovado", moldeEmail(
    `${primeiro}, seu cupom está ativo`,
    `<p>Seu cadastro foi aprovado. O seu cupom já vale no site da 99K:</p>
     <p style="font-family:Georgia,serif;font-size:26px;letter-spacing:2px;background:#f3e9cc;color:#00261f;padding:12px 18px;border-radius:8px;display:inline-block">${codigo}</p>
     <p>Quem compra com ele ganha ${pct(camp.desconto_pct)} de desconto, e você recebe ${pct(camp.comissao_pct)} de comissão sobre o valor pago pelas peças.</p>
     <p>Acompanhe as suas vendas em tempo real no painel: <a href="${SITE_PARCEIROS}/entrar.html" style="color:#004236">${SITE_PARCEIROS.replace("https://", "")}</a></p>`));
  return { ok: true, codigo, email_enviado: enviado };
}

async function recusar(db: any, b: any) {
  const p = await buscarParceira(db, b.parceiro_id);
  if (p.status !== "pendente") throw new Error("Este cadastro já foi analisado.");
  await db.from("parceiros").update({ status: "recusada" }).eq("id", p.id);
  const primeiro = esc(String(p.nome).split(" ")[0]);
  const enviado = await enviarEmail(p.email, "Programa de Afiliados 99K", moldeEmail(
    `${primeiro}, obrigado pelo interesse`,
    `<p>Analisamos o seu cadastro e, neste momento, ele não foi aprovado para o Programa de Afiliados 99K.</p><p>Obrigado por querer divulgar a 99K.</p>`));
  return { ok: true, email_enviado: enviado };
}

async function cupomDa(db: any, parceiroId: string) {
  const { data } = await db.from("cupons").select("*").eq("parceiro_id", parceiroId).neq("status", "encerrado").order("criado_em", { ascending: false }).limit(1).maybeSingle();
  return data;
}

async function encerrar(db: any, b: any) {
  const p = await buscarParceira(db, b.parceiro_id);
  const c = await cupomDa(db, p.id);
  if (c?.shopify_discount_id && c.status === "ativo") await desativarCupom(c.shopify_discount_id);
  if (c) await db.from("cupons").update({ status: "encerrado" }).eq("id", c.id);
  await db.from("parceiros").update({ status: "encerrada" }).eq("id", p.id);
  return { ok: true };
}

async function pausar(db: any, b: any, pausarCupom: boolean) {
  const c = await cupomDa(db, b.parceiro_id);
  if (!c) throw new Error("Este afiliado não tem cupom ativo.");
  if (pausarCupom) await desativarCupom(c.shopify_discount_id);
  else await ativarCupom(c.shopify_discount_id);
  await db.from("cupons").update({ status: pausarCupom ? "pausado" : "ativo" }).eq("id", c.id);
  return { ok: true };
}

async function mudarCampanha(db: any, b: any) {
  const p = await buscarParceira(db, b.parceiro_id);
  const { data: camp } = await db.from("campanhas").select("*").eq("id", b.campanha_id).eq("ativa", true).maybeSingle();
  if (!camp) throw new Error("Escolha uma campanha ativa.");
  const c = await cupomDa(db, p.id);
  if (c) {
    await mudarDescontoCupom(c.shopify_discount_id, c.codigo, Number(camp.desconto_pct));
    await db.from("cupons").update({ campanha_id: camp.id }).eq("id", c.id);
  }
  await db.from("parceiros").update({ campanha_id: camp.id }).eq("id", p.id);
  return { ok: true };
}

async function salvarCampanha(db: any, b: any) {
  const nome = String(b.nome ?? "").trim();
  const desconto = Number(b.desconto_pct), comissao = Number(b.comissao_pct);
  if (!nome) throw new Error("Dê um nome para a campanha.");
  if (!(desconto >= 0 && desconto <= 100) || !(comissao >= 0 && comissao <= 100)) throw new Error("Desconto e comissão entre 0% e 100%.");
  if (b.padrao) await db.from("campanhas").update({ padrao: false }).eq("padrao", true);

  const dados = { nome, desconto_pct: desconto, comissao_pct: comissao, padrao: !!b.padrao, ativa: b.ativa !== false };
  if (!b.id) {
    const { error } = await db.from("campanhas").insert(dados);
    if (error) throw error;
    return { ok: true };
  }
  const { data: antes } = await db.from("campanhas").select("*").eq("id", b.id).maybeSingle();
  if (!antes) throw new Error("Campanha não encontrada.");
  const { error } = await db.from("campanhas").update(dados).eq("id", b.id);
  if (error) throw error;

  // Desconto mudou: atualiza os cupons da campanha na Shopify
  let atualizados = 0, falhas = 0;
  if (Number(antes.desconto_pct) !== desconto) {
    const { data: cupons } = await db.from("cupons").select("*").eq("campanha_id", b.id).neq("status", "encerrado");
    for (const c of cupons ?? []) {
      try { await mudarDescontoCupom(c.shopify_discount_id, c.codigo, desconto); atualizados++; }
      catch (_) { falhas++; }
    }
  }
  if (falhas) throw new Error(`Campanha salva, mas ${falhas} cupom(ns) não foram atualizados na Shopify. Salve de novo para tentar outra vez.`);
  return { ok: true, cupons_atualizados: atualizados };
}

async function marcarPago(db: any, b: any) {
  const { error } = await db.from("fechamentos")
    .update({ pago: !!b.pago, pago_em: b.pago ? new Date().toISOString() : null })
    .eq("id", b.fechamento_id);
  if (error) throw error;
  return { ok: true };
}
