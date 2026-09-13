// Captura (efetiva) uma order do PayPal apos o cliente aprovar o pagamento.
// Isso faltava no fluxo antigo: o checkout.js so cria a order e redireciona
// pro PayPal, mas o dinheiro so e de fato capturado com essa chamada extra.
// Chamado pela obrigado.html quando ela recebe ?token=<order_id> na volta do PayPal.

const https = require('https');
const { atualizarPorGatewayId } = require('../lib/pedidos');

async function getPayPalToken(clientId, secret) {
  const credentials = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const postData = 'grant_type=client_credentials';
  const options = {
    hostname: 'api-m.paypal.com',
    path: '/v1/oauth2/token',
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error('Token error: ' + data));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const orderId = String(body.orderId || '').trim();
    if (!orderId) throw new Error('orderId ausente');

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_SECRET;
    const accessToken = await getPayPalToken(clientId, secret);

    const options = {
      hostname: 'api-m.paypal.com',
      path: `/v2/checkout/orders/${orderId}/capture`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': 0
      }
    };

    const result = await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch(e) { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      req.end();
    });

    // 201 = capturado agora; 422 com ORDER_ALREADY_CAPTURED = ja tinha sido capturado antes
      // (ex: usuario recarregou a pagina de obrigado)
    const jaCapturada = result.status === 422 && JSON.stringify(result.body).indexOf('ORDER_ALREADY_CAPTURED') !== -1;

    if (result.status !== 201 && !jaCapturada) {
      throw new Error(JSON.stringify(result.body));
    }

    try {
      await atualizarPorGatewayId(orderId, { status: 'pago', pago_em: new Date().toISOString() });
    } catch (e) { /* nao bloqueia a resposta ao cliente */ }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, status: jaCapturada ? 'ALREADY_CAPTURED' : (result.body.status || 'COMPLETED') }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
