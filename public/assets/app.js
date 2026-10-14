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
    let r;
    try { r = await fetch(`${cfg.supabaseUrl}/functions/v1/${nome}`, { method: "POST", headers, body: JSON.stringify(corpo || {}) }); }
    catch (_) { throw new Error("Não foi possível falar com o servidor. Confira a internet e tente de novo."); }
    let j = {};
    try { j = await r.json(); } catch (_) { /* resposta vazia */ }
    if (!r.ok || j.erro) throw new Error(j.erro || "Não foi possível concluir agora. Tente de novo em instantes.");
    return j;
  }

  function soDigitos(s) { return String(s || "").replace(/\D/g, ""); }

  // Olhinho para mostrar/esconder a senha em todos os campos de senha
  const OLHO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const OLHO_FECHADO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2"/><path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.7-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  function olhinhos() {
    document.querySelectorAll('input[type="password"]').forEach((inp) => {
      if (inp.parentElement.classList.contains("senha-wrap")) return;
      const w = document.createElement("span"); w.className = "senha-wrap";
      inp.parentNode.insertBefore(w, inp); w.appendChild(inp);
      const b = document.createElement("button");
      b.type = "button"; b.className = "olho"; b.innerHTML = OLHO;
      b.setAttribute("aria-label", "Mostrar senha");
      b.onclick = () => {
        const ver = inp.type === "password";
        inp.type = ver ? "text" : "password";
        b.innerHTML = ver ? OLHO_FECHADO : OLHO;
        b.setAttribute("aria-label", ver ? "Esconder senha" : "Mostrar senha");
        inp.focus();
      };
      w.appendChild(b);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", olhinhos); else olhinhos();

  window.P = { sb, cfg, brl, dataCurta, dataHora, mesAtual, ultimosMeses, rotuloMes, esc, toast, chamar, soDigitos };
})();
