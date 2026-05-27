const https = require('https');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { items, sender } = JSON.parse(event.body);
    const token = process.env.PAGSEGURO_TOKEN;
    const email = 'suporte@techlifestore.com.br';

    let itemsXml = '';
    items.forEach((item, i) => {
      itemsXml += `
        <item>
          <id>${i + 1}</id>
          <description>${(item.nome || '').substring(0, 100)}</description>
          <amount>${Number(item.preco).toFixed(2)}</amount>
          <quantity>${item.qtd}</quantity>
        </item>`;
    });

    const xml = `<?xml version="1.0" encoding="ISO-8859-1" standalone="yes"?>
<checkout>
  <currency>BRL</currency>
  <items>${itemsXml}
  </items>
  <sender>
    <name>${sender.nome}</name>
    <email>${sender.email}</email>
    <phone>
      <areaCode>${sender.telefone.substring(0, 2)}</areaCode>
      <number>${sender.telefone.substring(2)}</number>
    </phone>
  </sender>
  <shipping>
    <type>3</type>
    <cost>0.00</cost>
    <address>
      <street>${sender.rua}</street>
      <number>${sender.numero}</number>
      <complement>${sender.complemento || ''}</complement>
      <district>${sender.bairro}</district>
      <city>${sender.cidade}</city>
      <state>${sender.estado}</state>
      <country>BRA</country>
      <postalCode>${sender.cep.replace('-', '')}</postalCode>
    </address>
  </shipping>
</checkout>`;

    const options = {
      hostname: 'ws.pagseguro.uol.com.br',
      path: `/v2/checkout?email=${encodeURIComponent(email)}&token=${token}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml; charset=ISO-8859-1',
        'Content-Length': Buffer.byteLength(xml, 'utf8')
      }
    };

    const code = await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const match = data.match(/<code>(.*?)<\/code>/);
          if (match) resolve(match[1]);
          else reject(new Error('Erro PagSeguro: ' + data));
        });
      });
      req.on('error', reject);
      req.write(xml);
      req.end();
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        code,
        url: `https://pagseguro.uol.com.br/v2/checkout/payment.html?code=${code}`
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
