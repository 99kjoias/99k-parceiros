// Conferência automática (de hora em hora):
// 1) garante que os avisos da Shopify estão ligados;
// 2) relê os pedidos das últimas 72 horas, para pegar algum aviso perdido;
// 3) atualiza a lista de coleções do cadastro.
import { adminDb, json } from "../_shared/util.ts";
import { gql, shopifyConfigurada } from "../_shared/shopify.ts";
import { pedidoDaApi, registrarPedido } from "../_shared/pedidos.ts";

const URL_AVISOS = `${Deno.env.get("SUPABASE_URL")}/functions/v1/shopify-webhook`;
const TOPICOS = ["ORDERS_PAID", "ORDERS_CANCELLED"];

Deno.serve(async () => {
  const db = adminDb();

  // No máximo uma rodada a cada 5 minutos, mesmo que alguém chame a função várias vezes
  const { data: ctl } = await db.from("controle").select("valor").eq("chave", "conferencia").maybeSingle();
  if (ctl?.valor && Date.now() - Date.parse(ctl.valor) < 5 * 60_000) return json({ ok: true, pulado: true });
  await db.from("controle").upsert({ chave: "conferencia", valor: new Date().toISOString() });

  if (!shopifyConfigurada()) return json({ ok: false, motivo: "Shopify ainda não ligada" });

  const resultado: Record<string, unknown> = {};
  try { resultado.avisos = await garantirAvisos(); } catch (e) { resultado.avisos_erro = String(e); }
  try { resultado.pedidos = await conferirPedidos(db); } catch (e) { resultado.pedidos_erro = String(e); }
  try { resultado.colecoes = await sincronizarColecoes(db); } catch (e) { resultado.colecoes_erro = String(e); }

  await db.from("controle").upsert({ chave: "conferencia_resultado", valor: JSON.stringify({ quando: new Date().toISOString(), ...resultado }) });
  return json({ ok: true, ...resultado });
});

async function garantirAvisos() {
  const d = await gql(`{ webhookSubscriptions(first: 50) { nodes { id topic uri } } }`);
  const existentes = d.webhookSubscriptions.nodes as { topic: string; uri: string }[];
  const criados: string[] = [];
  for (const t of TOPICOS) {
    if (existentes.some((w) => w.topic === t && w.uri === URL_AVISOS)) continue;
    const r = await gql(
      `mutation($t: WebhookSubscriptionTopic!, $w: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $t, webhookSubscription: $w) { webhookSubscription { id } userErrors { message } } }`,
      { t, w: { uri: URL_AVISOS, format: "JSON" } },
    );
    if (r.webhookSubscriptionCreate.userErrors?.length) throw new Error(JSON.stringify(r.webhookSubscriptionCreate.userErrors));
    criados.push(t);
  }
  return { criados };
}

async function conferirPedidos(db: any) {
  const desde = new Date(Date.now() - 72 * 3600_000).toISOString();
  let depois: string | null = null, lidos = 0;
  const contagem: Record<string, number> = {};
  do {
    const d: any = await gql(
      `query($q: String!, $after: String) {
        orders(first: 100, after: $after, query: $q, sortKey: UPDATED_AT) {
          nodes { legacyResourceId name createdAt cancelledAt displayFinancialStatus discountCodes subtotalPriceSet { shopMoney { amount } } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { q: `updated_at:>='${desde}'`, after: depois },
    );
    for (const o of d.orders.nodes) {
      lidos++;
      if (!o.discountCodes?.length) continue;
      const r = await registrarPedido(db, pedidoDaApi(o));
      contagem[r] = (contagem[r] ?? 0) + 1;
    }
    depois = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
  } while (depois);
  return { lidos, ...contagem };
}

async function sincronizarColecoes(db: any) {
  const lista: { handle: string; title: string }[] = [];
  let depois: string | null = null;
  do {
    const d: any = await gql(
      `query($after: String) { collections(first: 250, after: $after) { nodes { handle title } pageInfo { hasNextPage endCursor } } }`,
      { after: depois },
    );
    lista.push(...d.collections.nodes);
    depois = d.collections.pageInfo.hasNextPage ? d.collections.pageInfo.endCursor : null;
  } while (depois);

  const { data: atuais } = await db.from("colecoes").select("handle");
  const conhecidas = new Set((atuais ?? []).map((c: any) => c.handle));
  const novas = lista.filter((c) => !conhecidas.has(c.handle)).map((c) => ({ handle: c.handle, titulo: c.title, ativa: true }));
  if (novas.length) await db.from("colecoes").insert(novas);
  for (const c of lista.filter((c) => conhecidas.has(c.handle))) {
    await db.from("colecoes").update({ titulo: c.title }).eq("handle", c.handle);
  }
  // Coleção apagada na Shopify sai da lista do cadastro
  const naLoja = new Set(lista.map((c) => c.handle));
  const sumiram = [...conhecidas].filter((h) => !naLoja.has(h as string));
  if (sumiram.length) await db.from("colecoes").update({ ativa: false }).in("handle", sumiram);
  return { total: lista.length, novas: novas.length };
}
