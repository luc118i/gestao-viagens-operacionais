// ============================================================
//  HistoricoHorariosStore.gs  —  Persistência do desvio horário
//  (real × programado) extraído de PDFs "Análise de Viagem" importados
//  em massa. Vem da tabela "Linha do Tempo do Atraso" do Diagnóstico
//  Inteligente — só existe quando o PDF teve o diagnóstico anexado.
//  Responsabilidade: guardar uma linha por local de controle de cada
//  PDF importado e agregar por linha/local para a view "Histórico da
//  linha" — objetivo: achar locais com desvio sistemático do horário
//  comercial ao longo de várias viagens reais.
//  Aba: HISTORICO_HORARIOS  [arquivo_pdf, id_esquema, nome_linha,
//       veiculo, data_viagem, horario_viagem, local, horario_real,
//       horario_programado, variacao_min, tendencia, data_importacao]
// ============================================================

var HistoricoHorariosStore = (() => {

  const SHEET  = 'HISTORICO_HORARIOS';
  const HEADER = [
    'arquivo_pdf', 'id_esquema', 'nome_linha', 'veiculo',
    'data_viagem', 'horario_viagem', 'local', 'horario_real',
    'horario_programado', 'variacao_min', 'tendencia', 'data_importacao'
  ];

  const COL = {
    arquivo: 0, idEsquema: 1, nomeLinha: 2, veiculo: 3,
    dataViagem: 4, horarioViagem: 5, local: 6, horarioReal: 7,
    horarioProgramado: 8, variacaoMin: 9, tendencia: 10, dataImportacao: 11
  };

  // Acima desse desvio absoluto (minutos), consideramos "desvio
  // considerável" do horário comercial para fins de agregação — só
  // interessa pontos com atraso/adiantamento acima de 1h.
  const LIMIAR_CONSIDERAVEL_MIN = 60;

  // Fallback de "Tempo Desl." quando só existem trechos curtos demais pra
  // confiar (locais fisicamente próximos, geofence sobreposto) — mostra uma
  // estimativa padrão em vez de deixar em branco.
  const TEMPO_DESLOCAMENTO_FALLBACK_MIN = 30;

  // Teto de desvio da sugestão automática em relação ao horário comercial —
  // o setor não aceita solicitação de mudança acima disso, então não faz
  // sentido sugerir um valor que nunca vai ser aprovado.
  const LIMITE_SUGESTAO_DESVIO_MIN = 120;

  // ---- Sugestão manual (override do usuário na grade "Histórico da
  // linha") — guardada à parte porque é por (linha, local), não por
  // registro de PDF importado. Sobrescreve a sugestão calculada até o
  // usuário reimportar os PDFs (o que reconstrói o cálculo automático) ou
  // remover o local da grade.
  const SHEET_OVERRIDE  = 'HISTORICO_HORARIOS_SUGESTAO_MANUAL';
  const HEADER_OVERRIDE = ['id_esquema', 'local', 'sugestao_manual', 'data_edicao'];
  const COL_OVERRIDE = { idEsquema: 0, local: 1, sugestaoManual: 2, dataEdicao: 3 };

  /**
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

  function _lerTudo() {
    const sheet = _getSheet(false);
    if (!sheet) return [];
    const last = sheet.getLastRow();
    if (last < 2) return [];
    return sheet.getRange(2, 1, last - 1, HEADER.length).getValues();
  }

  /**
   * Retorna o conjunto (Set) de nomes de arquivo já importados NESTA aba
   * — complementa HistoricoTrechosStore.arquivosJaImportados(): um CSV
   * sem trechos válidos (viagem com muitos pontos intermediários sem
   * distância calculável) não grava nada em HISTORICO_TRECHOS, então só
   * apareceria aqui. Code.js une os dois conjuntos pra decidir "já
   * importado" de verdade.
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
   * @param {boolean} criar
   * @returns {GoogleAppsScript.Spreadsheet.Sheet|null}
   */
  function _getSheetOverride(criar) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_OVERRIDE);
    if (!sheet && criar) {
      sheet = ss.insertSheet(SHEET_OVERRIDE);
      sheet.getRange(1, 1, 1, HEADER_OVERRIDE.length).setValues([HEADER_OVERRIDE]);
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  /**
   * @param {string} idEsquema
   * @returns {Object<string,string>} local -> sugestao_manual ("HH:MM")
   */
  function _lerOverrides(idEsquema) {
    const sheet = _getSheetOverride(false);
    if (!sheet) return {};
    const last = sheet.getLastRow();
    if (last < 2) return {};
    const alvo = String(idEsquema || '').trim();
    const linhas = sheet.getRange(2, 1, last - 1, HEADER_OVERRIDE.length).getValues();
    const mapa = {};
    linhas.forEach(function (row) {
      if (String(row[COL_OVERRIDE.idEsquema] || '').trim() !== alvo) return;
      const local = String(row[COL_OVERRIDE.local] || '').trim();
      if (local) mapa[local] = _horaCell(row[COL_OVERRIDE.sugestaoManual]);
    });
    return mapa;
  }

  /**
   * Salva (ou atualiza) a sugestão manual de um local — sobrescreve o
   * cálculo automático na grade "Histórico da linha" até o usuário
   * reimportar os PDFs ou remover o local.
   *
   * @param {string} idEsquema
   * @param {string} local
   * @param {string} sugestao  "HH:MM"
   * @returns {{ok:boolean, motivo?:string}}
   */
  function salvarSugestaoManual(idEsquema, local, sugestao) {
    const alvo = String(idEsquema || '').trim();
    const alvoLocal = String(local || '').trim();
    const valor = String(sugestao || '').trim();
    if (!alvo || !alvoLocal) return { ok: false, motivo: 'Linha ou local inválido.' };
    if (!/^\d{1,2}:\d{2}$/.test(valor)) return { ok: false, motivo: 'Horário inválido — use o formato HH:MM.' };

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const sheet = _getSheetOverride(true);
      const last = sheet.getLastRow();
      let rowIndex = -1;
      if (last >= 2) {
        const linhas = sheet.getRange(2, 1, last - 1, HEADER_OVERRIDE.length).getValues();
        for (let i = 0; i < linhas.length; i++) {
          if (
            String(linhas[i][COL_OVERRIDE.idEsquema] || '').trim() === alvo &&
            String(linhas[i][COL_OVERRIDE.local] || '').trim() === alvoLocal
          ) { rowIndex = i + 2; break; }
        }
      }

      const agora = new Date().toISOString();
      if (rowIndex > 0) {
        sheet.getRange(rowIndex, COL_OVERRIDE.sugestaoManual + 1, 1, 2).setNumberFormat('@')
          .setValues([[valor, agora]]);
      } else {
        const startRow = sheet.getLastRow() + 1;
        sheet.getRange(startRow, COL_OVERRIDE.sugestaoManual + 1, 1, 1).setNumberFormat('@');
        sheet.getRange(startRow, 1, 1, HEADER_OVERRIDE.length)
          .setValues([[alvo, alvoLocal, valor, agora]]);
      }
    } finally {
      lock.releaseLock();
    }
    return { ok: true };
  }

  /**
   * Remove definitivamente um local da grade "Histórico da linha": apaga
   * todos os registros de horário desse local nessa linha (HISTORICO_
   * HORARIOS) e qualquer sugestão manual associada. Ação destrutiva — só
   * volta reimportando os PDFs.
   *
   * @param {string} idEsquema
   * @param {string} local
   * @returns {{ok:boolean, linhasRemovidas?:number}}
   */
  function excluirLocal(idEsquema, local) {
    const alvo = String(idEsquema || '').trim();
    const alvoLocal = String(local || '').trim();
    let linhasRemovidas = 0;

    // Lê-filtra-reescreve a aba inteira não é atômico: se o usuário clicar
    // em "remover" em mais de uma linha em sequência rápida, duas chamadas
    // rodam em paralelo, cada uma lendo o estado antes da outra escrever —
    // a que terminar por último sobrescreve a planilha com uma "foto" que
    // já não inclui a exclusão da primeira, apagando de volta dados que já
    // tinham sido removidos ou perdendo dados que deveriam ter ficado. O
    // lock serializa as chamadas pra essa aba, eliminando a corrida.
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const sheet = _getSheet(false);
      if (sheet) {
        const last = sheet.getLastRow();
        if (last >= 2) {
          const linhas = sheet.getRange(2, 1, last - 1, HEADER.length).getValues();
          // Reescreve a aba de uma vez (1 leitura + 1 escrita) em vez de
          // deleteRow por linha — cada deleteRow reindexa a planilha
          // inteira, então com muitas linhas casando (histórico grande) a
          // exclusão ficava visivelmente lenta.
          const mantidas = linhas.filter(function (row) {
            const bate = String(row[COL.idEsquema] || '').trim() === alvo &&
              String(row[COL.local] || '').trim() === alvoLocal;
            if (bate) linhasRemovidas++;
            return !bate;
          });
          if (linhasRemovidas > 0) {
            sheet.getRange(2, 1, linhas.length, HEADER.length).clearContent();
            if (mantidas.length > 0) {
              sheet.getRange(2, 1, mantidas.length, HEADER.length).setValues(mantidas);
            }
          }
        }
      }

      const sheetOverride = _getSheetOverride(false);
      if (sheetOverride) {
        const last = sheetOverride.getLastRow();
        if (last >= 2) {
          const linhas = sheetOverride.getRange(2, 1, last - 1, HEADER_OVERRIDE.length).getValues();
          for (let i = linhas.length - 1; i >= 0; i--) {
            if (
              String(linhas[i][COL_OVERRIDE.idEsquema] || '').trim() === alvo &&
              String(linhas[i][COL_OVERRIDE.local] || '').trim() === alvoLocal
            ) {
              sheetOverride.deleteRow(i + 2);
            }
          }
        }
      }
    } finally {
      lock.releaseLock();
    }

    return { ok: true, linhasRemovidas: linhasRemovidas };
  }

  /**
   * Remove definitivamente uma coluna de data (uma viagem importada
   * inteira) da grade "Histórico da linha" — todos os locais dessa data,
   * pra essa linha. Útil quando uma importação específica veio poluída e
   * atrapalha a análise. Simétrico a excluirLocal (que remove por linha
   * em vez de por coluna).
   *
   * @param {string} idEsquema
   * @param {string} data  "DD/MM/YYYY" (mesmo formato exibido no cabeçalho da coluna)
   * @returns {{ok:boolean, linhasRemovidas?:number}}
   */
  function excluirPorData(idEsquema, data) {
    const alvo = String(idEsquema || '').trim();
    const alvoData = String(data || '').trim();
    let linhasRemovidas = 0;

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const sheet = _getSheet(false);
      if (sheet) {
        const last = sheet.getLastRow();
        if (last >= 2) {
          const linhas = sheet.getRange(2, 1, last - 1, HEADER.length).getValues();
          const mantidas = linhas.filter(function (row) {
            const bate = String(row[COL.idEsquema] || '').trim() === alvo &&
              _dataCell(row[COL.dataViagem]) === alvoData;
            if (bate) linhasRemovidas++;
            return !bate;
          });
          if (linhasRemovidas > 0) {
            sheet.getRange(2, 1, linhas.length, HEADER.length).clearContent();
            if (mantidas.length > 0) {
              sheet.getRange(2, 1, mantidas.length, HEADER.length).setValues(mantidas);
            }
          }
        }
      }
    } finally {
      lock.releaseLock();
    }

    return { ok: true, linhasRemovidas: linhasRemovidas };
  }

  /**
   * Salva os desvios de horário extraídos de um PDF. Não faz dedupe
   * própria — o chamador (salvarHistoricoTrechos) já garante que o
   * arquivo não foi importado antes via HistoricoTrechosStore.
   *
   * @param {string} nomeArquivo
   * @param {Object} meta         — mesmo shape de HistoricoTrechosStore.salvarRegistros
   * @param {Array<{local:string, horarioReal:string, horarioProgramado:string, variacaoMin:number, tendencia:string}>} horarios
   * @returns {{ok:boolean, linhasGravadas?:number}}
   */
  function salvarRegistros(nomeArquivo, meta, horarios) {
    if (!horarios || horarios.length === 0) return { ok: true, linhasGravadas: 0 };

    const sheet = _getSheet(true);
    const agora = new Date().toISOString();
    const m = meta || {};
    const arquivo = String(nomeArquivo || '').trim();

    const matriz = horarios.map(function (h) {
      const row = new Array(HEADER.length).fill('');
      row[COL.arquivo]            = arquivo;
      row[COL.idEsquema]          = m.idEsquema || '';
      row[COL.nomeLinha]          = m.nomeLinha || '';
      row[COL.veiculo]            = m.veiculo || '';
      row[COL.dataViagem]         = m.dataViagem || '';
      row[COL.horarioViagem]      = m.horarioViagem || '';
      row[COL.local]              = h.local || '';
      row[COL.horarioReal]        = h.horarioReal || '';
      row[COL.horarioProgramado]  = h.horarioProgramado || '';
      row[COL.variacaoMin]        = h.variacaoMin != null ? h.variacaoMin : '';
      row[COL.tendencia]          = h.tendencia || '';
      row[COL.dataImportacao]     = agora;
      return row;
    });

    const startRow = sheet.getLastRow() + 1;
    // Formata como texto ANTES de escrever, senão o Sheets detecta
    // "DD/MM/YYYY"/"HH:MM" como data/hora e converte a célula para Date —
    // é isso que gerava o "Sat Dec 30 1899 23:53:32 GMT-..." na tela.
    sheet.getRange(startRow, COL.dataViagem + 1, matriz.length, 1).setNumberFormat('@');
    sheet.getRange(startRow, COL.horarioReal + 1, matriz.length, 1).setNumberFormat('@');
    sheet.getRange(startRow, COL.horarioProgramado + 1, matriz.length, 1).setNumberFormat('@');
    sheet.getRange(startRow, 1, matriz.length, HEADER.length).setValues(matriz);

    return { ok: true, linhasGravadas: matriz.length };
  }

  /**
   * Remove definitivamente todas as linhas de um arquivo já importado —
   * mesmo par de "Substituir" de HistoricoTrechosStore.excluirPorArquivo,
   * só que na aba de horários.
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
   * Agrega o histórico de desvio horário de uma linha (id_esquema) por
   * local: nº de ocorrências, variação média/mín/máx, % de ocorrências
   * com desvio considerável (|variação| >= LIMIAR_CONSIDERAVEL_MIN) —
   * ordenado do local com maior desvio médio absoluto para o menor.
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

    const grupos = {}; // local -> acumulador
    linhas.forEach(function (row) {
      const local = String(row[COL.local] || '').trim();
      if (!local) return;
      if (!grupos[local]) {
        grupos[local] = {
          local: local,
          ocorrencias: 0,
          somaVariacao: 0, qtdVariacao: 0,
          variacaoMin: null, variacaoMax: null,
          consideraveis: 0
        };
      }
      const g = grupos[local];
      g.ocorrencias++;

      const v = parseFloat(row[COL.variacaoMin]);
      if (!isNaN(v)) {
        g.somaVariacao += v; g.qtdVariacao++;
        g.variacaoMin = g.variacaoMin === null ? v : Math.min(g.variacaoMin, v);
        g.variacaoMax = g.variacaoMax === null ? v : Math.max(g.variacaoMax, v);
        if (Math.abs(v) >= LIMIAR_CONSIDERAVEL_MIN) g.consideraveis++;
      }
    });

    const resultado = Object.keys(grupos).map(function (local) {
      const g = grupos[local];
      const variacaoMedia = g.qtdVariacao ? g.somaVariacao / g.qtdVariacao : null;
      return {
        local: g.local,
        ocorrencias: g.ocorrencias,
        variacaoMediaMin: variacaoMedia != null ? Math.round(variacaoMedia * 10) / 10 : null,
        variacaoMinMin: g.variacaoMin,
        variacaoMaxMin: g.variacaoMax,
        pctConsideravel: g.qtdVariacao ? Math.round((g.consideraveis / g.qtdVariacao) * 100) : 0
      };
    });

    resultado.sort(function (a, b) {
      const absA = Math.abs(a.variacaoMediaMin || 0);
      const absB = Math.abs(b.variacaoMediaMin || 0);
      return absB - absA;
    });

    return resultado;
  }

  /**
   * Normaliza a célula de horário lida da planilha para "HH:MM". O Sheets
   * detecta automaticamente que "23:53" é um horário e guarda a célula como
   * Date (era 30/12/1899) — String(date) direto vira algo como "Sat Dec 30
   * 1899 23:53:32 GMT-0300 (Horário Padrão de Brasília)". Aqui reformatamos
   * de volta para HH:MM antes de qualquer uso/exibição.
   */
  function _horaCell(v) {
    if (v instanceof Date) {
      return Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'HH:mm');
    }
    return String(v || '').trim();
  }

  /**
   * Mesma normalização de _horaCell, mas para a coluna data_viagem — o
   * Sheets também detecta "DD/MM/YYYY" como data e guarda como Date.
   */
  function _dataCell(v) {
    if (v instanceof Date) {
      return Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'dd/MM/yyyy');
    }
    return String(v || '').trim();
  }

  /**
   * Converte "HH:MM" em minutos desde a meia-noite. null se inválido.
   */
  function _horaParaMinutos(hhmm) {
    const m = String(hhmm || '').match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  /**
   * Converte minutos desde a meia-noite em "HH:MM" (normaliza para 0–1439).
   */
  function _minutosParaHora(min) {
    const norm = ((Math.round(min) % 1440) + 1440) % 1440;
    const h = Math.floor(norm / 60), m = norm % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  /**
   * Sugestão automática a partir dos horários reais de várias viagens: usa
   * a MEDIANA (não a média) dos minutos-do-dia de cada viagem, arredondada
   * pra cima pro próximo múltiplo de 5 (sugestão fica sempre "redonda",
   * fácil de comunicar pro motorista/operação). Mediana em vez de média
   * porque é naturalmente resistente a outlier — uma viagem isolada de
   * madrugada/atraso enorme não "puxa" a sugestão pra longe de onde a
   * maioria das viagens realmente chega, sem precisar da combinação
   * moda(hora)+média(minuto) usada antes só pra contornar esse mesmo
   * problema. Com 2 viagens divergentes (empate na mediana), pega a maior
   * das duas — mantém a lógica antiga de "arredondar pra cima" também
   * nesse caso.
   * @param {number[]} minutosArr minutos desde meia-noite de cada viagem
   * @returns {number|null} minutos desde meia-noite da sugestão, ou null
   */
  function _sugestaoMediana(minutosArr) {
    if (!minutosArr.length) return null;
    const ordenado = minutosArr.slice().sort(function (a, b) { return a - b; });
    const n = ordenado.length;
    const meio = Math.floor(n / 2);
    const mediana = n % 2 !== 0 ? ordenado[meio] : (ordenado[meio - 1] + ordenado[meio]) / 2;
    return Math.ceil(mediana / 5) * 5;
  }

  /**
   * Classifica o padrão de atraso de um local: "sistemático" (a maioria das
   * viagens chega fora do horário — pede mudança de horário programado) vs
   * "pontual" (só uma viagem isolada destoou — pede investigar a ocorrência,
   * não mexer no horário) vs "instável" (meio a meio, sem padrão claro). A
   * Sugestão (moda/média) sozinha não distingue os dois primeiros casos: uma
   * viagem com +1h29 cercada de dias no horário produz quase a mesma
   * sugestão agregada que um atraso reincidente de +25min todo dia — mas são
   * problemas operacionais bem diferentes. Retorna null quando não há dado
   * suficiente pra classificar (nenhuma viagem fora do limiar, ou sem
   * horário programado pra comparar).
   * @param {number[]} minutosArr minutos desde meia-noite de cada viagem real
   * @param {number|null} programadoMin minutos desde meia-noite do horário comercial
   * @returns {{classe:string, qtdAtrasadas:number, qtdViagens:number}|null}
   */
  function _classificarConsistencia(minutosArr, programadoMin) {
    if (programadoMin == null || !minutosArr.length) return null;
    const qtdViagens = minutosArr.length;
    const qtdAtrasadas = minutosArr.filter(function (min) {
      return Math.abs(min - programadoMin) >= LIMIAR_CONSIDERAVEL_MIN;
    }).length;
    if (qtdAtrasadas === 0) return null; // nada fora do horário — sem o que classificar
    if (qtdViagens < 2) return { classe: 'unico', qtdAtrasadas: qtdAtrasadas, qtdViagens: qtdViagens };
    const ratio = qtdAtrasadas / qtdViagens;
    const classe = ratio >= 0.7 ? 'sistematico' : (ratio <= 0.3 ? 'pontual' : 'instavel');
    return { classe: classe, qtdAtrasadas: qtdAtrasadas, qtdViagens: qtdViagens };
  }

  /**
   * Normaliza nome de local pra comparação (remove acento, caixa alta,
   * espaços colapsados) — o nome do local vem de duas fontes que nem
   * sempre concordam: o texto extraído do PDF ("RODOVIARIA DE GOIANIA -
   * GO", sem acento, tudo maiúsculo) e o nome do ponto cadastrado no
   * esquema (ex: "Rodoviária de Goiânia - GO", com acento). Comparação
   * por string exata perdia o predecessor nesses casos, deixando o "Tempo
   * Desl." vazio mesmo quando o ponto existe no esquema.
   */
  function _normNome(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * "DD/MM/YYYY" -> timestamp, para ordenar as colunas de data em sequência
   * cronológica. 0 se não reconhecer o formato.
   */
  function _parseDataBr(s) {
    const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return 0;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
  }

  /**
   * "YYYY-MM-DD" (formato de <input type="date">) -> timestamp. null se
   * inválido/vazio.
   */
  function _parseDataIso(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  }

  /**
   * Monta a tabela dinâmica (pivot) de horários por local × data — uma
   * coluna por viagem importada, mais Tempo de Deslocamento/Programado/
   * Sugestão. Sugestão = média (em minutos do dia) dos horários reais das
   * datas disponíveis para aquele local, convertida de volta para HH:MM.
   * Só entram locais com desvio |sugestão − programado| >= LIMIAR_CONSIDERAVEL_MIN
   * (esconde os que estão sempre no horário), ordenados do maior desvio
   * pro menor.
   *
   * @param {string} idEsquema
   * @param {string} [dataInicio]  "YYYY-MM-DD" — filtra viagens a partir dessa data (inclusive)
   * @param {string} [dataFim]     "YYYY-MM-DD" — filtra viagens até essa data (inclusive)
   * @returns {{locais:Array<Object>, datas:Array<string>}}
   */
  function getPivot(idEsquema, dataInicio, dataFim) {
    const alvo = String(idEsquema || '').trim();
    const inicioTs = _parseDataIso(dataInicio);
    const fimTs = _parseDataIso(dataFim);

    const linhas = _lerTudo().filter(function (row) {
      return String(row[COL.idEsquema] || '').trim() === alvo;
    });
    if (linhas.length === 0) return { locais: [], datas: [] };

    const porLocal = {}; // local -> { programado, porData: {data: horarioReal} }
    const datasSet = {};
    linhas.forEach(function (row) {
      const local = String(row[COL.local] || '').trim();
      if (!local) return;
      const data = _dataCell(row[COL.dataViagem]);
      const horarioReal = _horaCell(row[COL.horarioReal]);
      const programado = _horaCell(row[COL.horarioProgramado]);
      if (!porLocal[local]) porLocal[local] = { programado: '', porData: {} };
      if (programado) porLocal[local].programado = programado;

      // Filtro de período: aplica só na coluna de data/horário real — o
      // "Programado" continua vindo de qualquer linha (é fixo por local,
      // não muda entre viagens), senão filtrar o período também apagaria
      // o horário comercial de referência.
      if (data) {
        const dataTs = _parseDataBr(data);
        const dentroDoInicio = inicioTs == null || dataTs >= inicioTs;
        const dentroDoFim = fimTs == null || dataTs <= fimTs;
        if (dentroDoInicio && dentroDoFim) {
          porLocal[local].porData[data] = horarioReal;
          datasSet[data] = true;
        }
      }
    });

    const datas = Object.keys(datasSet).sort(function (a, b) {
      return _parseDataBr(a) - _parseDataBr(b);
    });

    // ordemPorNomeNorm guarda a posição de cada local na sequência do
    // esquema — usada pra ordenar a lista final pelo trajeto real (não
    // pelo tamanho do desvio), senão a tabela mistura a ordem e fica
    // difícil achar o ponto no mapa mental da linha. Indexado pelo nome
    // NORMALIZADO (sem acento, maiúsculo) — o nome do local extraído do
    // CSV ("RODOVIARIA DE GOIANIA - GO") nem sempre bate caractere-a-
    // caractere com o nome do ponto cadastrado no esquema (ex: "Rodoviária
    // de Goiânia - GO", com acento).
    let ordemPorNomeNorm = {};
    try {
      const pontosEsquema = EsquemasService.getPontosDoEsquema(alvo);
      for (let i = 0; i < pontosEsquema.length; i++) {
        const nomeAtual = _normNome(pontosEsquema[i].nome_ponto);
        if (nomeAtual && !(nomeAtual in ordemPorNomeNorm)) ordemPorNomeNorm[nomeAtual] = i;
      }
    } catch (e) { /* esquema pode não existir mais — segue sem ordem */ }

    // "Tempo Desl." = tempo REAL médio de deslocamento até este local
    // (saída do ponto anterior → entrada neste), o mesmo critério da
    // Análise de viagem única — vem dos trechos já salvos em
    // HISTORICO_TRECHOS (trecho_para = este local), não de uma estimativa
    // teórica por distância: isso também resolve corretamente o primeiro
    // ponto da rota, cujo "anterior" costuma ser a garagem (sem horário
    // comercial cadastrado) — o que importa ali é a saída de lá, e isso já
    // está embutido no tempo_realizado_min do trecho garagem→1º ponto.
    // origens: nome do ponto anterior -> quantas viagens usaram ele nesse
    // cálculo — pode variar entre viagens (ex: às vezes tem parada num
    // posto intermediário, às vezes não), então guardamos todos pra exibir
    // no tooltip da coluna "Tempo Desl.".
    const somaTempoPorDestinoNorm = {}; // destinoNorm -> {soma, qtd, origens, viuTrechoCurto}
    HistoricoTrechosStore.getTemposRealizadosPorDestino(alvo).forEach(function (t) {
      const key = _normNome(t.trechoPara);
      if (!somaTempoPorDestinoNorm[key]) somaTempoPorDestinoNorm[key] = { soma: 0, qtd: 0, origens: {}, viuTrechoCurto: false };
      if (!t.confiavel) {
        // Trecho curto demais pra confiar (ruído de geofence sobreposto,
        // não deslocamento real) — não entra na média, mas registra que
        // existe pra decidir o fallback abaixo.
        somaTempoPorDestinoNorm[key].viuTrechoCurto = true;
        return;
      }
      somaTempoPorDestinoNorm[key].soma += t.tempoRealizadoMin;
      somaTempoPorDestinoNorm[key].qtd += 1;
      const nomeOrigem = t.trechoDe || 'garagem (início da linha)';
      somaTempoPorDestinoNorm[key].origens[nomeOrigem] = (somaTempoPorDestinoNorm[key].origens[nomeOrigem] || 0) + 1;
    });

    const overrides = _lerOverrides(alvo);

    const locais = Object.keys(porLocal).map(function (local) {
      const info = porLocal[local];
      const minutos = datas
        .map(function (d) { return info.porData[d]; })
        .filter(Boolean)
        .map(_horaParaMinutos)
        .filter(function (v) { return v != null; });
      let sugestaoAutoMin = _sugestaoMediana(minutos);
      const programadoMin = _horaParaMinutos(info.programado);
      // Trava a sugestão automática em ±2h do horário comercial — o setor
      // não aprova pedido de mudança maior que isso, então limita aqui em
      // vez de sugerir um valor inviável na prática.
      if (sugestaoAutoMin != null && programadoMin != null) {
        if (sugestaoAutoMin - programadoMin > LIMITE_SUGESTAO_DESVIO_MIN) sugestaoAutoMin = programadoMin + LIMITE_SUGESTAO_DESVIO_MIN;
        else if (programadoMin - sugestaoAutoMin > LIMITE_SUGESTAO_DESVIO_MIN) sugestaoAutoMin = programadoMin - LIMITE_SUGESTAO_DESVIO_MIN;
      }

      // Sugestão manual (se o usuário editou na grade) prevalece sobre a
      // calculada — inclusive pro cálculo de desvio/cor/filtro de relevância.
      const temOverride = Object.prototype.hasOwnProperty.call(overrides, local);
      const sugestaoMin = temOverride ? _horaParaMinutos(overrides[local]) : sugestaoAutoMin;
      const diffMin = (sugestaoMin != null && programadoMin != null) ? sugestaoMin - programadoMin : null;

      // A sugestão agregada (moda/média) dilui um atraso isolado: uma
      // viagem com +1h29 num dia, cercada de dias no horário, pode gerar
      // uma sugestão média ainda perto do programado — diffMin pequeno
      // escondendo a linha inteira, mesmo com um atraso real e grave
      // registrado em info.porData. _classificarConsistencia olha data a
      // data: se alguma viagem isolada já passou do limiar, o local é
      // relevante independente do que a média diga, e o resultado também
      // dá pro front-end mostrar se é um problema sistemático (a maioria
      // das viagens atrasa) ou pontual (um outlier isolado).
      const consistencia = _classificarConsistencia(minutos, programadoMin);
      const temDesvioIsolado = !!consistencia;

      const localNorm = _normNome(local);

      let tempoDeslocamento = '';
      let tempoDeslocamentoOrigem = '';
      let tempoDeslocamentoEstimado = false;
      const agregadoDestino = somaTempoPorDestinoNorm[localNorm];
      if (agregadoDestino && agregadoDestino.qtd > 0) {
        tempoDeslocamento = _minutosParaHora(agregadoDestino.soma / agregadoDestino.qtd);
        const origens = agregadoDestino.origens;
        tempoDeslocamentoOrigem = Object.keys(origens)
          .sort(function (a, b) { return origens[b] - origens[a]; })
          .map(function (nome) { return nome + (origens[nome] > 1 ? ' (' + origens[nome] + 'x)' : ''); })
          .join(', ');
      } else if (agregadoDestino && agregadoDestino.viuTrechoCurto) {
        // Só vimos trechos curtos demais pra confiar — o local é vizinho
        // de outro ponto da linha, então usa a estimativa padrão em vez
        // de deixar em branco.
        tempoDeslocamento = _minutosParaHora(TEMPO_DESLOCAMENTO_FALLBACK_MIN);
        tempoDeslocamentoEstimado = true;
      }

      return {
        local: local,
        tempoDeslocamento: tempoDeslocamento,
        tempoDeslocamentoOrigem: tempoDeslocamentoOrigem,
        tempoDeslocamentoEstimado: tempoDeslocamentoEstimado,
        programado: info.programado || '',
        porData: info.porData,
        sugestao: sugestaoMin != null ? _minutosParaHora(sugestaoMin) : '',
        sugestaoManual: temOverride,
        diffMin: diffMin,
        temDesvioIsolado: temDesvioIsolado,
        consistencia: consistencia,
        ordem: localNorm in ordemPorNomeNorm ? ordemPorNomeNorm[localNorm] : Infinity
      };
    });

    // Uma vez editado manualmente, o local continua na grade mesmo que o
    // valor ajustado fique dentro do limiar — senão editar a sugestão faz
    // a linha sumir sozinha, sem o usuário pedir pra remover. temDesvioIsolado
    // cobre o caso de um atraso pontual grave que a média/moda dilui.
    const relevantes = locais.filter(function (loc) {
      return loc.sugestaoManual || loc.temDesvioIsolado
        || (loc.diffMin != null && Math.abs(loc.diffMin) >= LIMIAR_CONSIDERAVEL_MIN);
    });

    // Ordem do trajeto (posição no esquema); locais sem match no esquema
    // (nome divergiu no PDF) ficam no fim, ordenados entre si pelo desvio.
    relevantes.sort(function (a, b) {
      if (a.ordem !== b.ordem) return a.ordem - b.ordem;
      return Math.abs(b.diffMin) - Math.abs(a.diffMin);
    });

    return { locais: relevantes, datas: datas };
  }

  return {
    salvarRegistros: salvarRegistros,
    excluirPorArquivo: excluirPorArquivo,
    arquivosJaImportados: arquivosJaImportados,
    getHistoricoAgregado: getHistoricoAgregado,
    getPivot: getPivot,
    salvarSugestaoManual: salvarSugestaoManual,
    excluirLocal: excluirLocal,
    excluirPorData: excluirPorData
  };

})();
