// ============================================================
//  EsquemasService.gs  —  Leitura das abas ESQUEMAS e ESQUEMA_PONTOS
//  Responsabilidade: carregar esquemas operacionais e seus pontos,
//  com cache para evitar leituras repetidas da planilha
// ============================================================

var EsquemasService = (() => {

  var CACHE_KEY_ESQUEMAS = 'esquemas_ativos';
  var CACHE_TTL = 300; // 5 minutos

  // ============================================================
  //  FUNÇÕES PÚBLICAS
  // ============================================================

  /**
   * Retorna array de esquemas ativos da aba ESQUEMAS.
   * Usa CacheService (TTL 300s) para evitar leituras repetidas.
   * @returns {Array<{id_esquema: string, nome_linha: string, horario: string, sentido: string}>}
   */
  function getEsquemas() {
    try {
      var cache = CacheService.getScriptCache();
      var cached = cache.get(CACHE_KEY_ESQUEMAS);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      // Cache indisponível — segue sem cache
    }

    var esquemas = _lerEsquemas();

    try {
      var cache = CacheService.getScriptCache();
      cache.put(CACHE_KEY_ESQUEMAS, JSON.stringify(esquemas), CACHE_TTL);
    } catch (e) {
      // Falha ao gravar cache — não é crítico
    }

    return esquemas;
  }

  /**
   * Retorna os pontos de um esquema específico, ordenados por ORDEM.
   * Não usa cache (os pontos podem ser mais dinâmicos).
   * @param {string} idEsquema
   * @returns {Array<{id_esquema: string, ordem: number, id_ponto: string, nome_ponto: string}>}
   */
  function getPontosDoEsquema(idEsquema) {
    if (!idEsquema) return [];
    var todos = _lerEsquemaPontos();
    var idStr = String(idEsquema).trim();
    var filtrados = todos.filter(function(p) {
      return String(p.id_esquema).trim() === idStr;
    });
    filtrados.sort(function(a, b) {
      return Number(a.ordem) - Number(b.ordem);
    });
    return filtrados;
  }

  /**
   * Retorna um mapa { id_esquema: { partida:{nome,idPonto}, fim:{nome,idPonto} } }
   * para todos os esquemas, lendo a ESQUEMA_PONTOS uma única vez. Usado para
   * agrupar os esquemas por terminal de origem / encerramento na home.
   * Partida = primeiro ponto não-garagem; fim = último ponto não-garagem.
   * @returns {Object<string,{partida:Object, fim:Object}>}
   */
  function getTerminaisPorEsquema() {
    var todos = _lerEsquemaPontos();
    var byEsq = {};
    todos.forEach(function(p) {
      var id = String(p.id_esquema).trim();
      if (!id) return;
      (byEsq[id] = byEsq[id] || []).push(p);
    });
    var out = {};
    Object.keys(byEsq).forEach(function(id) {
      var pts  = byEsq[id].sort(function(a, b) { return Number(a.ordem) - Number(b.ordem); });
      var pIni = _partidaDoEsquema(pts);
      var pFim = _encerramentoDoEsquema(pts);
      out[id] = {
        partida: { nome: pIni ? String(pIni.nome_ponto || '') : '', idPonto: pIni ? String(pIni.id_ponto || '') : '' },
        fim:     { nome: pFim ? String(pFim.nome_ponto || '') : '', idPonto: pFim ? String(pFim.id_ponto || '') : '' }
      };
    });
    return out;
  }

  /** Primeiro ponto não-garagem/fechamento; senão, o primeiro. */
  function _partidaDoEsquema(pontosOrdenados) {
    for (var i = 0; i < pontosOrdenados.length; i++) {
      var nome = String(pontosOrdenados[i].nome_ponto || '');
      var tipo = String(pontosOrdenados[i].tipo || '');
      if (/garagem/i.test(nome) || /fechamento/i.test(tipo)) continue;
      return pontosOrdenados[i];
    }
    return pontosOrdenados.length ? pontosOrdenados[0] : null;
  }

  /** Último ponto não-garagem/fechamento; senão, o último. */
  function _encerramentoDoEsquema(pontosOrdenados) {
    for (var i = pontosOrdenados.length - 1; i >= 0; i--) {
      var nome = String(pontosOrdenados[i].nome_ponto || '');
      var tipo = String(pontosOrdenados[i].tipo || '');
      if (/garagem/i.test(nome) || /fechamento/i.test(tipo)) continue;
      return pontosOrdenados[i];
    }
    return pontosOrdenados.length ? pontosOrdenados[pontosOrdenados.length - 1] : null;
  }

  /**
   * Limpa o cache de esquemas para forçar releitura na próxima chamada.
   */
  function invalidateCache() {
    try {
      var cache = CacheService.getScriptCache();
      cache.remove(CACHE_KEY_ESQUEMAS);
    } catch (e) {
      // Silencioso
    }
  }

  // ============================================================
  //  LEITURA DAS ABAS
  // ============================================================

  /**
   * Lê a aba ESQUEMAS e retorna apenas os esquemas ativos.
   * Aceita variações de cabeçalho via _mapHeader().
   */
  function _lerEsquemas() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('ESQUEMAS');

    if (!sheet) {
      Logger.log('[EsquemasService] Aba "ESQUEMAS" não encontrada.');
      return [];
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var lastCol = sheet.getLastColumn();
    var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();

    var headerRow = data[0].map(function(h) { return _norm(String(h)); });
    var colMap = _mapHeader(headerRow, {
      id_esquema: ['id_esquema', 'id', 'codigo', 'cod_esquema', 'esquema'],
      nome_linha: ['nome_linha', 'nome', 'linha', 'descricao'],
      horario:    ['horario', 'hora', 'hora_partida', 'horario_partida', 'time'],
      sentido:    ['sentido', 'direcao', 'direction', 'destino', 'tipo_viagem', 'tipo', 'volta_ida', 'ida_volta', 'sentido_linha'],
      tipo_via:   ['tipo_via', 'tipovia', 'tipo_de_via', 'via_padrao', 'via']
    });

    var esquemas = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var idEsquema = _getCell(row, colMap.id_esquema);
      var nomeLinha = _getCell(row, colMap.nome_linha);
      var horario   = colMap.horario !== undefined ? _formatHorario(row[colMap.horario]) : '';
      var sentido   = _getCell(row, colMap.sentido);
      var tipoVia   = _getCell(row, colMap.tipo_via);

      // Fallback: extrai IDA/VOLTA do nome_linha quando coluna sentido está vazia
      if (!sentido && nomeLinha) {
        var m = nomeLinha.match(/\b(IDA|VOLTA|RETORNO|SUBIDA|DESCIDA)\b/i);
        if (m) sentido = m[1].toUpperCase();
      }

      if (!idEsquema) continue;

      esquemas.push({
        id_esquema: idEsquema,
        nome_linha: nomeLinha,
        horario:    horario,
        sentido:    sentido,
        tipo_via:   tipoVia
      });
    }

    return esquemas;
  }

  /**
   * Lê a aba ESQUEMA_PONTOS e retorna todos os registros.
   * Aceita variações de cabeçalho via _mapHeader().
   */
  function _lerEsquemaPontos() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('ESQUEMA_PONTOS');

    if (!sheet) {
      Logger.log('[EsquemasService] Aba "ESQUEMA_PONTOS" não encontrada.');
      return [];
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var lastCol = sheet.getLastColumn();
    var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();

    var headerRow = data[0].map(function(h) { return _norm(String(h)); });
    var colMap = _mapHeader(headerRow, {
      id_esquema:        ['id_esquema', 'id', 'esquema', 'cod_esquema', 'codigo_esquema'],
      ordem:             ['ordem', 'order', 'sequencia', 'seq'],
      id_ponto:          ['id_ponto', 'ponto', 'codigo_ponto', 'cod_ponto', 'codigo'],
      nome_ponto:        ['nome_ponto', 'nome', 'descricao', 'ponto_nome'],
      tipo:              ['tipo', 'type', 'tipo_parada', 'tipo_ponto'],
      horario_comercial: ['horario_comercial', 'comercial', 'hor_comercial'],
      tempo_local:       ['tempo_local', 'parada', 'tempo_parada', 'stop_time'],
      tipo_trecho:       ['tipo_trecho', 'via', 'tipo_via', 'trecho']
    });

    var pontos = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var idEsquema = _getCell(row, colMap.id_esquema);
      var ordem     = _getCell(row, colMap.ordem);
      var idPonto   = _getCell(row, colMap.id_ponto);
      var nomePonto = _getCell(row, colMap.nome_ponto);
      var tipo      = _getCell(row, colMap.tipo);

      if (!idEsquema || !idPonto) continue;

      pontos.push({
        id_esquema:        idEsquema,
        ordem:             isNaN(Number(ordem)) ? 0 : Number(ordem),
        id_ponto:          idPonto,
        nome_ponto:        nomePonto || idPonto,
        tipo:              tipo,
        horario_comercial: colMap.horario_comercial !== undefined ? _formatHorario(row[colMap.horario_comercial]) : '',
        tempo_local:       colMap.tempo_local  !== undefined ? (_getCell(row, colMap.tempo_local)  || '') : '',
        tipo_trecho:       colMap.tipo_trecho  !== undefined ? (_getCell(row, colMap.tipo_trecho)  || '') : ''
      });
    }

    return pontos;
  }

  // ============================================================
  //  HELPERS PRIVADOS
  // ============================================================

  /**
   * Mapeia cabeçalhos normalizados para índices de coluna.
   * Aceita variações via aliases.
   * @param {string[]} headerArr  — cabeçalhos normalizados
   * @param {Object}   aliases    — { campo: [alias1, alias2, ...] }
   * @returns {Object}  { campo: índice | undefined }
   */
  function _mapHeader(headerArr, aliases) {
    var result = {};
    Object.keys(aliases).forEach(function(campo) {
      var variantes = aliases[campo];
      for (var j = 0; j < variantes.length; j++) {
        var idx = headerArr.indexOf(variantes[j]);
        if (idx !== -1) {
          result[campo] = idx;
          break;
        }
      }
    });
    return result;
  }

  /**
   * Retorna o valor de uma célula pelo índice (ou '' se undefined).
   */
  function _getCell(row, idx) {
    if (idx === undefined || idx === null) return '';
    var val = row[idx];
    if (val === null || val === undefined) return '';
    return String(val).trim();
  }

  /**
   * Formata um valor de célula de horário.
   * Google Sheets retorna Date para células formatadas como Hora.
   * Usa o fuso da planilha (não do script) para evitar defasagem de horário.
   */
  function _formatHorario(val) {
    if (!val && val !== 0) return '';
    if (val instanceof Date) {
      var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
      return Utilities.formatDate(val, tz, 'HH:mm');
    }
    // Texto "HH:MM" ou "HH:MM:SS" — extrai só HH:MM
    var s = String(val).trim();
    var m = s.match(/^(\d{1,2}):(\d{2})/);
    return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : s;
  }

  /**
   * Normaliza string: lowercase, sem acentos, sem espaços duplos.
   */
  function _norm(str) {
    if (!str) return '';
    return str.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '_');
  }

  return {
    getEsquemas:            getEsquemas,
    getPontosDoEsquema:     getPontosDoEsquema,
    getTerminaisPorEsquema: getTerminaisPorEsquema,
    invalidateCache:        invalidateCache
  };

})();
