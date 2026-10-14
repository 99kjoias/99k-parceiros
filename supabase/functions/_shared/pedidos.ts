// Regra de registro de um pedido com cupom de afiliado.
// Só guarda número do pedido, data, valor e cupom: nenhum dado da cliente.
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enviarEmail, moldeEmail, esc, SITE_PARCEIROS } from "./util.ts";

export type Pedido = {
  id: number;            // id numérico do pedido na Shopify
  numero: string;        // ex.: #1001
  criadoEm: string;      // data do pedido (ISO)
  subtotal: number;      // valor pago pelas peças, depois dos descontos, sem frete
  codigos: string[];     // cupons usados
  pago: boolean;         // pagamento aprovado
  canceladoEm: string | null;
};

export async function registrarPedido(db: SupabaseClient, p: Pedido): Promise<string> {
  const codigos = p.codigos.map((c) => String(c).trim().toUpperCase()).filter(Boolean);
  if (!codigos.length) return "sem cupom";

  // Pedido cancelado: sai da conta (se já estava registrado)
  if (p.canceladoEm) {
    const { data } = await db.from("vendas")
      .update({ situacao: "cancelada", cancelado_em: p.canceladoEm })
      .eq("shopify_order_id", p.id).eq("situacao", "valida").select("id");
    return data?.length ? "cancelado" : "cancelado sem registro";
  }
  if (!p.pago) return "não pago";

  const { data: cupom } = await db.from("cupons")
    .select("id,codigo,parceiro_id,campanha_id,campanhas(comissao_pct)")
    .in("codigo", codigos).limit(1).maybeSingle();
  if (!cupom) return "cupom de fora do programa";

  const comissao = (cupom as any).campanhas?.comissao_pct ?? 0;
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
  }, { onConflict: "shopify_order_id", ignoreDuplicates: true }).select("parceiro_id,cupom_codigo,valor_base,comissao_valor,mes_ref,data_pedido");
  if (error) throw error;
  if (!data?.length) return "já registrado";
  // Aviso de venda por e-mail (só para quem aceitou). Falha no e-mail nunca atrapalha o registro.
  try { await avisarVenda(db, data[0]); } catch (_) { /* segue */ }
  return "registrado";
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
