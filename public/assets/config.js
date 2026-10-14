// Endereço oficial: quem abrir pelo endereço técnico do Cloudflare (.pages.dev) vai para o oficial.
if (/\.pages\.dev$/.test(location.hostname)) {
  location.replace("https://parceiros.99kjoias.com.br" + location.pathname + location.search + location.hash);
}
// Configuração pública do Programa de Afiliados 99K.
// A chave abaixo é a chave publicável do Supabase: foi feita para ficar no navegador.
// O que protege os dados são as permissões do banco (cada afiliado só vê o que é dele).
window.PARCEIROS_CONFIG = {
  supabaseUrl: "https://fbedndukcrnnlssqkkez.supabase.co",
  supabaseKey: "sb_publishable_Fck50SbIbiLiQYosCO0_jQ_7PyhZZaQ",
  siteLoja: "https://99kjoias.com.br",
  emailContato: "adm@99kjoias.com.br",
  versaoRegras: "v2-2026-10-14",
};
