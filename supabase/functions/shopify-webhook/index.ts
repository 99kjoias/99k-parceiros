// Recebe os avisos da Shopify: pedido pago e pedido cancelado.
import { adminDb } from "../_shared/util.ts";
import { assinaturaValida } from "../_shared/shopify.ts";
import { pedidoDoWebhook, registrarPedido } from "../_shared/pedidos.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const corpo = await req.text();
  if (!(await assinaturaValida(corpo, req.headers.get("X-Shopify-Hmac-Sha256")))) {
    return new Response("assinatura inválida", { status: 401 });
  }
  const topico = req.headers.get("X-Shopify-Topic") ?? "";
  if (!["orders/paid", "orders/cancelled", "orders/updated"].includes(topico)) return new Response("ignorado");

  try {
    const pedido = pedidoDoWebhook(JSON.parse(corpo));
    const r = await registrarPedido(adminDb(), pedido);
    return new Response(r);
  } catch (e) {
    console.error("webhook", topico, e);
    // 500 faz a Shopify tentar de novo; a conferência de hora em hora também cobre.
    return new Response("erro", { status: 500 });
  }
});
