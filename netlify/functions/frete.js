const https = require('https');

function pedir(options, body) {
  return new Promise(function (resolve, reject) {
    const req = https.request(options, function (res) {
      let data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) { req.write(body); }
    req.end();
  });
}

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') { return { statusCode: 200, headers, body: '' }; }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ erro: 'Metodo nao permitido' }) };
  }

  try {
    const dados = JSON.parse(event.body || '{}');
    const cep = String(dados.cep || '').replace(/\D/g, '');
    const itens = Array.isArray(dados.itens) ? dados.itens : [];

    if (cep.length !== 8) {
      return { statusCode: 400, headers, body: JSON.stringify({ erro: 'Informe um CEP valido com 8 digitos.' }) };
    }
    if (!itens.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ erro: 'Seu carrinho esta vazio.' }) };
    }

    const subtotal = itens.reduce(function (s, i) { return s + (Number(i.preco) || 0) * (Number(i.qtd) || 1); }, 0);
    const limite = Number(process.env.FRETE_GRATIS_ACIMA || 199);

    if (subtotal >= limite) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          gratis: true,
          subtotal: subtotal,
          opcoes: [{
            id: 'gratis',
            nome: 'Frete gratis',
            empresa: 'Tech Life Store',
            preco: 0,
            prazo: Number(process.env.FRETE_GRATIS_PRAZO || 10)
          }]
        })
      };
    }

    const token = process.env.MELHORENVIO_TOKEN;
    if (!token) {
      return { statusCode: 500, headers, body: JSON.stringify({ erro: 'Token do Melhor Envio nao configurado no servidor.' }) };
    }

    const origem = String(process.env.CEP_ORIGEM || '11497560').replace(/\D/g, '');
    if (origem.length !== 8) {
      return { statusCode: 500, headers, body: JSON.stringify({ erro: 'CEP de origem nao configurado no servidor.' }) };
    }

    const host = process.env.MELHORENVIO_ENV === 'sandbox'
      ? 'sandbox.melhorenvio.com.br'
      : 'melhorenvio.com.br';

    const base = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      'User-Agent': process.env.MELHORENVIO_UA || 'Tech Life Store (suporte@techlifestore.com.br)'
    };

    const volume = itens.reduce(function (s, i) { return s + (Number(i.qtd) || 1); }, 0);
    const pacote = {
      height: Number(process.env.PACOTE_ALTURA || 4),
      width: Number(process.env.PACOTE_LARGURA || 16),
      length: Number(process.env.PACOTE_COMPRIMENTO || 24),
      weight: Number((Number(process.env.PACOTE_PESO || 0.3) * volume).toFixed(3))
    };

    const corpo = JSON.stringify({
      from: { postal_code: origem },
      to: { postal_code: cep },
      package: pacote,
      options: { insurance_value: subtotal, receipt: false, own_hand: false }
    });

    const calc = await pedir({
      hostname: host,
      path: '/api/v2/me/shipment/calculate',
      method: 'POST',
      headers: Object.assign({}, base, { 'Content-Length': Buffer.byteLength(corpo) })
    }, corpo);

    if (calc.status === 401 || calc.status === 403) {
      return { statusCode: 502, headers, body: JSON.stringify({ erro: 'Token do Melhor Envio invalido ou expirado.' }) };
    }

    if (calc.status >= 400 || !Array.isArray(calc.body)) {
      return { statusCode: 502, headers, body: JSON.stringify({ erro: 'Nao foi possivel calcular o frete agora. Tente novamente.' }) };
    }

    const extra = Number(process.env.FRETE_TAXA_EXTRA || 0);
    const opcoes = calc.body
      .filter(function (o) { return o && !o.error && o.price; })
      .map(function (o) {
        return {
          id: o.id,
          nome: o.name,
          empresa: (o.company && o.company.name) || null,
          preco: Number((Number(o.price) + extra).toFixed(2)),
          prazo: Number(o.delivery_time) || null
        };
      })
      .sort(function (a, b) { return a.preco - b.preco; });

    if (!opcoes.length) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ gratis: false, subtotal: subtotal, opcoes: [], aviso: 'Nenhuma transportadora atende esse CEP no momento.' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        gratis: false,
        subtotal: subtotal,
        falta_para_gratis: Number((limite - subtotal).toFixed(2)),
        opcoes: opcoes
      })
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ erro: 'Erro inesperado ao calcular o frete.' }) };
  }
};
