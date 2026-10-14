// Funções compartilhadas pelas páginas do Programa de Afiliados 99K
(function () {
  const cfg = window.PARCEIROS_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const dataCurta = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
  const dataHora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const nomeMes = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });

  function mesAtual() {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(new Date());
    return p.slice(0, 7) + "-01";
  }
  function ultimosMeses(n) {
    const [a, m] = mesAtual().split("-").map(Number);
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(Date.UTC(a, m - 1 - i, 1));
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }
  function rotuloMes(iso) {
    const t = nomeMes.format(new Date(iso + "T12:00:00Z"));
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  let toastTimer;
  function toast(msg, erro) {
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.toggle("erro", !!erro);
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), erro ? 6000 : 3500);
  }

  // Chama uma função do servidor (Supabase Edge Function)
  async function chamar(nome, corpo) {
    const { data: { session } } = await sb.auth.getSession();
    const headers = { "Content-Type": "application/json", apikey: cfg.supabaseKey };
    if (session) headers.Authorization = "Bearer " + session.access_token;
    const r = await fetch(`${cfg.supabaseUrl}/functions/v1/${nome}`, { method: "POST", headers, body: JSON.stringify(corpo || {}) });
    let j = {};
    try { j = await r.json(); } catch (_) { /* resposta vazia */ }
    if (!r.ok || j.erro) throw new Error(j.erro || "Não foi possível concluir agora. Tente de novo em instantes.");
    return j;
  }

  function soDigitos(s) { return String(s || "").replace(/\D/g, ""); }

  window.P = { sb, cfg, brl, dataCurta, dataHora, mesAtual, ultimosMeses, rotuloMes, esc, toast, chamar, soDigitos };
})();
