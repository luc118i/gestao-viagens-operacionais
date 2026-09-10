// ============================================================
//  SiglasService.gs  —  Siglas de pontos/cidades para encorpar a
//  mensagem de cobrança do iButton (trecho "BSB → GYN" no lugar do
//  nome cru do CSV).
//
//  Fonte: aba "Siglas" da planilha "Levantamento IButton"
//  (colunas: A = CIDADE / nome do ponto, B = Sigla). A aba mistura
//  siglas de cidade (BRASILIA - DF → BSB) e de ponto específico
//  (GARAGEM DE GUARULHOS - SP → GGUA).
//
//  Config (Propriedade do script, opcional): SIGLAS_SHEET_ID —
//  ID da planilha. Sem a propriedade, usa a constante abaixo.
//  Só leitura; precisa do escopo .../auth/spreadsheets (já no manifest)
//  e que a conta que roda o Web App tenha acesso à planilha.
// ============================================================

var SiglasService = (() => {

  var DEFAULT_SHEET_ID = '18pBsGLjX5QHwJ_wWEg3Ee-R-DsTCU9UX4RO7XnyCPug';
  var SHEET_NAME = 'Siglas';
  var CACHE_KEY = 'siglas_mapa_v1';
  var CACHE_TTL = 1800; // 30 min

  function _sheetId() {
    try {
      var v = (PropertiesService.getScriptProperties().getProperty('SIGLAS_SHEET_ID') || '').trim();
      return v || DEFAULT_SHEET_ID;
    } catch (e) { return DEFAULT_SHEET_ID; }
  }

  /** Normaliza nome de local: maiúsculo, sem acento, só [A-Z0-9 ], espaços colapsados. */
  function _norm(s) {
    return String(s == null ? '' : s).trim().toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Z0-9]+/g, ' ').trim();
  }

  /**
   * Mapa { nomeNormalizado: 'SIGLA' } lido da aba Siglas (com cache).
   * Além do nome inteiro, indexa também a parte antes de " / " e a
   * parte "CIDADE UF" — a aba tem linhas como
   * "ORLANDIA - SP / Kambui Restaurante,RKAM".
   * @returns {Object<string,string>}
   */
  function mapa() {
    try {
      var cached = CacheService.getScriptCache().get(CACHE_KEY);
      if (cached) return JSON.parse(cached);
    } catch (e) {}

    var out = {};
    try {
      var sh = SpreadsheetApp.openById(_sheetId()).getSheetByName(SHEET_NAME);
      if (sh) {
        var last = sh.getLastRow();
        if (last >= 2) {
          var vals = sh.getRange(2, 1, last - 1, 2).getValues();
          vals.forEach(function (row) {
            var nome  = String(row[0] || '').trim();
            var sigla = String(row[1] || '').trim().toUpperCase();
            if (!nome || !sigla) return;
            var chaves = [_norm(nome)];
            if (nome.indexOf('/') !== -1) {
              nome.split('/').forEach(function (p) { chaves.push(_norm(p)); });
            }
            chaves.forEach(function (k) {
              if (k && !out[k]) out[k] = sigla; // 1ª ocorrência vence
            });
          });
        }
      }
    } catch (e) {
      Logger.log('[SiglasService.mapa] ' + (e.message || e));
    }

    try {
      CacheService.getScriptCache().put(CACHE_KEY, JSON.stringify(out), CACHE_TTL);
    } catch (e) {}
    return out;
  }

  /** Limpa o cache do mapa (usar se a aba Siglas for editada). */
  function invalidate() {
    try { CacheService.getScriptCache().remove(CACHE_KEY); } catch (e) {}
  }

  /**
   * Resolve um nome de ponto do CSV para a sigla. Tenta:
   *  1. match exato do nome normalizado;
   *  2. match exato de "CIDADE - UF" achado dentro do nome;
   *  3. maior sigla cujo nome-chave está contido no nome (ou vice-versa).
   * @param {string} nome
   * @param {Object} m  mapa() (passado para não reler a cada ponto)
   * @returns {string} sigla ou ''
   */
  function siglaDe(nome, m) {
    m = m || mapa();
    var n = _norm(nome);
    if (!n) return '';
    if (m[n]) return m[n];

    var chaves = Object.keys(m);

    // 1) Match por SUFIXO — o nome de ponto quase sempre termina em
    //    "... CIDADE - UF", igual a chave indexada na aba Siglas. Muito mais
    //    confiável que substring em qualquer posição (evita casar um pedaço
    //    do meio do nome com uma cidade errada — ex.: "RODOVIARIA RECIFE PE"
    //    tem que bater com "RECIFE PE", não com algo curto no meio).
    var bestSuf = '', bestSufLen = 0;
    chaves.forEach(function (k) {
      if (k.length < 4) return;
      var suf = (n === k) || (n.length > k.length && n.slice(-k.length) === k && n.charAt(n.length - k.length - 1) === ' ');
      if (suf && k.length > bestSufLen) { bestSufLen = k.length; bestSuf = m[k]; }
    });
    if (bestSuf) return bestSuf;

    // 2) Fallback: substring em qualquer posição ("REST CHURRASC PARAIBAO - PIRAPORA MG").
    var best = '', bestLen = 0;
    for (var i = 0; i < chaves.length; i++) {
      var k = chaves[i];
      if (k.length < 4) continue;
      if (n.indexOf(k) !== -1 || k.indexOf(n) !== -1) {
        if (k.length > bestLen) { bestLen = k.length; best = m[k]; }
      }
    }
    return best;
  }

  /**
   * Trecho (pontoInicio → pontoFim) em formato de sigla.
   * @param {{pontoInicio:string, pontoFim:string}} p
   * @returns {{ ok:boolean, sigla:string, siglaInicio:string, siglaFim:string }}
   */
  function trechoEmSigla(p) {
    p = p || {};
    var m = mapa();
    var si = siglaDe(p.pontoInicio, m);
    var sf = siglaDe(p.pontoFim, m);
    var sig = (si && sf) ? (si + ' → ' + sf) : (si || sf);
    return { ok: !!(si || sf), sigla: sig, siglaInicio: si, siglaFim: sf };
  }

  return {
    mapa: mapa,
    invalidate: invalidate,
    siglaDe: siglaDe,
    trechoEmSigla: trechoEmSigla
  };

})();
