// Recebe as notificacoes de pagamento da Asaas (configurar em
// Configuracoes > Integracoes > Webhooks no painel da Asaas, apontando para
// https://techlifestore.com.br/.netlify/functions/asaas-webhook).
//
// Variavel de ambiente opcional:
//   ASAAS_WEBHOOK_TOKEN -> se definida, so aceita requisicoes que enviem o
//   mesmo valor no header 'asaas-access-token' (configurado no painel da
//   Asaas ao criar o webhook).

const https = require('https');
const { atualizarPorReferencia } = require('../lib/pedidos');

// O corpo do webhook NAO e confiavel (qualquer pessoa pode enviar um POST). Antes de
// marcar um pedido como pago/cancelado, o pagamento e consultado na API da Asaas com a
// chave do servidor e so o que ela responder vale.
function consultarPagamentoAsaas(id) {
  const chave = process.env.ASAAS_API_KEY;
  if (!chave) return Promise.resolve(null);
  const host = process.env.ASAAS_ENV === 'production' ? 'api.asaas.com' : 'api-sandbox.asaas.com';
  return new Promise(function (resolve) {
    const req = https.request({
      hostname: host,
      path: '/v3/payments/' + encodeURIComponent(id),
      method: 'GET',
      headers: { 'access_token': chave, 'Accept': 'application/json', 'User-Agent': 'TechLifeStore-Webhook' }
    }, function (res) {
      let data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        if (res.statusCode !== 200) return resolve(null);
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    });
    req.on('error', function () { resolve(null); });
    req.end();
  });
}

const STATUS_PAGOS = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
const STATUS_CANCELADOS = ['REFUNDED', 'REFUND_REQUESTED', 'OVERDUE', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'];

const EVENTOS_PAGO = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'];
const EVENTOS_CANCELADO = ['PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'PAYMENT_OVERDUE', 'PAYMENT_CHARGEBACK_REQUESTED'];

exports.handler = async function (event) {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const tokenEsperado = process.env.ASAAS_WEBHOOK_TOKEN;
  if (tokenEsperado) {
    const recebido = (event.headers && (event.headers['asaas-access-token'] || event.headers['Asaas-Access-Token'])) || '';
    if (recebido !== tokenEsperado) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token invalido' }) };
    }
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const evento = body.event;
    const pagamento = body.payment || {};
    const referencia = pagamento.externalReference;

    if (!referencia) {
      // Nada a fazer (evento de outro tipo, ou sem referencia nossa)
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (EVENTOS_PAGO.indexOf(evento) === -1 && EVENTOS_CANCELADO.indexOf(evento) === -1) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // Confirma na Asaas: o pagamento precisa existir, pertencer a esta referencia e estar no status esperado.
    const real = pagamento.id ? await consultarPagamentoAsaas(pagamento.id) : null;
    if (!real || real.externalReference !== referencia) {
      console.error('Webhook Asaas ignorado: pagamento nao confirmado na API (ref ' + String(referencia).substring(0, 40) + ')');
      return { statusCode: 200, headers, body: JSON.stringify({ ok: false }) };
    }

    if (STATUS_PAGOS.indexOf(real.status) !== -1) {
      await atualizarPorReferencia(referencia, {
        status: 'pago',
        pago_em: new Date().toISOString(),
        gateway_id: real.id || null
      });
    } else if (STATUS_CANCELADOS.indexOf(real.status) !== -1) {
      await atualizarPorReferencia(referencia, { status: 'cancelado' });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    // Sempre responder 200 pra Asaas nao ficar re-tentando indefinidamente por erro nosso,
    // mas registrar no log da function pra podermos investigar depois.
    console.error('Erro no webhook Asaas:', e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, erro: e.message }) };
  }
};
