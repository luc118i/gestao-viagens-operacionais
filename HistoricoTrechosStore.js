// ============================================================
//  HistoricoTrechosStore.gs  —  Persistência do histórico de trechos
//  extraído de PDFs "Análise de Viagem" importados em massa.
//  Responsabilidade: guardar uma linha por trecho de cada PDF importado
//  (dedupe por nome de arquivo) e agregar o histórico por linha/trecho
//  para a view "Análise em Massa".
//  Aba: HISTORICO_TRECHOS  [arquivo_pdf, id_esquema, nome_linha, veiculo,
//       data_viagem, horario_viagem, trecho_de, trecho_para, vel_media,
//       vel_ideal, tempo_esperado_min, tempo_realizado_min, impacto_min,
//       criticidade, data_importacao]
// ============================================================

var HistoricoTrechosStore = (() => {

  const SHEET  = 'HISTORICO_TRECHOS';
  const HEADER = [
    'arquivo_pdf', 'id_esquema', 'nome_linha', 'veiculo',
    'data_viagem', 'horario_viagem', 'trecho_de', 'trecho_para',
    'vel_media', 'vel_ideal', 'tempo_esperado_min', 'tempo_realizado_min',
    'impacto_min', 'criticidade', 'data_importacao'
  ];

  // Índices de coluna (0-based) — evita números mágicos espalhados no código.
  const COL = {
    arquivo: 0, idEsquema: 1, nomeLinha: 2, veiculo: 3,
    dataViagem: 4, horarioViagem: 5, trechoDe: 6, trechoPara: 7,
    velMedia: 8, velIdeal: 9, tempoEsperadoMin: 10, tempoRealizadoMin: 11,
    impactoMin: 12, criticidade: 13, dataImportacao: 14
  };

  /**
   * Retorna (criando se preciso) a aba de histórico, com cabeçalho congelado.
   * Mesmo padrão de DiagnosticoStore._getSheet / _getRotasSheet_ no Code.gs.
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
   * Lê todas as linhas já gravadas (ou [] se a aba ainda não existe).
   * @returns {Array<Array>}
   */
  function _lerTudo() {
    const sheet = _getSheet(false);
    if (!sheet) return [];
    const last = sheet.getLastRow();
    if (last < 2) return [];
    return sheet.getRange(2, 1, last - 1, HEADER.length).getValues();
  }

  /**
   * Retorna o conjunto (Set) de nomes de arquivo PDF já importados, para o
   * front-end filtrar duplicados antes mesmo de tentar salvar.
   * @returns {Object}  — { nomeArquivo: true, ... }
   */
  function arquivosJaImportados() {
    const linhas = _lerTudo();
    const set = {};
    linhas.forEach(function (row) {
      const nome = String(row[COL.arquivo] || '').trim();
      if (nome) set[nome] = true;
    });
    return set;
  }

  /**
   * Remove definitivamente todas as linhas de um arquivo já importado —
   * usado antes de resalvar quando o usuário escolhe "Substituir" um CSV
   * já importado (ex: CSV anterior estava poluído/incompleto).
   *
   * @param {string} nomeArquivo
   * @returns {{ok:boolean, linhasRemovidas:number}}
   */
  function excluirPorArquivo(nomeArquivo) {
    const arquivo = String(nomeArquivo || '').trim();
    if (!arquivo) return { ok: true, linhasRemovidas: 0 };

    const sheet = _getSheet(false);
    if (!sheet) return { ok: true, linhasRemovidas: 0 };
    const last = sheet.getLastRow();
    if (last < 2) return { ok: true, linhasRemovidas: 0 };

    const linhas = sheet.getRange(2, 1, last - 1, HEADER.length).getValues();
    let removidas = 0;
    const mantidas = linhas.filter(function (row) {
      const bate = String(row[COL.arquivo] || '').trim() === arquivo;
      if (bate) removidas++;
      return !bate;
    });

    if (removidas > 0) {
      sheet.getRange(2, 1, linhas.length, HEADER.length).clearContent();
      if (mantidas.length > 0) {
        sheet.getRange(2, 1, mantidas.length, HEADER.length).setValues(mantidas);
      }
    }
    return { ok: true, linhasRemovidas: removidas };
  }

  /**
   * Salva os trechos extraídos de um PDF. Recusa a gravação se o nome do
   * arquivo já constar na aba (dedupe) — quem decide sobrescrever ou pular é
   * o chamador, aqui apenas protegemos contra duplicata silenciosa.
   *
   * @param {string} nomeArquivo   — nome do PDF (chave de dedupe)
   * @param {{idEsquema:string, nomeLinha:string, veiculo:string,
   *           dataViagem:string, horarioViagem:string}} meta
   * @param {Array<{trechoDe:string, trechoPara:string, velMedia:?number,
   *           velIdeal:?number, tempoEsperadoMin:?number,
   *           tempoRealizadoMin:?number, impactoMin:?number,
   *           criticidade:?string}>} trechos
   * @returns {{ok:boolean, motivo?:string, linhasGravadas?:number}}
   */
  function salvarRegistros(nomeArquivo, meta, trechos) {
    const arquivo = String(nomeArquivo || '').trim();
    if (!arquivo) return { ok: false, motivo: 'Nome do arquivo ausente.' };

    const jaImportados = arquivosJaImportados();
    if (jaImportados[arquivo]) {
      return { ok: false, motivo: 'Este PDF já foi importado anteriormente.' };
    }

    // Sem trechos válidos (comum em viagens com muitos pontos intermediários
    // — postos, restaurantes — sem distância/tempo calculável entre eles)
    // NÃO é motivo pra bloquear o arquivo inteiro: o "Histórico da linha"
    // depende só de HistoricoHorariosStore (horário real × comercial), não
    // desta aba. Quem decide se o arquivo falhou de vez (nem trechos nem
    // horários) é Code.js/salvarHistoricoTrechos, que combina os dois.
    if (!trechos || trechos.length === 0) {
      return { ok: true, linhasGravadas: 0 };
    }

    const sheet = _getSheet(true);
    const agora = new Date().toISOString();
    const m = meta || {};

    const matriz = trechos.map(function (t) {
      const row = new Array(HEADER.length).fill('');
      row[COL.arquivo]           = arquivo;
      row[COL.idEsquema]         = m.idEsquema || '';
      row[COL.nomeLinha]         = m.nomeLinha || '';
      row[COL.veiculo]           = m.veiculo || '';
      row[COL.dataViagem]        = m.dataViagem || '';
      row[COL.horarioViagem]     = m.horarioViagem || '';
      row[COL.trechoDe]          = t.trechoDe || '';
      row[COL.trechoPara]        = t.trechoPara || '';
      row[COL.velMedia]          = t.velMedia != null ? t.velMedia : '';
      row[COL.velIdeal]          = t.velIdeal != null ? t.velIdeal : '';
      row[COL.tempoEsperadoMin]  = t.tempoEsperadoMin != null ? t.tempoEsperadoMin : '';
      row[COL.tempoRealizadoMin] = t.tempoRealizadoMin != null ? t.tempoRealizadoMin : '';
      row[COL.impactoMin]        = t.impactoMin != null ? t.impactoMin : '';
      row[COL.criticidade]       = t.criticidade || '';
      row[COL.dataImportacao]    = agora;
      return row;
    });

    // Escrita em lote (uma única chamada de API), em vez de appendRow por
    // trecho — uma viagem com 13 trechos não deve custar 13 idas ao Sheets.
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, matriz.length, HEADER.length).setValues(matriz);

    return { ok: true, linhasGravadas: matriz.length };
  }

  // Abaixo disso (minutos), um trecho não é confiável o bastante pra
  // entrar na média de "Tempo Desl." — um ônibus não percorre um trecho
  // entre dois locais distintos em menos de ~2min de verdade; valores tão
  // baixos normalmente são dois pontos com geofence sobreposto/muito
  // próximo (ex: um posto colado numa rodoviária), não um deslocamento
  // real. Mesmo espírito do TEMPO_MIN_ALERTA_S do AnalysisService (que já
  // ignora trechos curtos demais pra gerar alerta de velocidade).
  const TEMPO_MIN_CONFIAVEL_MIN = 2;

  /**
   * Retorna os pares trecho_para/tempo_realizado_min de uma linha — usado
   * por HistoricoHorariosStore pra calcular "Tempo Desl." na grade
   * "Histórico da linha" com o tempo REAL medido (saída do ponto anterior
   * → entrada neste), o mesmo critério da Análise de viagem única — em vez
   * de uma estimativa teórica por distância, que não sabe tratar o
   * primeiro ponto da rota (cujo "anterior" costuma ser a garagem, sem
   * horário comercial e às vezes sem coordenada cadastrada em LOCAIS).
   * Marca `confiavel:false` pra trechos abaixo de TEMPO_MIN_CONFIAVEL_MIN
   * (ruído de geofence sobreposto, não deslocamento real) — quem agrega
   * decide o que fazer quando só existem trechos não confiáveis.
   *
   * @param {string} idEsquema
   * @returns {Array<{trechoDe:string, trechoPara:string, tempoRealizadoMin:number, confiavel:boolean}>}
   */
  function getTemposRealizadosPorDestino(idEsquema) {
    const alvo = String(idEsquema || '').trim();
    const linhas = _lerTudo().filter(function (row) {
      return String(row[COL.idEsquema] || '').trim() === alvo;
    });
    const out = [];
    linhas.forEach(function (row) {
      const trechoDe = String(row[COL.trechoDe] || '').trim();
      const trechoPara = String(row[COL.trechoPara] || '').trim();
      const min = parseFloat(row[COL.tempoRealizadoMin]);
      // Não filtra aqui — devolve tudo com um flag de confiabilidade, pra
      // quem agrega (HistoricoHorariosStore.getPivot) poder diferenciar
      // "nunca vimos trecho pra esse local" de "só vimos trechos curtos
      // demais pra confiar" (dois casos que merecem tratamento diferente).
      if (trechoPara && !isNaN(min)) {
        out.push({ trechoDe: trechoDe, trechoPara: trechoPara, tempoRealizadoMin: min, confiavel: min >= TEMPO_MIN_CONFIAVEL_MIN });
      }
    });
    return out;
  }

  /**
   * Agrega o histórico de uma linha (id_esquema) por trecho, para a view
   * "Histórico da linha": nº de ocorrências, velocidade média/min/max,
   * % de criticidade alta/crítica, impacto médio — ordenado do trecho mais
   * problemático para o menos problemático.
   *
   * @param {string} idEsquema
   * @returns {Array<Object>}
   */
  function getHistoricoAgregado(idEsquema) {
    const alvo = String(idEsquema || '').trim();
    const linhas = _lerTudo().filter(function (row) {
      return String(row[COL.idEsquema] || '').trim() === alvo;
    });
    if (linhas.length === 0) return [];

    const grupos = {}; // chave "de|para" -> acumulador
    linhas.forEach(function (row) {
      const de = String(row[COL.trechoDe] || '').trim();
      const para = String(row[COL.trechoPara] || '').trim();
      const chave = de + '|' + para;
      if (!grupos[chave]) {
        grupos[chave] = {
          trechoDe: de, trechoPara: para,
          ocorrencias: 0,
          somaVel: 0, qtdVel: 0, velMin: null, velMax: null,
          somaImpacto: 0, qtdImpacto: 0,
          criticoOuAlto: 0, qtdCriticidade: 0
        };
      }
      const g = grupos[chave];
      g.ocorrencias++;

      const vel = parseFloat(row[COL.velMedia]);
      if (!isNaN(vel)) {
        g.somaVel += vel; g.qtdVel++;
        g.velMin = g.velMin === null ? vel : Math.min(g.velMin, vel);
        g.velMax = g.velMax === null ? vel : Math.max(g.velMax, vel);
      }

      const impacto = parseFloat(row[COL.impactoMin]);
      if (!isNaN(impacto)) { g.somaImpacto += impacto; g.qtdImpacto++; }

      const crit = String(row[COL.criticidade] || '').trim().toLowerCase();
      if (crit) {
        g.qtdCriticidade++;
        if (crit === 'crítica' || crit === 'critica' || crit === 'alta') g.criticoOuAlto++;
      }
    });

    const resultado = Object.keys(grupos).map(function (chave) {
      const g = grupos[chave];
      return {
        trechoDe: g.trechoDe,
        trechoPara: g.trechoPara,
        ocorrencias: g.ocorrencias,
        velMedia: g.qtdVel ? Math.round((g.somaVel / g.qtdVel) * 10) / 10 : null,
        velMin: g.velMin,
        velMax: g.velMax,
        impactoMedioMin: g.qtdImpacto ? Math.round((g.somaImpacto / g.qtdImpacto) * 10) / 10 : null,
        pctCriticoOuAlto: g.qtdCriticidade ? Math.round((g.criticoOuAlto / g.qtdCriticidade) * 100) : 0
      };
    });

    resultado.sort(function (a, b) {
      if (b.pctCriticoOuAlto !== a.pctCriticoOuAlto) return b.pctCriticoOuAlto - a.pctCriticoOuAlto;
      return (b.impactoMedioMin || 0) - (a.impactoMedioMin || 0);
    });

    return resultado;
  }

  return {
    arquivosJaImportados: arquivosJaImportados,
    salvarRegistros: salvarRegistros,
    excluirPorArquivo: excluirPorArquivo,
    getHistoricoAgregado: getHistoricoAgregado,
    getTemposRealizadosPorDestino: getTemposRealizadosPorDestino
  };

})();
