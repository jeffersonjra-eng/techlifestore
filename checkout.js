const https = require('https');

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

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { items, sender } = JSON.parse(event.body);
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_SECRET;
    const total = items.reduce((sum, item) => sum + (Number(item.preco) * item.qtd), 0).toFixed(2);
    const accessToken = await getPayPalToken(clientId, secret);

    const orderPayload = {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: `pedido_${Date.now()}`,
        description: 'Compra Tech Life Store',
        amount: {
          currency_code: 'BRL',
          value: total,
          breakdown: { item_total: { currency_code: 'BRL', value: total } }
        },
        items: items.map(item => ({
          name: (item.nome || '').substring(0, 127),
          quantity: String(item.qtd),
          unit_amount: { currency_code: 'BRL', value: Number(item.preco).toFixed(2) }
        })),
        shipping: {
          name: { full_name: sender.nome },
          address: {
            address_line_1: `${sender.rua}, ${sender.numero}`,
            address_line_2: sender.complemento || '',
            admin_area_2: sender.cidade,
            admin_area_1: sender.estado,
            postal_code: sender.cep.replace(/\D/g, ''),
            country_code: 'BR'
          }
        }
      }],
      application_context: {
        brand_name: 'Tech Life Store',
        locale: 'pt-BR',
        landing_page: 'BILLING',
        shipping_preference: 'SET_PROVIDED_ADDRESS',
        user_action: 'PAY_NOW',
        return_url: 'https://techlifestore.com.br/obrigado.html',
        cancel_url: 'https://techlifestore.com.br/carrinho.html'
      }
    };

    const postData = JSON.stringify(orderPayload);
    const options = {
      hostname: 'api-m.paypal.com',
      path: '/v2/checkout/orders',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
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
      req.write(postData);
      req.end();
    });

    if (result.status === 201) {
      const approveLink = result.body.links.find(l => l.rel === 'approve');
      return { statusCode: 200, headers, body: JSON.stringify({ url: approveLink.href, id: result.body.id }) };
    } else {
      throw new Error(JSON.stringify(result.body));
    }

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
