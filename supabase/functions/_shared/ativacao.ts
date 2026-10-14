// Link de ativação: o token vai só no link; no banco fica apenas o hash dele.
export const DIAS_VALIDADE = 14;

export function novoToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(h).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function linkAtivacao(site: string, token: string): string {
  return `${site}/ativar?t=${encodeURIComponent(token)}`;
}
