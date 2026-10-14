// Ligação com a Shopify (app da 99K criado no Dev Dashboard, credenciais de cliente)
// Segredos esperados no Supabase: SHOPIFY_CLIENT_ID e SHOPIFY_CLIENT_SECRET (colocados por Matheus).
export const LOJA = Deno.env.get("SHOPIFY_LOJA") ?? "gamshu-76"; // subdomínio .myshopify.com
export const VERSAO_API = "2026-10";

let cache: { token: string; expira: number } | null = null;

export function shopifyConfigurada(): boolean {
  return !!(Deno.env.get("SHOPIFY_CLIENT_ID") && Deno.env.get("SHOPIFY_CLIENT_SECRET"));
}

async function token(): Promise<string> {
  if (cache && cache.expira > Date.now() + 120_000) return cache.token;
  const id = Deno.env.get("SHOPIFY_CLIENT_ID");
  const segredo = Deno.env.get("SHOPIFY_CLIENT_SECRET");
  if (!id || !segredo) throw new Error("A Shopify ainda não está ligada ao programa.");
  const r = await fetch(`https://${LOJA}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: segredo }),
  });
  if (!r.ok) throw new Error(`A Shopify recusou o acesso (${r.status}). Confira o app no Dev Dashboard.`);
  const j = await r.json();
  cache = { token: j.access_token, expira: Date.now() + (Number(j.expires_in) || 86_000) * 1000 };
  return cache.token;
}

export async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`https://${LOJA}.myshopify.com/admin/api/${VERSAO_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await token() },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error("Erro na Shopify: " + JSON.stringify(j.errors ?? r.status));
  return j.data as T;
}

function erroUsuario(res: { userErrors?: { message: string }[] } | undefined) {
  if (res?.userErrors?.length) throw new Error("Shopify: " + res.userErrors.map((e) => e.message).join("; "));
}

// Cupom da parceira: desconto em % sobre o pedido, para todos os clientes,
// combina com descontos de produto (desconto progressivo) e de frete, não combina com outro cupom de pedido.
function entradaCupom(codigo: string, descontoPct: number, extra: Record<string, unknown> = {}) {
  return {
    title: `Parceiros 99K: ${codigo}`,
    code: codigo,
    context: { all: "ALL" },
    customerGets: { value: { percentage: Math.round(descontoPct * 100) / 10000 }, items: { all: true } },
    appliesOncePerCustomer: false,
    combinesWith: { productDiscounts: true, orderDiscounts: false, shippingDiscounts: true },
    ...extra,
  };
}

export async function codigoExisteNaLoja(codigo: string): Promise<boolean> {
  const d = await gql(`query($c: String!) { codeDiscountNodeByCode(code: $c) { id } }`, { c: codigo });
  return !!d.codeDiscountNodeByCode;
}

export async function criarCupom(codigo: string, descontoPct: number): Promise<string> {
  const d = await gql(
    `mutation($d: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $d) { codeDiscountNode { id } userErrors { field message } } }`,
    { d: entradaCupom(codigo, descontoPct, { startsAt: new Date().toISOString() }) },
  );
  erroUsuario(d.discountCodeBasicCreate);
  return d.discountCodeBasicCreate.codeDiscountNode.id;
}

export async function mudarDescontoCupom(idShopify: string, codigo: string, descontoPct: number) {
  const d = await gql(
    `mutation($id: ID!, $d: DiscountCodeBasicInput!) { discountCodeBasicUpdate(id: $id, basicCodeDiscount: $d) { codeDiscountNode { id } userErrors { field message } } }`,
    { id: idShopify, d: entradaCupom(codigo, descontoPct) },
  );
  erroUsuario(d.discountCodeBasicUpdate);
}

export async function desativarCupom(idShopify: string) {
  const d = await gql(
    `mutation($id: ID!) { discountCodeDeactivate(id: $id) { codeDiscountNode { id } userErrors { field message } } }`,
    { id: idShopify },
  );
  erroUsuario(d.discountCodeDeactivate);
}

export async function ativarCupom(idShopify: string) {
  const d = await gql(
    `mutation($id: ID!) { discountCodeActivate(id: $id) { codeDiscountNode { id } userErrors { field message } } }`,
    { id: idShopify },
  );
  erroUsuario(d.discountCodeActivate);
}

// Confere a assinatura do aviso (webhook) que a Shopify manda
export async function assinaturaValida(corpo: string, hmac: string | null): Promise<boolean> {
  const segredo = Deno.env.get("SHOPIFY_CLIENT_SECRET");
  if (!segredo || !hmac) return false;
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpo)));
  const calc = btoa(String.fromCharCode(...sig));
  if (calc.length !== hmac.length) return false;
  let dif = 0;
  for (let i = 0; i < calc.length; i++) dif |= calc.charCodeAt(i) ^ hmac.charCodeAt(i);
  return dif === 0;
}
