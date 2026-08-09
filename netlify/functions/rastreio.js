const https = require('https');

function pedir(options, body) {
    return new Promise((resolve, reject) => {
          const req = https.request(options, (res) => {
                  let data = '';
                  res.on('data', chunk => data += chunk);
                  res.on('end', () => {
                            try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                            catch (e) { resolve({ status: res.statusCode, body: data }); }
                  });
          });
          req.on('error', reject);
          if (body) req.write(body);
          req.end();
    });
}

exports.handler = async function (event) {
    const headers = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'POST') {
          return { statusCode: 405, headers, body: JSON.stringify({ erro: 'Metodo nao permitido' }) };
    }

    try {
          const dados = JSON.parse(event.body || '{}');
          const busca = String(dados.codigo || '').trim();
          if (!busca) {
                  return { statusCode: 400, headers, body: JSON.stringify({ erro: 'Informe o codigo de rastreio.' }) };
          }

      const token = process.env.MELHORENVIO_TOKEN;
          if (!token) {
                  return { statusCode: 500, headers, body: JSON.stringify({ erro: 'Token do Melhor Envio nao configurado no servidor.' }) };
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

      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          let id = uuid.test(busca) ? busca : null;
          let pedido = null;

      if (!id) {
              const achou = await pedir({
                        hostname: host,
                        path: '/api/v2/me/orders/search?q=' + encodeURIComponent(busca),
                        method: 'GET',
                        headers: base
              });
              const lista = Array.isArray(achou.body) ? achou.body : (achou.body && achou.body.data) || [];
              if (achou.status === 401 || achou.status === 403) {
                        return { statusCode: 401, headers, body: JSON.stringify({ erro: 'Token do Melhor Envio invalido ou sem permissao. Verifique os escopos shipping-tracking e orders-read.' }) };
              }

              if (achou.status !== 200 || !lista.length) {
                        return { statusCode: 404, headers, body: JSON.stringify({ erro: 'Nao encontramos nenhum envio com esse codigo.' }) };
              }
              pedido = lista[0];
              id = pedido.id;
      }

      const postData = JSON.stringify({ orders: [id] });
          const resp = await pedir({
                  hostname: host,
                  path: '/api/v2/me/shipment/tracking',
                  method: 'POST',
                  headers: Object.assign({}, base, { 'Content-Length': Buffer.byteLength(postData) })
          }, postData);

      if (resp.status !== 200 || !resp.body || typeof resp.body !== 'object') {
              return { statusCode: 502, headers, body: JSON.stringify({ erro: 'Nao foi possivel consultar o rastreio agora. Tente novamente em alguns minutos.' }) };
      }

      const info = resp.body[id] || Object.keys(resp.body).map(k => resp.body[k])[0];
          if (!info || !info.status) {
                  return { statusCode: 404, headers, body: JSON.stringify({ erro: 'Nao encontramos nenhum envio com esse codigo.' }) };
          }

      return {
              statusCode: 200,
              headers,
              body: JSON.stringify({
                        protocolo: info.protocol || (pedido && pedido.protocol) || null,
                        status: info.status,
                        rastreio: info.tracking || info.melhorenvio_tracking || null,
                        datas: {
                                    criado: info.created_at || null,
                                    pago: info.paid_at || null,
                                    gerado: info.generated_at || null,
                                    postado: info.posted_at || null,
                                    entregue: info.delivered_at || null,
                                    cancelado: info.canceled_at || null
                        }
              })
      };
    } catch (e) {
          return { statusCode: 500, headers, body: JSON.stringify({ erro: 'Erro inesperado ao consultar o rastreio.' }) };
    }
};
