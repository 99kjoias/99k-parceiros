// Regra de registro de um pedido com cupom de afiliado.
// Só guarda número do pedido, data, valor e cupom: nenhum dado da cliente.
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enviarEmail, moldeEmail, esc, SITE_PARCEIROS } from "./util.ts";
import { gql } from "./shopify.ts";

export type Pedido = {
  id: number;            // id numérico do pedido na Shopify
  numero: string;        // ex.: #1001
  criadoEm: string;      // data do pedido (ISO)
  subtotal: number;      // valor pago pelas peças, depois dos descontos, sem frete
  codigos: string[];     // cupons usados
  pago: boolean;         // pagamento aprovado
  canceladoEm: string | null;
  contato?: Contato;     // dados de contato que vieram no aviso (reserva, se a leitura pela API falhar)
};

// Contato de quem comprou: usado só para comparar com o cadastro do afiliado, nunca é guardado.
export type Contato = { emails: string[]; telefones: string[]; cpfs: string[]; enderecos: { cep: string; linha: string }[] };

export async function registrarPedido(db: SupabaseClient, p: Pedido): Promise<string> {
  const codigos = p.codigos.map((c) => String(c).trim().toUpperCase()).filter(Boolean);
  if (!codigos.length) return "sem cupom";

  // Pedido cancelado: sai da conta (se já estava registrado)
  if (p.canceladoEm) {
    const { data } = await db.from("vendas")
      .update({ situacao: "cancelada", cancelado_em: p.canceladoEm })
      .eq("shopify_order_id", p.id).in("situacao", ["valida", "propria"]).select("id");
    return data?.length ? "cancelado" : "cancelado sem registro";
  }
  if (!p.pago) return "não pago";

  const { data: ja } = await db.from("vendas").select("id").eq("shopify_order_id", p.id).maybeSingle();
  if (ja) return "já registrado";

  const { data: cupom } = await db.from("cupons")
    .select("id,codigo,parceiro_id,campanha_id,campanhas(comissao_pct)")
    .in("codigo", codigos).limit(1).maybeSingle();
  if (!cupom) return "cupom de fora do programa";

  const comissao = (cupom as any).campanhas?.comissao_pct ?? 0;
  // Compra do próprio afiliado com o próprio cupom: fica registrada, sem comissão (decisão de Matheus, 14/10/2026)
  const motivo = await compraPropria(db, cupom.parceiro_id, p);
  const { data, error } = await db.from("vendas").upsert({
    shopify_order_id: p.id,
    pedido_numero: p.numero,
    cupom_id: cupom.id,
    cupom_codigo: cupom.codigo,
    parceiro_id: cupom.parceiro_id,
    campanha_id: cupom.campanha_id,
    valor_base: Math.max(0, Math.round(p.subtotal * 100) / 100),
    comissao_pct: comissao,
    comissao_valor: 0, // calculado no banco
    data_pedido: p.criadoEm,
    mes_ref: p.criadoEm.slice(0, 10), // recalculado no banco pelo horário de Brasília
    situacao: motivo ? "propria" : "valida",
    motivo_propria: motivo,
  }, { onConflict: "shopify_order_id", ignoreDuplicates: true }).select("parceiro_id,cupom_codigo,valor_base,comissao_valor,mes_ref,data_pedido");
  if (error) throw error;
  if (!data?.length) return "já registrado";
  if (motivo) return "compra própria";
  // Aviso de venda por e-mail (só para quem aceitou). Falha no e-mail nunca atrapalha o registro.
  try { await avisarVenda(db, data[0]); } catch (_) { /* segue */ }
  return "registrado";
}

const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");

// Lê pela API da Shopify o contato de quem comprou (e-mail, telefones, CPF e endereços)
async function contatoDoPedido(id: number): Promise<Contato | null> {
  try {
    const d = await gql(`query($id: ID!) { order(id: $id) {
      email phone
      shippingAddress { zip address1 address2 phone }
      billingAddress { zip address1 address2 phone }
      localizedFields(first: 10) { nodes { key value } }
    } }`, { id: `gid://shopify/Order/${id}` });
    const o = d?.order;
    if (!o) return null;
    const ends = [o.shippingAddress, o.billingAddress].filter(Boolean);
    return {
      emails: [o.email].filter(Boolean),
      telefones: [o.phone, ...ends.map((a: any) => a.phone)].filter(Boolean),
      cpfs: (o.localizedFields?.nodes ?? []).map((n: any) => n.value).filter(Boolean),
      enderecos: ends.map((a: any) => ({ cep: a.zip ?? "", linha: `${a.address1 ?? ""} ${a.address2 ?? ""}` })),
    };
  } catch (e) {
    console.error("contato do pedido", id, String(e));
    return null;
  }
}

// Compara o pedido com o cadastro do afiliado. Devolve o motivo ("CPF", "e-mail", "telefone", "endereço") ou null.
async function compraPropria(db: SupabaseClient, parceiroId: string, p: Pedido): Promise<string | null> {
  const { data: af } = await db.from("parceiros").select("email,cpf,whatsapp,cep,numero").eq("id", parceiroId).maybeSingle();
  if (!af) return null;
  const c = (await contatoDoPedido(p.id)) ?? p.contato;
  if (!c) return null;

  if (c.cpfs.some((x) => dig(x).length === 11 && dig(x) === af.cpf)) return "CPF";
  const email = String(af.email ?? "").trim().toLowerCase();
  if (email && c.emails.some((x) => String(x).trim().toLowerCase() === email)) return "e-mail";
  const zap = dig(af.whatsapp);
  const mesmoTelefone = (t: string) => {
    const d = dig(t).replace(/^55(?=\d{10,11}$)/, ""); // tira o +55
    return d.length >= 10 && zap.length >= 10 && d.slice(-11) === zap.slice(-11);
  };
  if (c.telefones.some(mesmoTelefone)) return "telefone";
  const numero = dig(af.numero);
  if (numero && c.enderecos.some((e) => dig(e.cep) === af.cep && new RegExp(`(^|\\D)${numero}(\\D|$)`).test(e.linha))) return "endereço";
  return null;
}

const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const nomeMes = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("pt-BR", { month: "long", timeZone: "UTC" });

// E-mail de comemoração para o afiliado a cada venda nova com o cupom dele.
// Pedido antigo achado pela conferência (mais de 3 dias) não gera aviso.
async function avisarVenda(db: SupabaseClient, v: any) {
  if (Date.now() - Date.parse(v.data_pedido) > 3 * 86_400_000) return;
  const { data: p } = await db.from("parceiros").select("nome,email,status,avisar_vendas").eq("id", v.parceiro_id).maybeSingle();
  if (!p || !p.avisar_vendas || p.status !== "aprovada") return;
  const { data: doMes } = await db.from("vendas").select("comissao_valor")
    .eq("parceiro_id", v.parceiro_id).eq("mes_ref", v.mes_ref).eq("situacao", "valida");
  const totalMes = (doMes ?? []).reduce((s: number, x: any) => s + Number(x.comissao_valor), 0);
  const primeiro = esc(String(p.nome).split(" ")[0]);
  const linha = (rotulo: string, valor: string, forte = false) =>
    `<tr><td style="padding:8px 0;color:#5f6966">${rotulo}</td><td style="padding:8px 0;text-align:right;${forte ? "font-weight:bold;font-size:18px;color:#004236" : ""}">${valor}</td></tr>`;
  await enviarEmail(p.email, `Saiu venda com o seu cupom ${v.cupom_codigo}!`, moldeEmail(
    `${primeiro}, saiu venda com o seu cupom!`,
    `<p>Alguém acabou de comprar na 99K usando o cupom <strong>${esc(v.cupom_codigo)}</strong>.</p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #d6ddd9;border-bottom:1px solid #d6ddd9;margin:6px 0 16px">
       ${linha("Valor do pedido (sem o frete)", brl(v.valor_base))}
       ${linha("Sua comissão nesta venda", brl(v.comissao_valor), true)}
       ${linha(`Sua comissão em ${nomeMes(v.mes_ref)} até agora`, brl(totalMes))}
     </table>
     <p><a href="${SITE_PARCEIROS}/entrar" style="display:inline-block;background:#004236;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Ver no meu painel</a></p>
     <p style="color:#5f6966;font-size:13px">Se o pedido for cancelado, ele sai da sua conta. Não quer mais receber estes avisos? Desligue no seu painel, em "Avisos por e-mail".</p>`));
}

// Converte o aviso (webhook REST) da Shopify
export function pedidoDoWebhook(o: any): Pedido {
  return {
    id: Number(o.id),
    numero: String(o.name ?? o.order_number ?? o.id),
    criadoEm: o.created_at,
    subtotal: Number(o.subtotal_price ?? 0),
    codigos: (o.discount_codes ?? []).map((d: any) => d.code),
    pago: ["paid", "partially_refunded", "refunded"].includes(String(o.financial_status)),
    canceladoEm: o.cancelled_at ?? null,
    contato: {
      emails: [o.email, o.contact_email, o.customer?.email].filter(Boolean),
      telefones: [o.phone, o.customer?.phone, o.shipping_address?.phone, o.billing_address?.phone].filter(Boolean),
      cpfs: [],
      enderecos: [o.shipping_address, o.billing_address].filter(Boolean)
        .map((a: any) => ({ cep: a.zip ?? "", linha: `${a.address1 ?? ""} ${a.address2 ?? ""}` })),
    },
  };
}

// Converte um pedido lido pela API (conferência de hora em hora)
export function pedidoDaApi(o: any): Pedido {
  return {
    id: Number(o.legacyResourceId),
    numero: o.name,
    criadoEm: o.createdAt,
    subtotal: Number(o.subtotalPriceSet?.shopMoney?.amount ?? 0),
    codigos: o.discountCodes ?? [],
    pago: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(o.displayFinancialStatus),
    canceladoEm: o.cancelledAt ?? null,
  };
}
