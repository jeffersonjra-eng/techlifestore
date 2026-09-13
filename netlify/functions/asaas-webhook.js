// Recebe as notificacoes de pagamento da Asaas (configurar em
// Configuracoes > Integracoes > Webhooks no painel da Asaas, apontando para
// https://techlifestore.com.br/.netlify/functions/asaas-webhook).
//
// Variavel de ambiente opcional:
//   ASAAS_WEBHOOK_TOKEN -> se definida, so aceita requisicoes que enviem o
//   mesmo valor no header 'asaas-access-token' (configurado no painel da
//   Asaas ao criar o webhook).

const { atualizarPorReferencia } = require('../lib/pedidos');

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

    if (EVENTOS_PAGO.indexOf(evento) !== -1) {
      await atualizarPorReferencia(referencia, {
        status: 'pago',
        pago_em: new Date().toISOString(),
        gateway_id: pagamento.id || null
      });
    } else if (EVENTOS_CANCELADO.indexOf(evento) !== -1) {
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
