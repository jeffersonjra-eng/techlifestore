const https = require('https');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { items, sender } = JSON.parse(event.body);
    const token = process.env.PAGSEGURO_TOKEN;

    const total = items.reduce((sum, item) => {
      return sum + (Math.round(Number(item.preco) * 100) * item.qtd);
    }, 0);

    const payload = {
      reference_id: `pedido_${Date.now()}`,
      customer: {
        name: sender.nome,
        email: sender.email,
        tax_id: sender.cpf.replace(/\D/g, ''),
        phones: [{
          country: '55',
          area: sender.telefone.replace(/\D/g, '').substring(0, 2),
          number: sender.telefone.replace(/\D/g, '').substring(2),
          type: 'MOBILE'
        }]
      },
      items: items.map((item, i) => ({
        reference_id: String(i + 1),
        name: (item.nome || '').substring(0, 100),
        quantity: item.qtd,
        unit_amount: Math.round(Number(item.preco) * 100)
      })),
      shipping: {
        address: {
          street: sender.rua,
          number: sender.numero,
          complement: sender.complemento || '',
          locality: sender.bairro,
          city: sender.cidade,
          region_code: sender.estado,
          country: 'BRA',
          postal_code: sender.cep.replace(/\D/g, '')
        }
      },
      qr_codes: [{
        amount: { value: total }
      }],
      charges: [{
        reference_id: `charge_${Date.now()}`,
        description: 'Compra Tech Life Store',
        amount: { value: total, currency: 'BRL' },
        payment_method: { type: 'CREDIT_CARD', installments: 1, capture: true }
      }],
      redirect_url: 'https://techlifestore.com.br',
      notification_urls: ['https://techlifestore.com.br/.netlify/functions/notificacao']
    };

    const postData = JSON.stringify(payload);
    const options = {
      hostname: 'api.pagseguro.com',
      path: '/orders',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-api-version': '4.0',
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

    if (result.status === 201 || result.status === 200) {
      const links = result.body.links || [];
      const payLink = links.find(l => l.rel === 'PAY') || links[0];
      const url = payLink ? payLink.href : 'https://pagseguro.uol.com.br';
      return { statusCode: 200, headers, body: JSON.stringify({ url, id: result.body.id }) };
    } else {
      throw new Error(JSON.stringify(result.body));
    }

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
