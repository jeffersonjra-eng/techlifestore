// Verificacao do administrador nas funcoes que mexem em dinheiro/estoque
// (ex.: gerar etiqueta paga no Melhor Envio).
//
// O painel admin.html faz login pelo Supabase Auth e envia o token da sessao
// no header "Authorization: Bearer <token>". Aqui o token e validado direto no
// Supabase (nada de senha escrita no codigo) e o e-mail precisa estar na lista
// ADMIN_EMAILS (variavel de ambiente no Netlify, separada por virgula).
// Se ADMIN_EMAILS nao estiver definida, ninguem passa (falha fechada).

const https = require('https');

const SUPA_URL_PADRAO = 'https://dprloosfnttdhibsihfk.supabase.co';
// Chave publica (anon): so identifica o projeto, nao da acesso a nada protegido.
const SUPA_ANON_PADRAO = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwcmxvb3NmbnR0ZGhpYnNpaGZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTc1MTQsImV4cCI6MjA5MjYzMzUxNH0.l6orZE8J77wTU0hKbDV2F7FvYbLB1DOEKqKDpnFlQ2k';

function emailsPermitidos() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(function (e) { return e.trim().toLowerCase(); })
    .filter(Boolean);
}

function pegarUsuario(token) {
  const base = (process.env.SUPABASE_URL || SUPA_URL_PADRAO).replace(/\/+$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || SUPA_ANON_PADRAO;
  const alvo = new URL(base + '/auth/v1/user');
  return new Promise(function (resolve, reject) {
    const req = https.request({
      hostname: alvo.hostname,
      path: alvo.pathname,
      method: 'GET',
      headers: { 'apikey': anon, 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    }, function (res) {
      let data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        if (res.statusCode !== 200) return resolve(null);
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Retorna { ok: true, email } ou { ok: false, status, erro }.
async function verificarAdmin(event) {
  const lista = emailsPermitidos();
  if (lista.length === 0) {
    return { ok: false, status: 500, erro: 'ADMIN_EMAILS nao configurado no servidor.' };
  }
  const h = (event && event.headers) || {};
  const auth = String(h.authorization || h.Authorization || '');
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, status: 401, erro: 'Faca login no painel para continuar.' };

  let usuario = null;
  try { usuario = await pegarUsuario(m[1].trim()); } catch (e) { usuario = null; }
  const email = usuario && usuario.email ? String(usuario.email).toLowerCase() : '';
  if (!email || lista.indexOf(email) === -1) {
    return { ok: false, status: 403, erro: 'Acesso negado.' };
  }
  return { ok: true, email: email };
}

module.exports = { verificarAdmin: verificarAdmin };
