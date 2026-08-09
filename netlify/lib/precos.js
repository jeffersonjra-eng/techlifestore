// Precos oficiais dos produtos, lidos direto do Supabase.
// Nenhum valor enviado pelo navegador e usado para cobrar: o cliente informa
// apenas o id e a quantidade, o resto vem do banco.
//
// Variaveis de ambiente opcionais no Netlify (se faltarem, usa o padrao abaixo):
//   SUPABASE_URL       -> ex: https://xxxx.supabase.co
//   SUPABASE_ANON_KEY  -> chave anon do projeto

const https = require('https');

const QTD_MAXIMA = 99;
const FRETE_MAXIMO = 500;

// Fallback: se essas variaveis nao existirem no Netlify, o modulo usa os
// mesmos valores publicos que ja estao no HTML da loja. A chave anon nao da
// privilegio nenhum alem do que o navegador ja tem, entao nada novo e exposto.
const SUPA_URL_PADRAO = 'https://dprloosfnttdhibsihfk.supabase.co';
const SUPA_KEY_PADRAO = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwcmxvb3NmbnR0ZGhpYnNpaGZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTc1MTQsImV4cCI6MjA5MjYzMzUxNH0.l6orZE8J77wTU0hKbDV2F7FvYbLB1DOEKqKDpnFlQ2k';

function config() {
  const url = process.env.SUPABASE_URL || SUPA_URL_PADRAO;
  const key = process.env.SUPABASE_ANON_KEY || SUPA_KEY_PADRAO;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY nao configurados no Netlify');
  }
  return { url: url.replace(/\/+$/, ''), key: key };
}

function buscar(endereco, key) {
  return new Promise((resolve, reject) => {
    const alvo = new URL(endereco);
    const options = {
      hostname: alvo.hostname,
      path: alvo.pathname + alvo.search,
      method: 'GET',
      headers: {
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Accept': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('Supabase respondeu ' + res.statusCode));
        }
        try { resolve(JSON.parse(data || '[]')); }
        catch (e) { reject(new Error('Resposta invalida do Supabase')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Recebe o carrinho do navegador e devolve as linhas confiaveis do pedido.
// Lanca erro se algum produto nao existir ou se a quantidade for invalida.
async function itensConfiaveis(itensCliente) {
  if (!Array.isArray(itensCliente) || itensCliente.length === 0) {
    throw new Error('Carrinho vazio');
  }
  if (itensCliente.length > 50) {
    throw new Error('Carrinho com itens demais');
  }

  const ids = [];
  itensCliente.forEach((i) => {
    const id = String((i && i.id != null) ? i.id : '').trim();
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Item do carrinho sem id valido');
    if (ids.indexOf(id) === -1) ids.push(id);
  });

  const cfg = config();
  const endereco = cfg.url + '/rest/v1/Produtos?select=*&id=in.(' + ids.join(',') + ')';
  const produtos = await buscar(endereco, cfg.key);

  const porId = {};
  produtos.forEach((p) => { porId[String(p.id)] = p; });

  return itensCliente.map((i) => {
    const p = porId[String(i.id)];
    if (!p) throw new Error('Produto fora do catalogo: ' + i.id);

    const qtd = Math.floor(Number(i.qtd));
    if (!(qtd > 0) || qtd > QTD_MAXIMA) {
      throw new Error('Quantidade invalida para o produto ' + i.id);
    }

    const preco = Number(p['Preço']);
    if (!isFinite(preco) || preco <= 0) {
      throw new Error('Preco invalido no cadastro do produto ' + i.id);
    }

    return {
      id: String(p.id),
      nome: String(p.Nome || 'Produto'),
      preco: preco,
      qtd: qtd
    };
  });
}

// O frete ainda vem do navegador (cotacao do Melhor Envio), mas nunca e aceito
// sem limite: valor negativo, invalido ou absurdo e descartado.
function freteConfiavel(frete) {
  const valor = Number(frete && frete.preco);
  if (!isFinite(valor) || valor <= 0) return 0;
  return Math.min(valor, FRETE_MAXIMO);
}

module.exports = {
  itensConfiaveis: itensConfiaveis,
  freteConfiavel: freteConfiavel
};
