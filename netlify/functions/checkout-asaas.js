// Checkout transparente Asaas (substitui o PagBank)
// Variaveis de ambiente necessarias no Netlify:
//   ASAAS_API_KEY -> chave de API da conta (sandbox ou producao)
//   ASAAS_ENV     -> 'production' ou 'sandbox' (padrao: sandbox)

const https = require('https');
const { itensConfiaveis, freteConfiavel } = require('../lib/precos');

function apiHost() {
  return process.env.ASAAS_ENV === 'production'
    ? 'api.asaas.com'
    : 'api-sandbox.asaas.com';
}

function asaas(path, method, payload, token) {
  const postData = payload ? JSON.stringify(payload) : '';
  const options = {
    hostname: apiHost(),
    path: '/v3' + path,
    method: method,
    headers: {
      'access_token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'TechLifeStore-Checkout'
    }
  };
  if (postData) options.headers['Content-Length'] = Buffer.byteLength(postData);
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

function digitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function hoje() {
  return new Date().toISOString().substring(0, 10);
}

function erroAsaas(body) {
  if (body && Array.isArray(body.errors) && body.errors.length) {
    return body.errors.map(function(e) { return e.description; }).join('; ');
  }
  return typeof body === 'string' ? body : JSON.stringify(body);
}

async function criarCliente(sender, token) {
  const payload = {
    name: sender.nome,
    email: sender.email,
    cpfCnpj: digitos(sender.cpf),
    mobilePhone: digitos(sender.telefone),
    postalCode: digitos(sender.cep),
    address: sender.rua,
    addressNumber: String(sender.numero || 'S/N'),
    complement: sender.complemento || '',
    province: sender.bairro || '',
    externalReference: 'techlife_' + Date.now()
  };
  const r = await asaas('/customers', 'POST', payload, token);
  if (r.status !== 200 && r.status !== 201) throw new Error('Falha ao criar cliente: ' + erroAsaas(r.body));
  return r.body.id;
}

function montarTotal(items, frete) {
  const totalItens = items.reduce(function(s, i) { return s + (i.preco * i.qtd); }, 0);
  const valorFrete = Math.max(0, Number(frete && frete.preco) || 0);
  return Math.round((totalItens + valorFrete) * 100) / 100;
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

  const token = process.env.ASAAS_API_KEY;
  if (!token) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ASAAS_API_KEY nao configurado no Netlify' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const acao = body.acao;
    const sender = body.sender;
    if (!sender) throw new Error('Dados do comprador ausentes');

    // Nome e preco vem do Supabase; do navegador so aproveitamos id e quantidade.
    const items = await itensConfiaveis(body.items);
    const frete = { preco: freteConfiavel(body.frete) };
    const total = montarTotal(items, frete);
    const referencia = 'pedido_' + Date.now();
    const descricao = ('Compra Tech Life Store - ' + items.map(function(i) { return i.nome; }).join(', ')).substring(0, 180);

    const customerId = await criarCliente(sender, token);

    // Pix - pagamento assincrono, confirmado por webhook/consulta posterior
    if (acao === 'pix') {
      const pagamento = {
        customer: customerId,
        billingType: 'PIX',
        value: total,
        dueDate: hoje(),
        description: descricao,
        externalReference: referencia
      };
      const r = await asaas('/payments', 'POST', pagamento, token);
      if (r.status !== 200 && r.status !== 201) throw new Error(erroAsaas(r.body));

      const qr = await asaas('/payments/' + r.body.id + '/pixQrCode', 'GET', null, token);
      if (qr.status !== 200) throw new Error(erroAsaas(qr.body));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          id: r.body.id,
          referencia: referencia,
          texto: qr.body.payload,
          imagem: qr.body.encodedImage ? ('data:image/png;base64,' + qr.body.encodedImage) : '',
          valor: total
        })
      };
    }

    // Cartao de credito - envio direto (sem criptografia no navegador, formato exigido pela Asaas)
    if (acao === 'cartao') {
      const cc = body.cartao;
      if (!cc) throw new Error('Dados do cartao ausentes');

      const ip = (event.headers && (event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'])) || '127.0.0.1';
      const parcelas = Number(cc.parcelas || 1);

      const pagamento = {
        customer: customerId,
        billingType: 'CREDIT_CARD',
        value: total,
        dueDate: hoje(),
        description: descricao,
        externalReference: referencia,
        creditCard: {
          holderName: cc.nome,
          number: cc.numero,
          expiryMonth: cc.validadeMes,
          expiryYear: cc.validadeAno,
          ccv: cc.cvv
        },
        creditCardHolderInfo: {
          name: cc.titular || sender.nome,
          email: sender.email,
          cpfCnpj: digitos(cc.cpfTitular || sender.cpf),
          postalCode: digitos(sender.cep),
          addressNumber: String(sender.numero || 'S/N'),
          addressComplement: sender.complemento || '',
          phone: digitos(sender.telefone)
        },
        remoteIp: ip
      };

      if (parcelas > 1) {
        pagamento.installmentCount = parcelas;
        pagamento.totalValue = total;
        delete pagamento.value;
      }

      const r = await asaas('/payments', 'POST', pagamento, token);
      if (r.status !== 200 && r.status !== 201) throw new Error(erroAsaas(r.body));

      const status = r.body.status;
      const aprovado = status === 'CONFIRMED' || status === 'RECEIVED';
      const emAnalise = status === 'PENDING' || status === 'AWAITING_RISK_ANALYSIS';
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          aprovado: aprovado,
          status: emAnalise ? 'IN_ANALYSIS' : (status || 'DESCONHECIDO'),
          mensagem: (!aprovado && !emAnalise) ? 'Pagamento nao autorizado pelo emissor' : '',
          id: r.body.id,
          referencia: referencia,
          valor: total
        })
      };
    }

    throw new Error('Acao invalida');
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
