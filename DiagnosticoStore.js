// ============================================================
//  DiagnosticoStore.gs  —  Persistência + cache do Diagnóstico Inteligente
//  Responsabilidade: guardar e recuperar a análise de IA por hash do
//  conteúdo do relatório (a viagem não tem ID — vem de um CSV enviado).
//  A análise só é recalculada quando o hash muda.
//  Aba: ANALISE_IA  [hash, id_esquema, nome_linha, gerado_em, modelo, json]
// ============================================================

var DiagnosticoStore = (() => {

  const SHEET  = 'ANALISE_IA';
  const HEADER = ['hash', 'id_esquema', 'nome_linha', 'gerado_em', 'modelo', 'json'];

  // Versão da LÓGICA do diagnóstico. Entra no hash: ao mudar, todos os cálculos
  // anteriores são invalidados e reprocessados (evita servir análise antiga do
  // cache após uma correção de fórmula). Incremente ao alterar _buildContext/cards.
  const LOGIC_VERSION = 4;

  /**
   * Retorna (criando se preciso) a aba de análises, com cabeçalho congelado.
   * Mesmo padrão de _getRotasSheet_ / DISTANCIAS no Code.gs.
   * @param {boolean} criar
   * @returns {GoogleAppsScript.Spreadsheet.Sheet|null}
   */
  function _getSheet(criar) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET);
    if (!sheet && criar) {
      sheet = ss.insertSheet(SHEET);
      sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  /**
   * Calcula o hash MD5 do que define o relatório. Só entram os campos que,
   * ao mudar, exigem novo diagnóstico: por ponto realizado
   * (ponto|codigo|entrada|saida|parada_s) e por ponto do esquema
   * (id_ponto|horario_comercial). Reordenar o CSV não muda o hash porque
   * o enrichedTrip já vem cronologicamente ordenado do AnalysisService.
   * @param {{enrichedTrip:Array, esquemaPontos:Array}} payload
   * @returns {string} hash hexadecimal
   */
  function computeHash(payload) {
    const trip = (payload && payload.enrichedTrip)  || [];
    const esq  = (payload && payload.esquemaPontos) || [];
    const parts = ['v' + LOGIC_VERSION];
    trip.forEach(function (p) {
      parts.push([p.ponto, p.codigo, p.entrada, p.saida, p.parada_s].join('|'));
    });
    parts.push('##ESQ##');
    esq.forEach(function (ep) {
      parts.push([ep.id_ponto, ep.horario_comercial].join('|'));
    });
    const canonical = parts.join('\n');
    const bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.MD5, canonical, Utilities.Charset.UTF_8
    );
    return bytes.map(function (b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    }).join('');
  }

  /**
   * Recupera a análise salva para um hash, ou null se não existir.
   * @param {string} hash
   * @returns {Object|null}
   */
  function get(hash) {
    const sheet = _getSheet(false);
    if (!sheet) return null;
    const last = sheet.getLastRow();
    if (last < 2) return null;
    const data = sheet.getRange(2, 1, last - 1, HEADER.length).getValues();
    const alvo = String(hash).trim();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === alvo) {
        try { return JSON.parse(data[i][5]); }
        catch (e) { return null; }
      }
    }
    return null;
  }

  /**
   * Salva (ou substitui) a análise de um hash. Remove linha anterior com o
   * mesmo hash para não duplicar.
   * @param {string} hash
   * @param {{idEsquema?:string, nomeLinha?:string, modelo?:string}} meta
   * @param {Object} obj  — diagnóstico completo
   */
  function save(hash, meta, obj) {
    const sheet = _getSheet(true);
    const alvo = String(hash).trim();
    const last = sheet.getLastRow();
    if (last >= 2) {
      const col = sheet.getRange(2, 1, last - 1, 1).getValues();
      for (let i = col.length - 1; i >= 0; i--) {
        if (String(col[i][0]).trim() === alvo) sheet.deleteRow(i + 2);
      }
    }
    sheet.appendRow([
      hash,
      (meta && meta.idEsquema) || '',
      (meta && meta.nomeLinha) || '',
      new Date().toISOString(),
      (meta && meta.modelo) || '',
      JSON.stringify(obj)
    ]);
  }

  return { computeHash: computeHash, get: get, save: save };

})();
