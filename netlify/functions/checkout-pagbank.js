// Checkout transparente PagBank (PagSeguro)
// Variaveis de ambiente necessarias no Netlify:
//   PAGBANK_TOKEN             -> token da conta (obrigatorio, nunca no codigo)
//   PAGBANK_ENV              -> 'production' ou 'sandbox' (padrao: sandbox)
//   PAGBANK_NOTIFICATION_URL -> url do webhook de notificacao (opcional)

const https = require('https');
const { itensConfiaveis, freteConfiavel } = require('../lib/precos');

function apiHost() {
  return process.env.PAGBANK_ENV === 'production'
    ? 'api.pagseguro.com'
    : 'sandbox.api.pagseguro.com';
}

function pagbank(path, method, payload, token) {
  const postData = payload ? JSON.stringify(payload) : '';
  const options = {
    hostname: apiHost(),
    path: path,
    method: method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function centavos(valor) {
  return Math.round(Number(valor || 0) * 100);
}

function digitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function montarPedido(items, sender, frete) {
  const tel = digitos(sender.telefone);
  const linhas = items.map(i => ({
    reference_id: String(i.id),
    name: String(i.nome || 'Produto').substring(0, 100),
    quantity: Number(i.qtd),
    unit_amount: centavos(i.preco)
  }));

  const valorFrete = Math.max(0, centavos(frete && frete.preco));
  if (valorFrete > 0) {
    linhas.push({ reference_id: 'frete', name: 'Frete', quantity: 1, unit_amount: valorFrete });
  }

  const total = linhas.reduce((s, i) => s + (i.unit_amount * i.quantity), 0);

  const pedido = {
    reference_id: 'pedido_' + Date.now(),
    customer: {
      name: sender.nome,
      email: sender.email,
      tax_id: digitos(sender.cpf),
      phones: [{
        country: '55',
        area: tel.slice(0, 2),
        number: tel.slice(2),
        type: 'MOBILE'
      }]
    },
    items: linhas,
    shipping: {
      address: {
        street: sender.rua,
        number: String(sender.numero),
        complement: sender.complemento || '',
        locality: sender.bairro || '',
        city: sender.cidade,
        region_code: sender.estado,
        country: 'BRA',
        postal_code: digitos(sender.cep)
      }
    }
  };

  if (process.env.PAGBANK_NOTIFICATION_URL) {
    pedido.notification_urls = [process.env.PAGBANK_NOTIFICATION_URL];
  }

  return { pedido: pedido, total: total, valorFrete: valorFrete };
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const token = process.env.PAGBANK_TOKEN;
  if (!token) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'PAGBANK_TOKEN nao configurado' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const acao = body.acao;

    // 1) Chave publica usada pelo SDK para criptografar o cartao no navegador
    if (acao === 'chave') {
      const r = await pagbank('/public-keys', 'POST', { type: 'card' }, token);
      if (r.status !== 200 && r.status !== 201) throw new Error(JSON.stringify(r.body));
      return { statusCode: 200, headers, body: JSON.stringify({ public_key: r.body.public_key }) };
    }

    const sender = body.sender;
    if (!sender) throw new Error('Dados do comprador ausentes');

    // Nome e preco vem do Supabase; do navegador so aproveitamos id e quantidade.
    const items = await itensConfiaveis(body.items);
    const frete = { preco: freteConfiavel(body.frete) };

    const montado = montarPedido(items, sender, frete);

    // 2) Pix (QR Code) - pagamento assincrono, confirmado pelo webhook
    if (acao === 'pix') {
      montado.pedido.qr_codes = [{ amount: { value: montado.total } }];
      const r = await pagbank('/orders', 'POST', montado.pedido, token);
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      const qr = (r.body.qr_codes || [])[0] || {};
      const links = qr.links || [];
      const imagem = (links.filter(l => l.media === 'image/png')[0] || {}).href;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          id: r.body.id,
          referencia: montado.pedido.reference_id,
          texto: qr.text,
          imagem: imagem,
          valor: montado.total
        })
      };
    }

    // 3) Cartao de credito - checkout transparente, captura automatica
    if (acao === 'cartao') {
      if (!body.encrypted) throw new Error('Cartao nao criptografado');
      montado.pedido.charges = [{
        reference_id: montado.pedido.reference_id,
        description: 'Compra Tech Life Store',
        amount: { value: montado.total, currency: 'BRL' },
        payment_method: {
          type: 'CREDIT_CARD',
          installments: Number(body.parcelas || 1),
          capture: true,
          card: { encrypted: body.encrypted, store: false },
          holder: {
            name: body.titular || sender.nome,
            tax_id: digitos(body.cpfTitular || sender.cpf)
          }
        }
      }];

      const r = await pagbank('/orders', 'POST', montado.pedido, token);
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      const cobranca = (r.body.charges || [])[0] || {};
      const resposta = cobranca.payment_response || {};
      const aprovado = cobranca.status === 'PAID' || cobranca.status === 'AUTHORIZED';
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          aprovado: aprovado,
          status: cobranca.status || 'DESCONHECIDO',
          mensagem: resposta.message || '',
          id: r.body.id,
          referencia: montado.pedido.reference_id,
          valor: montado.total
        })
      };
    }

    throw new Error('Acao invalida');
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
