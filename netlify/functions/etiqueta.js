// Compra e geracao de etiqueta de envio via Melhor Envio, para um pedido ja pago.
// Fluxo da propria API do Melhor Envio: cart -> checkout (paga com o saldo da
// carteira) -> generate -> print (pega a url da etiqueta).
//
// Variaveis de ambiente necessarias (alem das ja usadas em frete.js/rastreio.js):
//   MELHORENVIO_TOKEN, MELHORENVIO_ENV, MELHORENVIO_UA, CEP_ORIGEM,
//   PACOTE_ALTURA/LARGURA/COMPRIMENTO/PESO
// Dados do remetente (opcionais - se ausentes, a Melhor Envio usa o cadastro
// da propria conta): REMETENTE_NOME, REMETENTE_DOCUMENTO, REMETENTE_ENDERECO,
// REMETENTE_NUMERO, REMETENTE_COMPLEMENTO, REMETENTE_BAIRRO, REMETENTE_CIDADE,
// REMETENTE_UF, REMETENTE_TELEFONE, REMETENTE_EMAIL

const https = require('https');
const { buscarPorReferencia, atualizarPorReferencia } = require('../lib/pedidos');

function pedir(options, body) {
  return new Promise(function (resolve, reject) {
    const req = https.request(options, function (res) {
      let data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try { resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function host() {
  return process.env.MELHORENVIO_ENV === 'sandbox' ? 'sandbox.melhorenvio.com.br' : 'melhorenvio.com.br';
}

function digitos(v) { return String(v || '').replace(/\D/g, ''); }

function baseHeaders(token) {
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
    'User-Agent': process.env.MELHORENVIO_UA || 'Tech Life Store (suporte@techlifestore.com.br)'
  };
}

async function chamar(path, payload, token) {
  const postData = JSON.stringify(payload);
  const r = await pedir({
    hostname: host(),
    path: path,
    method: 'POST',
    headers: Object.assign({}, baseHeaders(token), { 'Content-Length': Buffer.byteLength(postData) })
  }, postData);
  return r;
}

function erroMe(body) {
  if (body && body.errors) return JSON.stringify(body.errors);
  if (body && body.message) return body.message;
  return typeof body === 'string' ? body : JSON.stringify(body);
}

function remetente() {
  const r = {
    postal_code: digitos(process.env.CEP_ORIGEM || '')
  };
  if (process.env.REMETENTE_NOME) r.name = process.env.REMETENTE_NOME;
  if (process.env.REMETENTE_DOCUMENTO) {
    // CNPJ (14 digitos) vai em company_document; CPF (11 digitos) vai em document.
    // A Melhor Envio valida "document" estritamente como CPF, entao um CNPJ ali e rejeitado.
    const doc = digitos(process.env.REMETENTE_DOCUMENTO);
    if (doc.length === 14) r.company_document = doc;
    else if (doc.length === 11) r.document = doc;
  }
  if (process.env.REMETENTE_ENDERECO) r.address = process.env.REMETENTE_ENDERECO;
  if (process.env.REMETENTE_NUMERO) r.number = process.env.REMETENTE_NUMERO;
  if (process.env.REMETENTE_COMPLEMENTO) r.complement = process.env.REMETENTE_COMPLEMENTO;
  if (process.env.REMETENTE_BAIRRO) r.district = process.env.REMETENTE_BAIRRO;
  if (process.env.REMETENTE_CIDADE) r.city = process.env.REMETENTE_CIDADE;
  if (process.env.REMETENTE_UF) r.state_abbr = process.env.REMETENTE_UF;
  if (process.env.REMETENTE_TELEFONE) r.phone = digitos(process.env.REMETENTE_TELEFONE);
  if (process.env.REMETENTE_EMAIL) r.email = process.env.REMETENTE_EMAIL;
  return r;
}

function extrairUrlImpressao(body) {
  if (!body) return null;
  if (body.url) return body.url;
  if (Array.isArray(body)) {
    const item = body.find(function (i) { return i && i.url; });
    return item ? item.url : null;
  }
  if (Array.isArray(body.data)) {
    const item = body.data.find(function (i) { return i && i.url; });
    return item ? item.url : null;
  }
  return null;
}

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ erro: 'Metodo nao permitido' }) };

  const token = process.env.MELHORENVIO_TOKEN;
  if (!token) return { statusCode: 500, headers, body: JSON.stringify({ erro: 'Token do Melhor Envio nao configurado no servidor.' }) };

  try {
    const dados = JSON.parse(event.body || '{}');
    const referencia = String(dados.referencia || '').trim();
    if (!referencia) return { statusCode: 400, headers, body: JSON.stringify({ erro: 'Informe a referencia do pedido.' }) };

    const pedido = await buscarPorReferencia(referencia);
    if (!pedido) return { statusCode: 404, headers, body: JSON.stringify({ erro: 'Pedido nao encontrado.' }) };
    if (!['pago', 'combinado_whatsapp'].includes(pedido.status)) {
      return { statusCode: 400, headers, body: JSON.stringify({ erro: 'So e possivel gerar etiqueta para pedidos pagos.' }) };
    }
    if (pedido.envio_status === 'etiqueta_gerada' || pedido.envio_status === 'postado' || pedido.envio_status === 'entregue') {
      return { statusCode: 400, headers, body: JSON.stringify({ erro: 'Este pedido ja tem etiqueta gerada.', etiqueta_url: pedido.etiqueta_url }) };
    }
    if (!pedido.frete_servico_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ erro: 'Este pedido nao tem um servico de frete do Melhor Envio associado (foi combinado por outro meio?). Gere a etiqueta manualmente pelo painel do Melhor Envio.' }) };
    }

    const endereco = pedido.endereco || {};
    const itens = Array.isArray(pedido.itens) ? pedido.itens : [];
    const volume = itens.reduce(function (s, i) { return s + (Number(i.qtd) || 1); }, 0) || 1;

    const to = {
      name: pedido.cliente_nome || 'Cliente',
      email: pedido.cliente_email || undefined,
      phone: digitos(pedido.cliente_telefone),
      document: digitos(pedido.cliente_cpf),
      address: endereco.rua || '',
      complement: endereco.complemento || '',
      number: String(endereco.numero || 'S/N'),
      district: endereco.bairro || '',
      city: endereco.cidade || '',
      state_abbr: endereco.estado || '',
      postal_code: digitos(endereco.cep),
      country_id: 'BR'
    };

    const products = itens.length ? itens.map(function (i) {
      return { name: String(i.nome || 'Produto').substring(0, 100), quantity: Number(i.qtd) || 1, unitary_value: Number(i.preco) || 1 };
    }) : [{ name: 'Produto', quantity: 1, unitary_value: Number(pedido.total) || 1 }];

    const volumes = [{
      height: Number(process.env.PACOTE_ALTURA || 4),
      width: Number(process.env.PACOTE_LARGURA || 16),
      length: Number(process.env.PACOTE_COMPRIMENTO || 24),
      weight: Number((Number(process.env.PACOTE_PESO || 0.3) * volume).toFixed(3))
    }];

    // 1) Adicionar ao carrinho do Melhor Envio
    const carrinhoPayload = {
      service: Number(pedido.frete_servico_id) || pedido.frete_servico_id,
      from: remetente(),
      to: to,
      products: products,
      volumes: volumes,
      options: { insurance_value: Number(pedido.total) || 0, receipt: false, own_hand: false, platform: 'Tech Life Store' }
    };
    const cart = await chamar('/api/v2/me/cart', carrinhoPayload, token);
    if (cart.status !== 200 && cart.status !== 201) {
      return { statusCode: 502, headers, body: JSON.stringify({ erro: 'Falha ao adicionar frete no carrinho do Melhor Envio: ' + erroMe(cart.body) }) };
    }
    const orderId = cart.body.id;
    if (!orderId) {
      return { statusCode: 502, headers, body: JSON.stringify({ erro: 'Melhor Envio nao retornou um id de pedido no carrinho.' }) };
    }
    await atualizarPorReferencia(referencia, { melhor_envio_id: orderId });

    // 2) Pagar (usa o saldo da carteira do Melhor Envio)
    const checkout = await chamar('/api/v2/me/shipment/checkout', { orders: [orderId] }, token);
    if (checkout.status !== 200 && checkout.status !== 201) {
      return { statusCode: 502, headers, body: JSON.stringify({ erro: 'Falha ao pagar o frete (verifique o saldo da carteira do Melhor Envio): ' + erroMe(checkout.body), melhor_envio_id: orderId }) };
    }

    // 3) Gerar a etiqueta
    const generate = await chamar('/api/v2/me/shipment/generate', { orders: [orderId] }, token);
    if (generate.status !== 200 && generate.status !== 201) {
      return { statusCode: 502, headers, body: JSON.stringify({ erro: 'Frete pago, mas falhou ao gerar a etiqueta: ' + erroMe(generate.body), melhor_envio_id: orderId }) };
    }

    // 4) Pegar a url de impressao
    const print = await chamar('/api/v2/me/shipment/print', { orders: [orderId], mode: 'public' }, token);
    const url = extrairUrlImpressao(print.body);
    if (print.status !== 200 || !url) {
      return { statusCode: 502, headers, body: JSON.stringify({ erro: 'Etiqueta gerada, mas falhou ao obter o link de impressao. Acesse o painel do Melhor Envio para imprimir manualmente.', melhor_envio_id: orderId }) };
    }

    await atualizarPorReferencia(referencia, { envio_status: 'etiqueta_gerada', etiqueta_url: url, melhor_envio_id: orderId });

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, melhor_envio_id: orderId, etiqueta_url: url }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ erro: 'Erro inesperado ao gerar etiqueta: ' + e.message }) };
  }
};
