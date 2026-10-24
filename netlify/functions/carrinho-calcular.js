// Cotacao do carrinho para a tela de checkout: devolve linhas, descontos
// (combo, cupom, Pix), brinde, sugestoes de order bump/upsell/combo e o total.
// Todo valor sai do servidor/banco; o navegador so manda ids, quantidades,
// cupom e forma de pagamento.

const { calcularPedido } = require('../lib/ofertas');

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const r = await calcularPedido({ items: body.items, cupom: body.cupom, forma: body.forma, frete: body.frete });
    return { statusCode: 200, headers, body: JSON.stringify(r) };
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: err.message }) };
  }
};
