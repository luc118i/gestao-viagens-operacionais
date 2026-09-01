// ============================================================
//  QuestionamentoStore.gs  —  Persistência dos questionamentos ao motorista
//  Responsabilidade: guardar o histórico de perguntas que o monitor envia ao
//  motorista sobre eventos/alertas de um trecho, e as respostas registradas
//  manualmente depois (o motorista responde no chat do WhatsApp; o rizer-agent
//  só ENVIA, não recebe).
//
//  A viagem não tem ID (vem de um CSV), então cada linha é chaveada pelo hash
//  do conteúdo da viagem — o MESMO de JustificativaStore.computeHash, para que
//  o histórico reapareça ao reabrir o mesmo relatório. O `alert_key` amarra o
//  questionamento ao alerta operacional (contrato tipo|trecho[|seq]); fica
//  vazio quando é um questionamento avulso ("Outro assunto").
//
//  Histórico append-only: nunca reescreve uma linha inteira. `update` só toca
//  as colunas de um patch (envio / resposta / status).
//
//  Aba: QUESTIONAMENTOS_MOTORISTA
//    [id, hash, alert_key, evento_tipo, evento_label, trecho, linha, horario,
//     motorista_matricula, motorista_nome, veiculo, telefone, mensagem,
//     enviado_em, envio_status, envio_erro, resposta, respondido_em, status,
//     monitor, criado_em]
// ============================================================

var QuestionamentoStore = (() => {

  const SHEET  = 'QUESTIONAMENTOS_MOTORISTA';
  const HEADER = [
    'id', 'hash', 'alert_key', 'evento_tipo', 'evento_label', 'trecho',
    'linha', 'horario', 'motorista_matricula', 'motorista_nome', 'veiculo',
    'telefone', 'mensagem', 'enviado_em', 'envio_status', 'envio_erro',
    'resposta', 'respondido_em', 'status', 'monitor', 'criado_em'
  ];

  // status do ciclo de resposta (enum do spec)
  const ST_AGUARDANDO = 'Aguardando resposta';
  const ST_RESPONDIDO = 'Respondido';
  const ST_SEM        = 'Sem resposta';

  /** Retorna (criando se preciso) a aba, com cabeçalho congelado. */
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
   * Hash do conteúdo da viagem — delega para JustificativaStore para garantir
   * que as chaves batam entre as duas abas (mesmo CSV → mesmo hash).
   * @param {{enrichedTrip:Array}} payload
   * @returns {string}
   */
  function computeHash(payload) {
    return JustificativaStore.computeHash(payload);
  }

  /** Converte uma linha da planilha em objeto usando HEADER. */
  function _rowToObj(row) {
    const o = {};
    HEADER.forEach(function (h, i) { o[h] = row[i] == null ? '' : String(row[i]); });
    return o;
  }

  /**
   * Todos os questionamentos de uma viagem (por hash), mais antigos primeiro.
   * @param {string} hash
   * @returns {Array<Object>}
   */
  function listForTrip(hash) {
    const sheet = _getSheet(false);
    if (!sheet) return [];
    const last = sheet.getLastRow();
    if (last < 2) return [];
    const data = sheet.getRange(2, 1, last - 1, HEADER.length).getValues();
    const alvo = String(hash).trim();
    const out = [];
    data.forEach(function (row) {
      if (String(row[1]).trim() === alvo) out.push(_rowToObj(row));
    });
    out.sort(function (a, b) { return String(a.criado_em).localeCompare(String(b.criado_em)); });
    return out;
  }

  /**
   * Insere um novo questionamento. Gera `id` e `criado_em`; status inicial
   * "Aguardando resposta" e envio_status "pendente" (a menos que o chamador
   * passe outro).
   * @param {Object} reg  campos parciais (hash, alert_key, evento_tipo, ...)
   * @returns {Object} o registro salvo (com id/criado_em)
   */
  function insert(reg) {
    const sheet = _getSheet(true);
    reg = reg || {};
    const registro = {
      id:                  Utilities.getUuid(),
      hash:                String(reg.hash || ''),
      alert_key:           String(reg.alert_key || ''),
      evento_tipo:         String(reg.evento_tipo || ''),
      evento_label:        String(reg.evento_label || ''),
      trecho:              String(reg.trecho || ''),
      linha:               String(reg.linha || ''),
      horario:             String(reg.horario || ''),
      motorista_matricula: String(reg.motorista_matricula || ''),
      motorista_nome:      String(reg.motorista_nome || ''),
      veiculo:             String(reg.veiculo || ''),
      telefone:            String(reg.telefone || ''),
      mensagem:            String(reg.mensagem || ''),
      enviado_em:          String(reg.enviado_em || ''),
      envio_status:        String(reg.envio_status || 'pendente'),
      envio_erro:          String(reg.envio_erro || ''),
      resposta:            String(reg.resposta || ''),
      respondido_em:       String(reg.respondido_em || ''),
      status:              String(reg.status || ST_AGUARDANDO),
      monitor:             String(reg.monitor || ''),
      criado_em:           new Date().toISOString()
    };
    sheet.appendRow(HEADER.map(function (h) { return registro[h]; }));
    return registro;
  }

  /**
   * Atualiza só as colunas do patch numa linha existente (por id).
   * @param {string} id
   * @param {Object} patch  ex.: { resposta, respondido_em, status }
   * @returns {Object|null} o registro atualizado, ou null se o id não existir
   */
  function update(id, patch) {
    const sheet = _getSheet(false);
    if (!sheet) return null;
    const last = sheet.getLastRow();
    if (last < 2) return null;
    const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    const alvo = String(id).trim();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() !== alvo) continue;
      const rowNum = i + 2;
      const range = sheet.getRange(rowNum, 1, 1, HEADER.length);
      const row = range.getValues()[0];
      HEADER.forEach(function (h, c) {
        if (patch && Object.prototype.hasOwnProperty.call(patch, h)) {
          row[c] = patch[h] == null ? '' : patch[h];
        }
      });
      range.setValues([row]);
      return _rowToObj(row);
    }
    return null;
  }

  return {
    STATUS: { AGUARDANDO: ST_AGUARDANDO, RESPONDIDO: ST_RESPONDIDO, SEM_RESPOSTA: ST_SEM },
    computeHash: computeHash,
    listForTrip: listForTrip,
    insert:      insert,
    update:      update
  };

})();
