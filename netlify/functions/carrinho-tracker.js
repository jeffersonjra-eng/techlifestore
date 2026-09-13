// Rascunho de pedido: usado para (a) carrinhos abandonados - grava um
// snapshot do carrinho + contato assim que o cliente preenche e-mail/CEP,
// antes de pagar - e (b) pedidos combinados pelo WhatsApp, que nao passam
// por nenhum gateway de pagamento do site.
//
// So aceita os status abaixo (nunca 'pago'), pra esse endpoint aberto nao
// poder ser usado pra forjar uma venda como paga.

const { itensConfiaveis, freteConfiavel } = require('../lib/precos');
const { salvarPedido, enderecoDe } = require('../lib/pedidos');

const STATUS_PERMITIDOS = ['abandonado', 'combinado_whatsapp'];

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const referencia = String(body.referencia || '').trim();
    if (!referencia) throw new Error('Referencia ausente');
    if (!Array.isArray(body.items) || body.items.length === 0) throw new Error('Carrinho vazio');

    const status = STATUS_PERMITIDOS.indexOf(body.status) !== -1 ? body.status : 'abandonado';
    const sender = body.sender || {};

    const items = await itensConfiaveis(body.items);
    const freteValor = freteConfiavel(body.frete);
    const subtotal = items.reduce(function(s, i) { return s + (i.preco * i.qtd); }, 0);
    const total = Math.round((subtotal + freteValor) * 100) / 100;

    await salvarPedido({
      referencia: referencia,
      origem: status === 'combinado_whatsapp' ? 'whatsapp' : 'site',
      status: status,
      cliente_nome: sender.nome || null, cliente_email: sender.email || null,
      cliente_telefone: sender.telefone || null, cliente_cpf: sender.cpf || null,
      endereco: enderecoDe(sender), itens: items,
      subtotal: subtotal, frete: freteValor,
      frete_servico_id: (body.frete && body.frete.id) || null, frete_nome: (body.frete && body.frete.nome) || null,
      total: total
    });

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
