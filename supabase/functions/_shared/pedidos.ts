// Regra de registro de um pedido com cupom de parceira.
// Só guarda número do pedido, data, valor e cupom: nenhum dado da cliente.
import { SupabaseClient } from "npm:@supabase/supabase-js@2";

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
  const { error } = await db.from("vendas").upsert({
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
  }, { onConflict: "shopify_order_id", ignoreDuplicates: true });
  if (error) throw error;
  return "registrado";
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
