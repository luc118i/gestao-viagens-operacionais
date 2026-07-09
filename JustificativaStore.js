// ============================================================
//  JustificativaStore.gs  —  Persistência das justificativas de alertas
//  Responsabilidade: guardar/recuperar as justificativas MANUAIS que o
//  usuário aplica aos alertas operacionais. A viagem não tem ID (vem de um
//  CSV), então as justificativas são chaveadas por hash do conteúdo da
//  viagem + alertKey (tipo|trecho[|seq] atribuído pelo AnalysisService).
//  As justificativas AUTOMÁTICAS (contexto urbano/garagem/terminal) NÃO são
//  persistidas — o AnalysisService as recalcula deterministicamente.
//  Aba: JUSTIFICATIVAS_ALERTAS
//    [hash, alert_key, categoria, motivo, observacao, status, justificado_em]
// ============================================================

var JustificativaStore = (() => {

  const SHEET  = 'JUSTIFICATIVAS_ALERTAS';
  const HEADER = ['hash', 'alert_key', 'categoria', 'motivo', 'observacao', 'status', 'justificado_em'];

  /**
   * Retorna (criando se preciso) a aba, com cabeçalho congelado.
   * Mesmo padrão de DiagnosticoStore._getSheet.
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
   * Hash MD5 do conteúdo da viagem. Independente do esquema e da versão de
   * lógica do diagnóstico — assim as justificativas sobrevivem a mudanças de
   * fórmula. Só muda se os pontos/horários realizados mudarem.
   * @param {{enrichedTrip:Array}} payload
   * @returns {string}
   */
  function computeHash(payload) {
    const trip = (payload && payload.enrichedTrip) || [];
    const parts = ['just-v1'];
    trip.forEach(function (p) {
      parts.push([p.ponto, p.codigo, p.entrada, p.saida, p.parada_s].join('|'));
    });
    const bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.MD5, parts.join('\n'), Utilities.Charset.UTF_8
    );
    return bytes.map(function (b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    }).join('');
  }

  /**
   * Retorna todas as justificativas manuais salvas para uma viagem, como
   * mapa { alertKey: {categoria, motivo, observacao, status, justificado_em} }.
   * @param {string} hash
   * @returns {Object}
   */
  function getForTrip(hash) {
    const sheet = _getSheet(false);
    const out = {};
    if (!sheet) return out;
    const last = sheet.getLastRow();
    if (last < 2) return out;
    const data = sheet.getRange(2, 1, last - 1, HEADER.length).getValues();
    const alvo = String(hash).trim();
    data.forEach(function (row) {
      if (String(row[0]).trim() !== alvo) return;
      const key = String(row[1]).trim();
      if (!key) return;
      out[key] = {
        categoria:      String(row[2] || ''),
        motivo:         String(row[3] || ''),
        observacao:     String(row[4] || ''),
        status:         String(row[5] || 'justificado'),
        justificado_em: String(row[6] || '')
      };
    });
    return out;
  }

  /**
   * Salva (ou substitui) a justificativa de um alerta.
   * status 'justificado' = justificativa manual do usuário.
   * status 'reaberto'    = override que anula uma auto-justificativa (contexto
   *                        urbano) — o usuário discorda e quer o alerta de volta.
   * @param {string} hash
   * @param {string} alertKey
   * @param {{categoria:string, motivo:string, observacao:string, status?:string}} just
   * @returns {Object} a justificativa salva
   */
  function save(hash, alertKey, just) {
    const sheet = _getSheet(true);
    _deleteRow(sheet, hash, alertKey);
    const registro = {
      categoria:      (just && just.categoria) || 'Outro',
      motivo:         (just && just.motivo) || '',
      observacao:     (just && just.observacao) || '',
      status:         (just && just.status) || 'justificado',
      justificado_em: new Date().toISOString()
    };
    sheet.appendRow([
      hash, alertKey,
      registro.categoria, registro.motivo, registro.observacao,
      registro.status, registro.justificado_em
    ]);
    return registro;
  }

  /**
   * Remove a justificativa manual de um alerta (reabre o alerta).
   * @param {string} hash
   * @param {string} alertKey
   */
  function remove(hash, alertKey) {
    const sheet = _getSheet(false);
    if (!sheet) return;
    _deleteRow(sheet, hash, alertKey);
  }

  /** Remove todas as linhas que casam hash+alertKey (evita duplicatas). */
  function _deleteRow(sheet, hash, alertKey) {
    const last = sheet.getLastRow();
    if (last < 2) return;
    const rows = sheet.getRange(2, 1, last - 1, 2).getValues();
    const h = String(hash).trim();
    const k = String(alertKey).trim();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][0]).trim() === h && String(rows[i][1]).trim() === k) {
        sheet.deleteRow(i + 2);
      }
    }
  }

  return {
    computeHash: computeHash,
    getForTrip:  getForTrip,
    save:        save,
    remove:      remove
  };

})();
