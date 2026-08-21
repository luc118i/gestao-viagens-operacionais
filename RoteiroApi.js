// ============================================================
//  RoteiroApi.gs — Endpoints JSON read-only para o app de
//  consulta (card "Roteiro Operacional" da Catedral).
//
//  Consumido via doGet:
//    ?action=getLinhas               → lista de esquemas com pontos
//    ?action=getRoteiro&id=<idEsq>   → pontos enriquecidos de um esquema
//    ?action=getMeta                 → só a data de última atualização (polling leve)
//
//  ADITIVO: reutiliza EsquemasService e SheetsService. NÃO altera o
//  action=getSchema (que devolve HTML) nem a UI existente.
//
//  Devolve DADOS crus/joinados (rodoviaria, tempoPermanencia, tipo);
//  as regras de APRESENTAÇÃO (rótulo do tipo, 30 min fixo p/ apoio,
//  formatação) ficam no front-end (roteiro.ts), onde vive o design.
// ============================================================

var RoteiroApi = (function () {

  /**
   * Lista os esquemas que possuem pontos cadastrados (para a busca/refino).
   * `pontosNomes` vem junto pra permitir buscar por local do roteiro (ex.:
   * "Montes Claros") mesmo quando a cidade não aparece no título da linha —
   * evita uma chamada getRoteiro por esquema só pra montar o índice de busca.
   * @returns {{ esquemas: Array<{id:number, nomeLinha:string, codLinha:?string, horario:string, sentido:string, pontosNomes:string[]}>, lastUpdated: string }}
   */
  function getLinhas() {
    var esquemas = EsquemasService.getEsquemas();
    var porEsquema = EsquemasService.getPontosTodosEsquemas(); // { id: [pontos] }
    var out = [];
    esquemas.forEach(function (e) {
      var id = String(e.id_esquema).trim();
      var pts = porEsquema[id];
      if (!pts || !pts.length) return; // só esquemas com roteiro
      out.push({
        id: Number(id),
        nomeLinha: e.nome_linha || '',
        codLinha: e.cod_linha ? String(e.cod_linha).trim() : null,
        horario: e.horario || '',
        sentido: _sentido(e.sentido, e.nome_linha),
        pontosNomes: pts.map(function (p) { return p.nome_ponto || ''; }).filter(Boolean),
      });
    });
    return { esquemas: out, lastUpdated: _lastUpdated() };
  }

  /**
   * Data/hora (ISO 8601) da última escrita real feita pelo Gestão de Esquemas
   * (ou por edição manual — ver onEdit em Code.gs), usada como "atualizado em"
   * no rodapé do card. Vem de EsquemasService.getLastUpdated() (PropertiesService)
   * — não usa DriveApp, então não depende da autorização sensível do Drive.
   */
  function _lastUpdated() {
    return EsquemasService.getLastUpdated();
  }

  /**
   * Roteiro de um esquema como JSON estruturado (não HTML).
   * @param {string|number} idEsquema
   */
  function getRoteiro(idEsquema) {
    var id = String(idEsquema == null ? '' : idEsquema).trim();
    if (!id) return { found: false };

    var esquemas = EsquemasService.getEsquemas();
    var esq = null;
    for (var i = 0; i < esquemas.length; i++) {
      if (String(esquemas[i].id_esquema).trim() === id) { esq = esquemas[i]; break; }
    }
    if (!esq) return { found: false };

    var pontos = EsquemasService.getPontosDoEsquema(id);
    if (!pontos || !pontos.length) return { found: false };

    var rodMap = _rodoviariaMap();                        // { codigo: boolean }
    var permMap = SheetsService.getTemposPermanencia();   // { codigo: minutos }

    var enriched = pontos.map(function (p) {
      var cod = String(p.id_ponto).trim();
      return {
        idEsquema: Number(id),
        ordem: Number(p.ordem) || 0,
        idPonto: Number(cod),
        nome: p.nome_ponto || '',
        tipo: _parseTipo(p.tipo),
        horarioComercial: p.horario_comercial || null,
        tempoLocal: _toIntOrNull(p.tempo_local),
        tipoTrecho: p.tipo_trecho || null,
        rodoviaria: Object.prototype.hasOwnProperty.call(rodMap, cod) ? rodMap[cod] : null,
        tempoPermanencia: (permMap[cod] != null) ? permMap[cod] : null,
        tiposParada: _tiposParada(p),
      };
    });

    return {
      found: true,
      esquema: {
        id: Number(id),
        nomeLinha: esq.nome_linha || '',
        codLinha: esq.cod_linha ? String(esq.cod_linha).trim() : null,
        horario: esq.horario || '',
        sentido: _sentido(esq.sentido, esq.nome_linha),
      },
      pontos: enriched,
    };
  }

  // ---------------------------------------------------------- helpers

  function _sentido(raw, nome) {
    var s = String(raw || '').trim().toUpperCase();
    if (/VOLTA/.test(s)) return 'Volta';
    if (/IDA/.test(s)) return 'Ida';
    var m = String(nome || '').toUpperCase().match(/\b(IDA|VOLTA)\b/);
    return (m && m[1] === 'VOLTA') ? 'Volta' : 'Ida';
  }

  /**
   * Tags de operação do ponto: Embarque/Desemb. é implícito (qualquer ponto
   * com horário comercial); Troca/Abastecimento/Alimentação/Limpeza vêm das
   * colunas booleanas marcadas manualmente no Gestão de Esquemas. null = sem
   * tag nenhuma (o front cai na heurística por nome).
   */
  function _tiposParada(p) {
    var tags = [];
    if (p.horario_comercial) tags.push('Embarque/Desemb.');
    if (p.troca_motorista) tags.push('Troca de Motorista');
    if (p.abastecimento) tags.push('Abastecimento');
    if (p.alimentacao) tags.push('Alimentação');
    if (p.limpeza) tags.push('Limpeza');
    return tags.length ? tags : null;
  }

  function _parseTipo(tipo) {
    var s = String(tipo || '').trim();
    var m = s.match(/^(.*?)\s*-\s*(\d+)\s*$/);
    if (m) return { label: m[1].trim(), codigo: Number(m[2]) };
    return { label: s, codigo: null };
  }

  function _toIntOrNull(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    var n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  }

  /**
   * Mapa { codigo: boolean } da coluna Rodoviária da aba LOCAIS, SEM filtrar por
   * coordenadas (getLocais() filtra lat/lng; aqui precisamos de todos os pontos).
   * Índices seguem o SheetsService: Código = col 1 (idx 0), Rodoviária = col 16 (idx 15).
   */
  function _rodoviariaMap() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('LOCAIS');
    if (!sheet) return {};
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};
    var data = sheet.getRange(2, 1, lastRow - 1, 16).getValues();
    var map = {};
    data.forEach(function (row) {
      var cod = String(row[0]).trim();
      if (!cod) return;
      var v = String(row[15] || '').trim().toUpperCase();
      map[cod] = (v === 'T' || v === 'S' || v === '1' || v === 'Y');
    });
    return map;
  }

  /**
   * Só a data de última atualização — usado pelo front pra checar
   * periodicamente se há dado novo, sem re-ler ESQUEMAS/ESQUEMA_PONTOS inteiros.
   * @returns {{ lastUpdated: string }}
   */
  function getMeta() {
    return { lastUpdated: _lastUpdated() };
  }

  return { getLinhas: getLinhas, getRoteiro: getRoteiro, getMeta: getMeta };
})();
