// Calculo OFICIAL do pedido: precos, cupom, combos, brindes, order bump/upsell e
// desconto do Pix. Tudo e calculado aqui, no servidor, a partir do banco
// (Supabase). O navegador so informa ids, quantidades, o codigo do cupom e a
// forma de pagamento - nunca valores.
//
// Tabelas (ver scripts/sql/ofertas.sql): Ofertas, Cupons, Configuracoes.
// Se elas ainda nao existirem, o calculo segue normalmente sem ofertas/cupons
// (a venda nunca para por causa disso).

const https = require('https');
const { freteConfiavel } = require('./precos');

const QTD_MAXIMA = 99;
const SUPA_URL_PADRAO = 'https://dprloosfnttdhibsihfk.supabase.co';
const SUPA_KEY_PADRAO = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwcmxvb3NmbnR0ZGhpYnNpaGZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTc1MTQsImV4cCI6MjA5MjYzMzUxNH0.l6orZE8J77wTU0hKbDV2F7FvYbLB1DOEKqKDpnFlQ2k';
const PIX_PCT_PADRAO = 4;
const ID_OK = /^[A-Za-z0-9_-]+$/;
const CUPOM_OK = /^[A-Z0-9_-]{2,30}$/;

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Usa a chave de servico quando existe (le produtos ocultos usados como brinde
// e valida cupons, que nao sao publicos); cai na chave anon senao.
function config() {
  const url = process.env.SUPABASE_URL || SUPA_URL_PADRAO;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || SUPA_KEY_PADRAO;
  return { url: url.replace(/\/+$/, ''), key: key };
}

function chamar(path, method, payload) {
  const cfg = config();
  const alvo = new URL(cfg.url + '/rest/v1' + path);
  const postData = payload !== undefined ? JSON.stringify(payload) : '';
  const headers = {
    'apikey': cfg.key,
    'Authorization': 'Bearer ' + cfg.key,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };
  if (postData) headers['Content-Length'] = Buffer.byteLength(postData);
  return new Promise(function (resolve, reject) {
    const req = https.request({ hostname: alvo.hostname, path: alvo.pathname + alvo.search, method: method, headers: headers }, function (res) {
      let data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('Supabase respondeu ' + res.statusCode));
        try { resolve(JSON.parse(data || 'null')); } catch (e) { resolve(null); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// Leituras "opcionais" (tabelas novas): qualquer falha vira lista vazia.
async function listarSeguro(path) {
  try { const r = await chamar(path, 'GET'); return Array.isArray(r) ? r : []; }
  catch (e) { return []; }
}

async function carregarProdutos(ids) {
  const lista = Array.from(new Set(ids.map(String))).filter(function (i) { return ID_OK.test(i); });
  const mapa = {};
  if (!lista.length) return mapa;
  const rows = await chamar('/Produtos?select=*&id=in.(' + lista.join(',') + ')', 'GET');
  (rows || []).forEach(function (p) { mapa[String(p.id)] = p; });
  return mapa;
}

function hojeBR() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().substring(0, 10); }

function normalizarCupom(c) { return String(c == null ? '' : c).trim().toUpperCase(); }

function precoProduto(p) {
  const v = Number(p && p['Preço']);
  return isFinite(v) && v > 0 ? v : 0;
}

function fotoProduto(p) { return (p && p.foto_url) || ''; }

function itensCombo(o) {
  let v = o && o.itens_combo;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = null; } }
  return Array.isArray(v) ? v.map(String).filter(function (i) { return ID_OK.test(i); }) : [];
}

// entrada: { items:[{id,qtd,voltagem,oferta}], cupom, forma:'pix'|'cartao'|'paypal'|null, frete }
async function calcularPedido(entrada) {
  const itensCliente = entrada && entrada.items;
  if (!Array.isArray(itensCliente) || itensCliente.length === 0) throw new Error('Carrinho vazio');
  if (itensCliente.length > 50) throw new Error('Carrinho com itens demais');

  const ofertas = await listarSeguro('/Ofertas?select=*&ativo=eq.true&order=ordem.asc,id.asc');
  const cfgRows = await listarSeguro('/Configuracoes?select=chave,valor');
  const cfg = {};
  cfgRows.forEach(function (r) { cfg[r.chave] = r.valor; });
  let pixPct = Number(cfg.pix_desconto_pct);
  if (!isFinite(pixPct)) pixPct = PIX_PCT_PADRAO;
  pixPct = Math.min(Math.max(pixPct, 0), 50);

  // ids que precisamos conhecer: carrinho + produtos citados nas ofertas
  const ids = [];
  itensCliente.forEach(function (i) {
    const id = String((i && i.id != null) ? i.id : '').trim();
    if (!ID_OK.test(id)) throw new Error('Item do carrinho sem id valido');
    ids.push(id);
  });
  ofertas.forEach(function (o) {
    if (o.produto_id) ids.push(String(o.produto_id));
    if (o.gatilho_id) ids.push(String(o.gatilho_id));
    itensCombo(o).forEach(function (i) { ids.push(i); });
  });
  const produtos = await carregarProdutos(ids);

  // ---- linhas do pedido (preco SEMPRE do banco) ----
  const linhas = [];
  const chaves = {};
  itensCliente.forEach(function (it) {
    const id = String(it.id).trim();
    const p = produtos[id];
    if (!p) throw new Error('Produto fora do catalogo: ' + id);

    let qtd = Math.floor(Number(it.qtd));
    if (!(qtd > 0) || qtd > QTD_MAXIMA) throw new Error('Quantidade invalida para o produto ' + id);

    const oferta = it.oferta != null ? ofertas.find(function (o) {
      return String(o.id) === String(it.oferta) && (o.tipo === 'order_bump' || o.tipo === 'upsell') && String(o.produto_id) === id;
    }) : null;

    if (!oferta && p.Ativo === false) throw new Error('Produto indisponivel: ' + id);

    const base = precoProduto(p);
    if (!(base > 0)) throw new Error('Preco invalido no cadastro do produto ' + id);

    let preco = base;
    let tipo = 'normal';
    if (oferta) {
      preco = r2(base * (1 - Math.min(Math.max(Number(oferta.desconto_pct) || 0, 0), 100) / 100));
      qtd = 1; // oferta de produto vale para 1 unidade
      tipo = oferta.tipo === 'upsell' ? 'upsell' : 'bump';
    }

    let voltagem = '';
    if (p.voltagem === '127V/220V') {
      const escolha = String((it && it.voltagem) || '').trim();
      if (escolha === '127V' || escolha === '220V') voltagem = escolha;
    } else if (p.voltagem) {
      voltagem = String(p.voltagem);
    }

    const chave = [id, voltagem, oferta ? oferta.id : ''].join('|');
    if (chaves[chave] !== undefined) {
      const l = linhas[chaves[chave]];
      l.qtd = Math.min(l.qtd + qtd, oferta ? 1 : QTD_MAXIMA);
      return;
    }
    chaves[chave] = linhas.length;
    const linha = { id: id, nome: String(p.Nome || 'Produto'), preco: preco, preco_original: base, qtd: qtd, foto: fotoProduto(p), tipo: tipo };
    if (voltagem) linha.voltagem = voltagem;
    if (oferta) linha.oferta_id = oferta.id;
    linhas.push(linha);
  });

  // ---- brindes (por quantidade de produtos no carrinho) ----
  const unidadesPagas = linhas.reduce(function (s, l) { return s + l.qtd; }, 0);
  const brindes = ofertas.filter(function (o) { return o.tipo === 'brinde' && o.produto_id && Number(o.qtd_minima) > 0; });
  const brindesGanhos = [];
  let brindeProgresso = null;
  brindes.forEach(function (o) {
    const p = produtos[String(o.produto_id)];
    if (!p) return;
    const minimo = Math.floor(Number(o.qtd_minima));
    if (unidadesPagas >= minimo) {
      const linha = { id: String(p.id), nome: String(p.Nome || 'Brinde'), preco: 0, preco_original: precoProduto(p), qtd: 1, foto: fotoProduto(p), tipo: 'brinde', oferta_id: o.id };
      linhas.push(linha);
      brindesGanhos.push({ oferta_id: o.id, nome: linha.nome });
    } else if (!brindeProgresso || minimo < brindeProgresso.minimo) {
      brindeProgresso = { oferta_id: o.id, minimo: minimo, faltam: minimo - unidadesPagas, nome: String(p.Nome || 'Brinde'), titulo: o.titulo || '' };
    }
  });

  // ---- combos (kit de produtos diferentes por preco fechado) ----
  const restante = {};
  const precoUnit = {};
  linhas.forEach(function (l) {
    if (l.tipo === 'brinde') return;
    restante[l.id] = (restante[l.id] || 0) + l.qtd;
    if (precoUnit[l.id] === undefined) precoUnit[l.id] = l.preco;
  });
  let descontoCombo = 0;
  const combosAplicados = [];
  const combos = ofertas.filter(function (o) { return o.tipo === 'combo'; });
  combos.forEach(function (o) {
    const lista = itensCombo(o);
    const fechado = Number(o.preco_fechado);
    if (lista.length < 2 || !(fechado > 0)) return;
    const vezes = Math.min.apply(null, lista.map(function (i) { return restante[i] || 0; }));
    if (vezes < 1) return;
    const soma = lista.reduce(function (s, i) { return s + (precoUnit[i] || 0); }, 0);
    const economia = r2(soma - fechado);
    if (economia <= 0) return;
    lista.forEach(function (i) { restante[i] -= vezes; });
    descontoCombo = r2(descontoCombo + economia * vezes);
    combosAplicados.push({ oferta_id: o.id, nome: String(o.nome || 'Combo'), vezes: vezes, economia: r2(economia * vezes) });
  });

  const subtotal = r2(linhas.reduce(function (s, l) { return s + l.preco * l.qtd; }, 0));
  const baseAposCombo = r2(Math.max(0, subtotal - descontoCombo));

  // ---- cupom ----
  const cupomDigitado = normalizarCupom(entrada.cupom);
  let cupom = null;
  let descontoCupom = 0;
  if (cupomDigitado) {
    cupom = { codigo: cupomDigitado, valido: false, erro: '', desconto: 0 };
    if (!CUPOM_OK.test(cupomDigitado)) {
      cupom.erro = 'Cupom invalido';
    } else {
      const achados = await listarSeguro('/Cupons?select=*&ativo=eq.true&codigo=eq.' + encodeURIComponent(cupomDigitado));
      const c = achados[0];
      if (!c) cupom.erro = 'Cupom invalido';
      else if (c.validade && hojeBR() > String(c.validade).substring(0, 10)) cupom.erro = 'Cupom expirado';
      else if (c.limite_usos != null && Number(c.usos) >= Number(c.limite_usos)) cupom.erro = 'Cupom esgotado';
      else if (Number(c.minimo) > 0 && baseAposCombo < Number(c.minimo)) cupom.erro = 'Pedido minimo de R$ ' + Number(c.minimo).toFixed(2).replace('.', ',') + ' para este cupom';
      else {
        const v = Number(c.valor) || 0;
        descontoCupom = c.tipo === 'valor' ? v : baseAposCombo * Math.min(v, 100) / 100;
        descontoCupom = r2(Math.min(Math.max(descontoCupom, 0), baseAposCombo));
        cupom.valido = true;
        cupom.desconto = descontoCupom;
        cupom.tipo = c.tipo;
        cupom.valor = Number(c.valor) || 0;
        cupom.descricao = c.descricao || '';
      }
    }
  }

  // ---- frete (validado/limitado como antes) ----
  const valorFrete = r2(Math.max(0, freteConfiavel(entrada.frete)));

  const aposCupom = r2(Math.max(0, baseAposCombo - descontoCupom));
  const descontoPix = r2(aposCupom * pixPct / 100);
  const totalSemPix = r2(aposCupom + valorFrete);
  const totalPix = r2(Math.max(0.01, aposCupom - descontoPix) + valorFrete);
  const forma = entrada.forma === 'pix' ? 'pix' : (entrada.forma || null);
  const total = forma === 'pix' ? totalPix : r2(Math.max(0.01, aposCupom) + valorFrete);

  // ---- sugestoes de oferta para a tela ----
  const noCarrinho = {};
  linhas.forEach(function (l) { if (l.tipo !== 'brinde') noCarrinho[l.id] = true; });
  const jaOferta = {};
  linhas.forEach(function (l) { if (l.oferta_id && l.tipo !== 'brinde') jaOferta[String(l.oferta_id)] = true; });

  function cartaoProduto(p, desc) {
    const base = precoProduto(p);
    return { id: String(p.id), nome: String(p.Nome || 'Produto'), foto: fotoProduto(p), preco: base, preco_oferta: r2(base * (1 - (desc || 0) / 100)) };
  }

  const sugestoes = { bump: [], upsell: [], combo: [] };
  ofertas.forEach(function (o) {
    if (o.tipo === 'order_bump' || o.tipo === 'upsell') {
      const p = produtos[String(o.produto_id)];
      if (!p) return;
      if (jaOferta[String(o.id)]) return;
      const gatilho = o.gatilho_id ? String(o.gatilho_id) : '';
      if (o.tipo === 'upsell' && (!gatilho || !noCarrinho[gatilho])) return;
      if (o.tipo === 'order_bump' && gatilho && !noCarrinho[gatilho]) return;
      if (o.tipo === 'order_bump' && noCarrinho[String(o.produto_id)]) return;
      if (!(precoProduto(p) > 0)) return;
      const item = {
        oferta_id: o.id, titulo: o.titulo || '', descricao: o.descricao || '', desconto_pct: Number(o.desconto_pct) || 0,
        produto: cartaoProduto(p, Number(o.desconto_pct) || 0)
      };
      if (o.tipo === 'upsell') {
        const de = produtos[gatilho];
        item.troca_de = gatilho;
        item.troca_de_nome = de ? String(de.Nome || '') : '';
        sugestoes.upsell.push(item);
      } else {
        sugestoes.bump.push(item);
      }
    } else if (o.tipo === 'combo') {
      const lista = itensCombo(o);
      const fechado = Number(o.preco_fechado);
      if (lista.length < 2 || !(fechado > 0)) return;
      const aplicado = combosAplicados.some(function (c) { return String(c.oferta_id) === String(o.id); });
      if (aplicado) return;
      const tem = lista.filter(function (i) { return noCarrinho[i]; });
      if (!tem.length) return;
      const faltam = lista.filter(function (i) { return !noCarrinho[i]; }).map(function (i) { return produtos[i]; }).filter(Boolean);
      if (!faltam.length) return;
      const soma = lista.reduce(function (s, i) { return s + precoProduto(produtos[i]); }, 0);
      sugestoes.combo.push({
        oferta_id: o.id, nome: String(o.nome || 'Combo'), titulo: o.titulo || '', descricao: o.descricao || '',
        preco_fechado: fechado, economia: r2(Math.max(0, soma - fechado)),
        faltam: faltam.map(function (p) { return cartaoProduto(p, 0); })
      });
    }
  });

  return {
    linhas: linhas,
    subtotal: subtotal,
    descontos: { combo: descontoCombo, cupom: descontoCupom, pix: forma === 'pix' ? descontoPix : 0 },
    combos_aplicados: combosAplicados,
    cupom: cupom,
    frete: valorFrete,
    pix_pct: pixPct,
    desconto_pix_estimado: descontoPix,
    total: total,
    total_pix: totalPix,
    total_sem_pix: totalSemPix,
    brinde: { ganhos: brindesGanhos, progresso: brindeProgresso, unidades: unidadesPagas },
    sugestoes: sugestoes
  };
}

// Incrementa o uso do cupom (melhor esforco: nunca bloqueia o pagamento).
async function registrarUsoCupom(codigo) {
  const c = normalizarCupom(codigo);
  if (!CUPOM_OK.test(c)) return;
  try { await chamar('/rpc/usar_cupom', 'POST', { p_codigo: c }); } catch (e) { /* ignora */ }
}

// Texto curto para o campo "observacoes" do pedido (aparece no admin).
function resumoDescontos(r) {
  const partes = [];
  if (r.descontos.combo > 0) partes.push('Combo -R$ ' + r.descontos.combo.toFixed(2));
  if (r.cupom && r.cupom.valido) partes.push('Cupom ' + r.cupom.codigo + ' -R$ ' + r.descontos.cupom.toFixed(2));
  if (r.descontos.pix > 0) partes.push('Pix ' + r.pix_pct + '% -R$ ' + r.descontos.pix.toFixed(2));
  const brindes = r.linhas.filter(function (l) { return l.tipo === 'brinde'; }).map(function (l) { return l.nome; });
  if (brindes.length) partes.push('Brinde: ' + brindes.join(', '));
  return partes.join(' | ');
}

module.exports = { calcularPedido: calcularPedido, registrarUsoCupom: registrarUsoCupom, resumoDescontos: resumoDescontos, r2: r2 };
