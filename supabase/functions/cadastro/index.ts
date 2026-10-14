// Cadastro de afiliado (página pública), primeira etapa: dados pessoais, endereço e aceite das regras.
// O login é criado sem senha (ninguém consegue entrar); a senha, o cupom e a chave Pix vêm na ativação, depois da aprovação.
import { adminDb, cors, erro, json, enviarEmail, moldeEmail, esc, SITE_PARCEIROS } from "../_shared/util.ts";

const so = (s: unknown) => String(s ?? "").trim();
const dig = (s: unknown) => so(s).replace(/\D/g, "");

function cpfValido(c: string): boolean {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  let s = 0; for (let i = 0; i < 9; i++) s += +c[i] * (10 - i);
  let d = (s * 10) % 11; if (d === 10) d = 0; if (d !== +c[9]) return false;
  s = 0; for (let i = 0; i < 10; i++) s += +c[i] * (11 - i);
  d = (s * 10) % 11; if (d === 10) d = 0; return d === +c[10];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return erro("Método não permitido.", 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch (_) { return erro("Dados inválidos."); }
  if (so(b.site)) return json({ ok: true }); // robô preencheu o campo escondido

  const d = {
    nome: so(b.nome).replace(/\s+/g, " "),
    cpf: dig(b.cpf),
    email: so(b.email).toLowerCase(),
    whatsapp: dig(b.whatsapp),
    instagram: so(b.instagram).replace(/^@+/, ""),
    cep: dig(b.cep),
    rua: so(b.rua), numero: so(b.numero), complemento: so(b.complemento) || null,
    bairro: so(b.bairro), cidade: so(b.cidade), estado: so(b.estado).toUpperCase(),
    colecao: so(b.colecao) || null,
    versao: so(b.versao_regras) || "v1",
  };

  if (b.aceite !== true) return erro("É preciso aceitar as regras do programa.");
  if (d.nome.split(" ").length < 2 || d.nome.length > 120) return erro("Escreva nome e sobrenome.");
  if (!cpfValido(d.cpf)) return erro("CPF inválido.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email) || d.email.length > 200) return erro("E-mail inválido.");
  if (d.whatsapp.length < 10 || d.whatsapp.length > 13) return erro("WhatsApp inválido. Coloque o número com DDD.");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(d.instagram)) return erro("Escreva só o seu @ do Instagram.");
  if (d.cep.length !== 8) return erro("CEP inválido.");
  if (!d.rua || !d.numero || !d.bairro || !d.cidade) return erro("Complete o endereço.");
  if (!/^[A-Z]{2}$/.test(d.estado)) return erro("Escolha o estado.");

  const db = adminDb();

  const [{ data: porCpf }, { data: porEmail }] = await Promise.all([
    db.from("parceiros").select("id,status").eq("cpf", d.cpf).maybeSingle(),
    db.from("parceiros").select("id,status").eq("email", d.email).maybeSingle(),
  ]);
  // Quem foi recusado pode se cadastrar de novo, do zero (decisão de Matheus, 14/10/2026).
  // Cadastro em análise, ativo ou encerrado continua bloqueando.
  if (porCpf && porCpf.status !== "recusada") return erro("Já existe um cadastro com este CPF. Se for seu, fale com a 99K.");
  if (porEmail && porEmail.status !== "recusada") return erro("Já existe um cadastro com este e-mail.");

  let colecao = d.colecao;
  if (colecao) {
    const { data: c } = await db.from("colecoes").select("handle").eq("handle", colecao).maybeSingle();
    if (!c) colecao = null;
  }

  const dados = {
    nome: d.nome, cpf: d.cpf, email: d.email, whatsapp: d.whatsapp, instagram: d.instagram,
    cep: d.cep, rua: d.rua, numero: d.numero, complemento: d.complemento, bairro: d.bairro, cidade: d.cidade, estado: d.estado,
    colecao_preferida: colecao,
    status: "pendente", aceite_regras_em: new Date().toISOString(), versao_regras: d.versao,
  };

  const reaproveitar = porEmail ?? porCpf; // cadastro recusado que volta a valer, como novo
  if (reaproveitar) {
    // Se CPF e e-mail eram de dois cadastros recusados diferentes, o outro sai
    if (porCpf && porEmail && porCpf.id !== porEmail.id) {
      await db.from("parceiros").delete().eq("id", porCpf.id);
      await db.auth.admin.deleteUser(porCpf.id);
    }
    if (!porEmail) {
      const { error: eu } = await db.auth.admin.updateUserById(reaproveitar.id, { email: d.email, email_confirm: true });
      if (eu) return erro("Este e-mail já tem cadastro. Se precisar de ajuda, fale com a 99K.");
    }
    const { error: er } = await db.from("parceiros").update({
      ...dados, criado_em: new Date().toISOString(), campanha_id: null, aprovado_em: null, motivo_recusa: null,
      codigo_desejado: null, chave_pix: null, ativado_em: null, ativacao_hash: null, ativacao_expira: null,
    }).eq("id", reaproveitar.id);
    if (er) return erro("Não foi possível salvar o cadastro. Confira os dados e tente de novo.", 500);
  } else {
    const { data: criado, error: e1 } = await db.auth.admin.createUser({ email: d.email, email_confirm: true });
    if (e1 || !criado?.user) {
      const msg = String(e1?.message ?? "");
      if (/already|registered|exists/i.test(msg)) return erro("Este e-mail já tem cadastro. Se precisar de ajuda, fale com a 99K.");
      return erro("Não foi possível criar o acesso agora. Tente de novo em instantes.", 500);
    }
    const { error: e2 } = await db.from("parceiros").insert({ id: criado.user.id, ...dados });
    if (e2) {
      await db.auth.admin.deleteUser(criado.user.id);
      if (/cpf/i.test(e2.message)) return erro("Já existe um cadastro com este CPF.");
      return erro("Não foi possível salvar o cadastro. Confira os dados e tente de novo.", 500);
    }
  }

  // Confirmação para quem se cadastrou
  await enviarEmail(d.email, "Recebemos o seu cadastro | 99K Afiliados", moldeEmail(
    `${esc(d.nome.split(" ")[0])}, recebemos o seu cadastro`,
    `<p>Seu cadastro no Programa de Afiliados 99K já foi recebido!</p>
     <p>Nossa equipe vai analisar o seu cadastro e te responder por aqui ou pelo WhatsApp. A análise é bem rápida.</p>
     <p>Equipe 99K JOIAS.</p>`));

  // Aviso para a 99K (se o e-mail estiver configurado)
  const avisar = Deno.env.get("EMAIL_AVISO_LOJISTA");
  if (avisar) {
    await enviarEmail(avisar, `Novo cadastro de afiliado: ${d.nome}`, moldeEmail("Novo cadastro para analisar",
      `<p><strong>${esc(d.nome)}</strong> (@${esc(d.instagram)}) se cadastrou e está esperando análise.</p>
       <p><a href="${SITE_PARCEIROS}/admin" style="color:#004236">Abrir o painel do lojista</a></p>`));
  }

  return json({ ok: true });
});
