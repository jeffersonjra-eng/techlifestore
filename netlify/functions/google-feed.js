// Feed de produtos para o Google Merchant Center (Google Shopping).
// Gera o XML (RSS 2.0 + namespace g:) direto a partir do Supabase, sempre
// refletindo os produtos que estao Ativo=true no site agora.
//
// Variaveis de ambiente opcionais no Netlify (se faltarem, usa o mesmo
// Supabase publico que ja esta no HTML da loja - a chave anon nao da
// privilegio nenhum alem do que o navegador ja tem):
// SUPABASE_URL -> ex: https://xxxx.supabase.co
// SUPABASE_ANON_KEY -> chave anon do projeto

const https = require('https');

const SUPA_URL_PADRAO = 'https://dprloosfnttdhibsihfk.supabase.co';
const SUPA_KEY_PADRAO = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwcmxvb3NmbnR0ZGhpYnNpaGZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTc1MTQsImV4cCI6MjA5MjYzMzUxNH0.l6orZE8J77wTU0hKbDV2F7FvYbLB1DOEKqKDpnFlQ2k';
const SITE_URL = 'https://techlifestore.com.br';

function config() {
  const url = process.env.SUPABASE_URL || SUPA_URL_PADRAO;
  const key = process.env.SUPABASE_ANON_KEY || SUPA_KEY_PADRAO;
  return { url: url.replace(/\/+$/, ''), key: key };
}

function buscarProdutosAtivos() {
  return new Promise((resolve, reject) => {
    const cfg = config();
    const endereco = new URL(cfg.url + '/rest/v1/Produtos?select=*&Ativo=eq.true&order=id.desc');
    const options = {
      hostname: endereco.hostname,
      path: endereco.pathname + endereco.search,
      method: 'GET',
      headers: {
        'apikey': cfg.key,
        'Authorization': 'Bearer ' + cfg.key,
        'Accept': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('Supabase respondeu ' + res.statusCode + ': ' + data));
        }
        try { resolve(JSON.parse(data || '[]')); }
        catch (e) { reject(new Error('Resposta invalida do Supabase')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function escapeXml(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatarPreco(valor) {
  const n = Number(valor || 0);
  return n.toFixed(2) + ' BRL';
}

function itemParaXml(p) {
  const id = escapeXml(p.id);
  const titulo = escapeXml(p.Nome || '');
  const descricao = escapeXml((p['Descrição'] || p.Nome || '').toString().replace(/\s+/g, ' ').trim());
  const link = escapeXml(SITE_URL + '/produto.html?id=' + p.id);

  const fotos = [p.foto_url, p.foto2_url, p.foto3_url, p.foto4_url, p.foto5_url, p.foto6_url, p.foto7_url]
    .filter(Boolean);
  const imagemPrincipal = fotos[0] ? escapeXml(fotos[0]) : '';
  const imagensExtra = fotos.slice(1, 10)
    .map((f) => '      <g:additional_image_link>' + escapeXml(f) + '</g:additional_image_link>')
    .join('\n');

  const precoAtual = Number(p['Preço'] || 0);
  const precoAntigo = Number(p['Antigo Preço'] || 0);
  const temPromo = precoAntigo > 0 && precoAntigo > precoAtual;

  const precoTag = temPromo
    ? '      <g:price>' + formatarPreco(precoAntigo) + '</g:price>\n      <g:sale_price>' + formatarPreco(precoAtual) + '</g:sale_price>'
    : '      <g:price>' + formatarPreco(precoAtual) + '</g:price>';

  const categoria = escapeXml(p.categoria || '');

  return [
    '    <item>',
    '      <g:id>' + id + '</g:id>',
    '      <title>' + titulo + '</title>',
    '      <description>' + descricao + '</description>',
    '      <link>' + link + '</link>',
    imagemPrincipal ? '      <g:image_link>' + imagemPrincipal + '</g:image_link>' : '',
    imagensExtra,
    '      <g:availability>in_stock</g:availability>',
    precoTag,
    '      <g:condition>new</g:condition>',
    '      <g:brand>Tech Life Store</g:brand>',
    '      <g:identifier_exists>no</g:identifier_exists>',
    categoria ? '      <g:product_type>' + categoria + '</g:product_type>' : '',
    '    </item>'
  ].filter(Boolean).join('\n');
}

exports.handler = async function () {
  try {
    const produtos = await buscarProdutosAtivos();
    const itens = produtos.map(itemParaXml).join('\n');

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">\n' +
      '  <channel>\n' +
      '    <title>Tech Life Store</title>\n' +
      '    <link>' + SITE_URL + '</link>\n' +
      '    <description>Feed de produtos da Tech Life Store para o Google Merchant Center</description>\n' +
      itens + '\n' +
      '  </channel>\n' +
      '</rss>\n';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      },
      body: xml
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Erro ao gerar o feed: ' + (e && e.message ? e.message : 'erro desconhecido')
    };
  }
};
