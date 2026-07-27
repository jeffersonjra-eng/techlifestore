const https = require('https');
const querystring = require('querystring');

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
    const email = 'suporte@techlifestore.com.br';

    // Montar parâmetros para API v2 do PagSeguro
    let params = {
      email: email,
      token: token,
      currency: 'BRL',
      redirectURL: 'https://techlifestore.com.br/obrigado.html',
      'senderName': sender.nome,
      'senderEmail': sender.email,
      'senderPhone': sender.telefone.replace(/\D/g,''),
      'senderCPF': sender.cpf.replace(/\D/g,''),
      'shippingAddressStreet': sender.rua,
      'shippingAddressNumber': sender.numero,
      'shippingAddressComplement': sender.complemento || '',
      'shippingAddressDistrict': sender.bairro,
      'shippingAddressCity': sender.cidade,
      'shippingAddressState': sender.estado,
      'shippingAddressCountry': 'BRA',
      'shippingAddressPostalCode': sender.cep.replace(/\D/g,''),
      'shippingType': '3',
      'shippingCost': '0.00',
    };

    // Adicionar itens
    items.forEach((item, i) => {
      const n = i + 1;
      params[`itemId${n}`] = String(n);
      params[`itemDescription${n}`] = (item.nome || '').substring(0, 100);
      params[`itemAmount${n}`] = Number(item.preco).toFixed(2);
      params[`itemQuantity${n}`] = item.qtd;
    });

    const postData = querystring.stringify(params);

    const options = {
      hostname: 'ws.pagseguro.uol.com.br',
      path: '/v2/checkout',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const result = await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    // Extrair código do XML de resposta
    const codeMatch = result.body.match(/<code>(.*?)<\/code>/);
    if (codeMatch) {
      const code = codeMatch[1];
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          url: `https://pagseguro.uol.com.br/v2/checkout/payment.html?code=${code}`
        })
      };
    } else {
      throw new Error('Resposta PagSeguro: ' + result.body);
    }

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
