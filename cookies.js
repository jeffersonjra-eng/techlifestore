// Aviso de cookies (LGPD) + Google Consent Mode v2 + Meta Pixel consent.
// Carregado no topo do <head> de todas as paginas, ANTES das tags de rastreamento.
// Enquanto o visitante nao aceitar, Google Analytics/Ads e Meta Pixel ficam sem
// gravar cookies. A escolha fica salva no navegador (localStorage).
(function () {
  var CHAVE = 'tl_cookie_consent';
  var estado = null;
  try { estado = localStorage.getItem(CHAVE); } catch (e) {}

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  var NEGADO = { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
  var ACEITO = { ad_storage: 'granted', analytics_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' };

  gtag('consent', 'default', estado === 'aceito' ? ACEITO : NEGADO);
  window.tlConsentimento = estado;

  function salvar(valor) {
    try { localStorage.setItem(CHAVE, valor); } catch (e) {}
    window.tlConsentimento = valor;
    gtag('consent', 'update', valor === 'aceito' ? ACEITO : NEGADO);
    if (window.fbq) { window.fbq('consent', valor === 'aceito' ? 'grant' : 'revoke'); }
  }

  var barra = null;

  function esconderBarra() { if (barra) { barra.style.display = 'none'; } }

  function criarBarra() {
    barra = document.createElement('div');
    barra.setAttribute('role', 'dialog');
    barra.setAttribute('aria-label', 'Aviso de cookies');
    barra.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:760px;margin:0 auto;background:#0d1f1b;color:#fff;border-radius:14px;padding:16px 18px;box-shadow:0 8px 30px rgba(0,0,0,.35);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between';
    var txt = document.createElement('div');
    txt.style.cssText = 'flex:1 1 320px;min-width:0';
    txt.innerHTML = 'Usamos cookies e tecnologias semelhantes para medir o tr\u00e1fego do site e personalizar an\u00fancios. Voc\u00ea pode aceitar ou recusar. Saiba mais na <a href="/privacidade" style="color:#1abc9c;text-decoration:underline">Pol\u00edtica de privacidade</a>.';
    var acoes = document.createElement('div');
    acoes.style.cssText = 'display:flex;gap:8px;flex:0 0 auto';
    var recusar = document.createElement('button');
    recusar.type = 'button';
    recusar.textContent = 'Recusar';
    recusar.style.cssText = 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:10px;padding:10px 18px;font:600 14px system-ui,sans-serif;cursor:pointer';
    var aceitar = document.createElement('button');
    aceitar.type = 'button';
    aceitar.textContent = 'Aceitar';
    aceitar.style.cssText = 'background:#16a085;color:#fff;border:0;border-radius:10px;padding:10px 22px;font:600 14px system-ui,sans-serif;cursor:pointer';
    recusar.onclick = function () { salvar('recusado'); esconderBarra(); };
    aceitar.onclick = function () { salvar('aceito'); esconderBarra(); };
    acoes.appendChild(recusar);
    acoes.appendChild(aceitar);
    barra.appendChild(txt);
    barra.appendChild(acoes);
    document.body.appendChild(barra);
  }

  function iniciar() {
    criarBarra();
    if (estado === 'aceito' || estado === 'recusado') { esconderBarra(); }
  }

  // Permite reabrir o aviso (link na Politica de privacidade) para mudar a escolha.
  window.tlAbrirCookies = function () { if (barra) { barra.style.display = 'flex'; } };

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', iniciar); }
  else { iniciar(); }
})();
