// Ações do painel do lojista. Só quem está na tabela admins consegue usar.
// Mudanças nos cupons da Shopify partem de um clique do lojista (exceção à regra de só leitura,
// autorizada por Matheus em 14/10/2026 apenas para os cupons do programa). O cupom em si é criado
// na ativação, pelo afiliado já aprovado (função ativar).
import { adminDb, cors, erro, json, enviarEmail, moldeEmail, esc, SITE_PARCEIROS } from "../_shared/util.ts";
import { mudarDescontoCupom, desativarCupom, ativarCupom } from "../_shared/shopify.ts";
import { novoToken, hashToken, linkAtivacao, DIAS_VALIDADE } from "../_shared/ativacao.ts";

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
      case "novo_link": return json(await novoLink(db, b));
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
  const { data: camp } = await db.from("campanhas").select("*").eq("id", b.campanha_id).eq("ativa", true).maybeSingle();
  if (!camp) throw new Error("Escolha uma campanha ativa.");

  const token = novoToken();
  const { error } = await db.from("parceiros").update({
    status: "aprovada", campanha_id: camp.id, aprovado_em: new Date().toISOString(),
    ativacao_hash: await hashToken(token),
    ativacao_expira: new Date(Date.now() + DIAS_VALIDADE * 86_400_000).toISOString(),
  }).eq("id", p.id);
  if (error) throw error;
  return { ok: true, ...(await avisarAprovacao(p, camp, token)) };
}

// Gera um link novo para quem foi aprovado e ainda não ativou (o anterior deixa de valer)
async function novoLink(db: any, b: any) {
  const p = await buscarParceira(db, b.parceiro_id);
  if (p.status !== "aprovada" || p.ativado_em) throw new Error("Este afiliado já ativou o acesso.");
  const { data: camp } = await db.from("campanhas").select("*").eq("id", p.campanha_id).maybeSingle();
  const token = novoToken();
  const { error } = await db.from("parceiros").update({
    ativacao_hash: await hashToken(token),
    ativacao_expira: new Date(Date.now() + DIAS_VALIDADE * 86_400_000).toISOString(),
  }).eq("id", p.id);
  if (error) throw error;
  return { ok: true, ...(await avisarAprovacao(p, camp, token)) };
}

async function avisarAprovacao(p: any, camp: any, token: string) {
  const link = linkAtivacao(SITE_PARCEIROS, token);
  const primeiro = String(p.nome).split(" ")[0];
  const pct = (n: number) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%";
  const mensagem = `Olá, ${primeiro}! Seu cadastro no Programa de Afiliados 99K foi aprovado. ` +
    `Para escolher o seu cupom, cadastrar a sua chave Pix e criar a sua senha, acesse: ${link} ` +
    `(o link vale ${DIAS_VALIDADE} dias).`;
  const desc = camp ? pct(camp.desconto_pct) : "";
  const com = camp ? pct(camp.comissao_pct) : "";
  const email_enviado = await enviarEmail(p.email, "Você foi aprovado no Programa de Afiliados 99K", moldeEmail(
    `${esc(primeiro)}, boas-vindas ao time de afiliados da 99K`,
    `<p>Seu cadastro foi aprovado. Agora falta só ativar o seu acesso:</p>
     <p><a href="${link}" style="display:inline-block;background:#004236;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Ativar meu cupom</a></p>
     <p style="color:#5f6966;font-size:13px">O link vale ${DIAS_VALIDADE} dias.</p>
     <p><strong>Na ativação você:</strong></p>
     <ul style="padding-left:20px;margin:0 0 14px">
       <li>escolhe o código do seu cupom (por exemplo, MARIA10);</li>
       <li>cadastra a chave Pix para receber a comissão;</li>
       <li>cria a senha do seu painel.</li>
     </ul>
     <p><strong>Como funciona:</strong></p>
     <ul style="padding-left:20px;margin:0 0 14px">
       ${camp ? `<li>Quem compra no site com o seu cupom ganha <strong>${desc} de desconto</strong>, que soma com as promoções do site.</li>
       <li>Você recebe <strong>${com} de comissão</strong> sobre o valor que a cliente pagou pelas peças, depois dos descontos e sem o frete.</li>` : ""}
       <li>Cada venda aparece no seu painel na hora. Lá você também acompanha o ranking dos afiliados do mês.</li>
       <li>O mês fecha no último dia, e a comissão é paga por Pix até o 5º dia útil do mês seguinte.</li>
     </ul>
     <p>Ficou com dúvida? É só responder este e-mail.</p>`));
  const whatsapp = `https://wa.me/55${p.whatsapp}?text=${encodeURIComponent(mensagem)}`;
  return { link, whatsapp, email_enviado };
}

async function recusar(db: any, b: any) {
  const p = await buscarParceira(db, b.parceiro_id);
  if (p.status !== "pendente") throw new Error("Este cadastro já foi analisado.");
  await db.from("parceiros").update({ status: "recusada" }).eq("id", p.id);
  const primeiro = esc(String(p.nome).split(" ")[0]);
  const enviado = await enviarEmail(p.email, "Sobre o seu cadastro no Programa de Afiliados 99K", moldeEmail(
    `${primeiro}, obrigado pelo interesse`,
    `<p>Analisamos o seu cadastro e, neste momento, ele não foi aprovado para o Programa de Afiliados 99K.</p>`));
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
  await db.from("parceiros").update({ status: "encerrada", ativacao_hash: null, ativacao_expira: null }).eq("id", p.id);
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
