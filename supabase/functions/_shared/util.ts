// Utilidades comuns às funções do Programa de Afiliados 99K
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function erro(mensagem: string, status = 400): Response {
  return json({ erro: mensagem }, status);
}

// Cliente com a chave de serviço: só existe no servidor, nunca vai para o navegador.
export function adminDb(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// E-mail opcional: só envia se a chave do serviço de e-mail estiver configurada.
export async function enviarEmail(para: string, assunto: string, html: string): Promise<boolean> {
  const chave = Deno.env.get("RESEND_API_KEY");
  const de = Deno.env.get("EMAIL_REMETENTE") ?? "99K Joias <parceiros@99kjoias.com.br>";
  if (!chave) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: de, to: [para], subject: assunto, html }),
    });
    return r.ok;
  } catch (_) {
    return false;
  }
}

export function moldeEmail(titulo: string, corpo: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f2f4f1;font-family:Arial,sans-serif;color:#10201b">
  <div style="max-width:520px;margin:0 auto;padding:28px 20px">
    <div style="background:#00261f;color:#cfab52;padding:16px 20px;border-radius:10px 10px 0 0;font-family:Georgia,serif;font-size:20px">99K Afiliados</div>
    <div style="background:#ffffff;padding:24px 20px;border-radius:0 0 10px 10px;border:1px solid #d6ddd9;border-top:0">
      <h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 14px">${titulo}</h1>
      ${corpo}
    </div>
  </div></body></html>`;
}

export const SITE_PARCEIROS = Deno.env.get("SITE_PARCEIROS") ?? "https://parceiros.99kjoias.com.br";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
