// Persistencia de pedidos (vendas, carrinhos abandonados, envio) no Supabase.
// Reaproveita a mesma configuracao/credencial usada em precos.js.
//
// Tabela "Pedidos" (ver scripts/sql/pedidos.sql para o SQL de criacao):
//   referencia (unique), origem, status, cliente_*, endereco (jsonb),
//   itens (jsonb), subtotal, frete, total, gateway_id, pago_em,
//   envio_status, rastreio_codigo, etiqueta_url, melhor_envio_id, observacoes

const https = require('https');

const SUPA_URL_PADRAO = 'https://dprloosfnttdhibsihfk.supabase.co';
const SUPA_KEY_PADRAO = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwcmxvb3NmbnR0ZGhpYnNpaGZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTc1MTQsImV4cCI6MjA5MjYzMzUxNH0.l6orZE8J77wTU0hKbDV2F7FvYbLB1DOEKqKDpnFlQ2k';

function config() {
  const url = process.env.SUPABASE_URL || SUPA_URL_PADRAO;
  const key = process.env.SUPABASE_ANON_KEY || SUPA_KEY_PADRAO;
  return { url: url.replace(/\/+$/, ''), key: key };
}

function chamar(path, method, payload, extraHeaders) {
  const cfg = config();
  const alvo = new URL(cfg.url + '/rest/v1' + path);
  const postData = payload !== undefined ? JSON.stringify(payload) : '';
  const headers = Object.assign({
    'apikey': cfg.key,
    'Authorization': 'Bearer ' + cfg.key,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }, extraHeaders || {});
  if (postData) headers['Content-Length'] = Buffer.byteLength(postData);

  const options = { hostname: alvo.hostname, path: alvo.pathname + alvo.search, method: method, headers: headers };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data || 'null') }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// Cria ou atualiza (merge) um pedido pela referencia unica.
// Usado tanto para o "rascunho" de carrinho abandonado quanto para
// oficializar um pedido real - sempre a mesma linha, identificada por referencia.
async function salvarPedido(dados) {
  if (!dados || !dados.referencia) throw new Error('Pedido sem referencia');
  const r = await chamar('/Pedidos?on_conflict=referencia', 'POST', [dados], {
    'Prefer': 'resolution=merge-duplicates,return=representation'
  });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error('Falha ao salvar pedido: ' + (r.body && r.body.message ? r.body.message : JSON.stringify(r.body)));
  }
  return Array.isArray(r.body) ? r.body[0] : r.body;
}

async function atualizarPorReferencia(referencia, patch) {
  const r = await chamar('/Pedidos?referencia=eq.' + encodeURIComponent(referencia), 'PATCH', patch, { 'Prefer': 'return=representation' });
  if (r.status !== 200 && r.status !== 204) {
    throw new Error('Falha ao atualizar pedido: ' + (r.body && r.body.message ? r.body.message : JSON.stringify(r.body)));
  }
  return Array.isArray(r.body) ? r.body[0] : null;
}

async function atualizarPorGatewayId(gatewayId, patch) {
  const r = await chamar('/Pedidos?gateway_id=eq.' + encodeURIComponent(gatewayId), 'PATCH', patch, { 'Prefer': 'return=representation' });
  if (r.status !== 200 && r.status !== 204) {
    throw new Error('Falha ao atualizar pedido: ' + (r.body && r.body.message ? r.body.message : JSON.stringify(r.body)));
  }
  return Array.isArray(r.body) ? r.body[0] : null;
}

async function buscarPorReferencia(referencia) {
  const r = await chamar('/Pedidos?referencia=eq.' + encodeURIComponent(referencia) + '&select=*', 'GET');
  if (r.status !== 200) return null;
  return Array.isArray(r.body) && r.body[0] ? r.body[0] : null;
}

async function buscarPorGatewayId(gatewayId) {
  const r = await chamar('/Pedidos?gateway_id=eq.' + encodeURIComponent(gatewayId) + '&select=*', 'GET');
  if (r.status !== 200) return null;
  return Array.isArray(r.body) && r.body[0] ? r.body[0] : null;
}

function enderecoDe(sender) {
  return {
    rua: sender.rua || '', numero: sender.numero || '', complemento: sender.complemento || '',
    bairro: sender.bairro || '', cidade: sender.cidade || '', estado: sender.estado || '', cep: sender.cep || ''
  };
}

module.exports = {
  salvarPedido: salvarPedido,
  atualizarPorReferencia: atualizarPorReferencia,
  atualizarPorGatewayId: atualizarPorGatewayId,
  buscarPorReferencia: buscarPorReferencia,
  buscarPorGatewayId: buscarPorGatewayId,
  enderecoDe: enderecoDe
};
