// ============================================================
//  Code.gs  —  Entry point do Google Apps Script
//  Responsabilidade: servir a aplicação web via doGet(),
//  expor funções públicas ao frontend via google.script.run
// ============================================================

/**
 * Serve a aplicação web.
 * Acesse via: Implantar -> Web App -> URL gerada
 */
/** Função temporária — execute uma vez para autorizar UrlFetchApp, depois delete */
function _autorizarURLFetch() {
  var props = PropertiesService.getScriptProperties();
  var url = (props.getProperty("REPORT_API_URL") || "").replace(/\/$/, "");
  if (!url) { Logger.log("REPORT_API_URL não configurada"); return; }
  try {
    var r = UrlFetchApp.fetch(url + "/health", { muteHttpExceptions: true });
    Logger.log("Status: " + r.getResponseCode());
  } catch (e) {
    Logger.log("Erro (esperado na primeira vez): " + e.message);
  }
}

/**
 * Cria o menu "Gestão de Esquemas" na barra do Google Sheets.
 * Chamado automaticamente ao abrir a planilha.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Gestão de Esquemas')
    .addItem('Cadastrar Ponto', 'abrirFormularioCadastroPonto')
    .addToUi();
}

/**
 * Abre a sidebar de cadastro de ponto de esquema.
 */
function abrirFormularioCadastroPonto() {
  var html = HtmlService.createTemplateFromFile('CadastroPonto')
    .evaluate()
    .setTitle('Cadastrar Ponto');
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Retorna todos os locais da aba LOCAIS sem filtro de coordenadas.
 * Usado pelo formulário de cadastro de pontos.
 * @returns {Array<{codigo, descricao, tipo}>}
 */
function getLocaisParaFormulario() {
  try {
    return SheetsService.getLocaisSimples();
  } catch (e) {
    throw new Error('Erro ao carregar locais: ' + e.message);
  }
}

/**
 * Retorna a próxima ordem disponível para um esquema (max atual + 1).
 * @param {string} idEsquema
 * @returns {number}
 */
function getProximaOrdem(idEsquema) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('ESQUEMA_PONTOS');
    if (!sheet || sheet.getLastRow() < 2) return 1;

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    var maxOrdem = 0;
    var idStr = String(idEsquema).trim();

    data.forEach(function(row) {
      if (String(row[0]).trim() === idStr) {
        var ordem = Number(row[1]);
        if (!isNaN(ordem) && ordem > maxOrdem) maxOrdem = ordem;
      }
    });

    return maxOrdem + 1;
  } catch (e) {
    return 1;
  }
}

/**
 * Retorna esquemas e locais para o formulário de cadastro de ponto.
 * @returns {{ esquemas: Array, locais: Array }}
 */
function _getDadosCadastroPonto() {
  try {
    // Sempre lê da planilha ao abrir o formulário — o usuário pode ter
    // adicionado esquemas novos desde a última consulta.
    EsquemasService.invalidateCache();
    return {
      esquemas: EsquemasService.getEsquemas(),
      locais:   SheetsService.getLocaisSimples()
    };
  } catch (e) {
    throw new Error('Erro ao carregar dados do formulário: ' + e.message);
  }
}

/**
 * Retorna os pontos atuais de um esquema ordenados por ORDEM.
 * @param {string} idEsquema
 * @returns {Array<{idPonto, nomePonto}>}
 */
function getPontosEsquemaParaFormulario(idEsquema) {
  try {
    var pontos = EsquemasService.getPontosDoEsquema(idEsquema);
    var result = pontos.map(function(p) {
      return { idPonto: p.id_ponto, nomePonto: p.nome_ponto, tipo: p.tipo || '', horarioComercial: p.horario_comercial || '', tempoLocal: p.tempo_local || '', tipoTrecho: p.tipo_trecho || '' };
    });
    // Para trechos sem tipo definido, busca o tipo_via salvo em DISTANCIAS
    var distVia = _lerTipoViaDistancias_();
    for (var i = 0; i < result.length - 1; i++) {
      if (!result[i].tipoTrecho) {
        var norm = _normPair_(result[i].idPonto, result[i + 1].idPonto);
        result[i].tipoTrecho = distVia[norm[0] + ':' + norm[1]] || '';
      }
    }
    return result;
  } catch (e) {
    throw new Error('Erro ao ler pontos do esquema ' + idEsquema + ': ' + (e.message || e));
  }
}

/**
 * Retorna o número de pontos de cada esquema informado.
 * @param {string[]} ids  — array de id_esquema
 * @returns {Object}      — { id_esquema: count }
 */
function getContagemPontosEsquemas(ids) {
  try {
    var result = {};
    (ids || []).forEach(function(id) {
      result[String(id)] = EsquemasService.getPontosDoEsquema(id).length;
    });
    return result;
  } catch(e) { return {}; }
}

/**
 * Substitui toda a sequência de pontos de um esquema na aba ESQUEMA_PONTOS.
 * Apaga as linhas existentes do esquema e reinsere com ORDEM 1,2,3...
 * @param {string} idEsquema
 * @param {Array<{idPonto: string, nomePonto: string}>} pontos
 * @returns {boolean}
 */
function salvarSequenciaPontos(idEsquema, pontos) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('ESQUEMA_PONTOS');
    if (!sheet) throw new Error('Aba "ESQUEMA_PONTOS" não encontrada.');

    // Garante cabeçalhos das colunas F, G e H
    var h6 = String(sheet.getLastColumn() >= 6 ? sheet.getRange(1, 6).getValue() : '').trim();
    var h7 = String(sheet.getLastColumn() >= 7 ? sheet.getRange(1, 7).getValue() : '').trim();
    var h8 = String(sheet.getLastColumn() >= 8 ? sheet.getRange(1, 8).getValue() : '').trim();
    if (h6 !== 'horario_comercial') sheet.getRange(1, 6).setValue('horario_comercial');
    if (h7 !== 'tempo_local')       sheet.getRange(1, 7).setValue('tempo_local');
    if (h8 !== 'tipo_trecho')       sheet.getRange(1, 8).setValue('tipo_trecho');

    var idStr = String(idEsquema).trim();
    var lastRow = sheet.getLastRow();

    // Remove todas as linhas do esquema (de baixo para cima para não deslocar índices)
    if (lastRow >= 2) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = ids.length - 1; i >= 0; i--) {
        if (String(ids[i][0]).trim() === idStr) {
          sheet.deleteRow(i + 2);
        }
      }
    }

    // Reinsere com ORDEM sequencial
    pontos.forEach(function(p, idx) {
      sheet.appendRow([idEsquema, idx + 1, p.idPonto, p.nomePonto, p.tipo || '', p.horarioComercial || '', p.tempoLocal !== '' ? p.tempoLocal : '', p.tipoTrecho || '']);
    });

    EsquemasService.invalidateCache();

    // Deriva os trechos (legs) da sequência e salva tipo_via em DISTANCIAS
    var legs = [];
    for (var j = 0; j < pontos.length - 1; j++) {
      legs.push({ pontoA: pontos[j].idPonto, pontoB: pontos[j + 1].idPonto, tipoVia: pontos[j].tipoTrecho || 'BR' });
    }
    _atualizarTipoViaDistancias_(legs);
    _colorirEsquemaPontos_(sheet);

    return true;
  } catch (e) {
    throw new Error('Erro ao salvar sequência: ' + e.message);
  }
}

/**
 * Salva um novo ponto na aba ESQUEMA_PONTOS.
 * @param {{idEsquema: string, ordem: number, idPonto: string, nomePonto: string}} dados
 * @returns {boolean}
 */
function salvarPontoEsquema(dados) {
  try {
    if (!dados.idEsquema || !dados.idPonto || !dados.nomePonto) {
      throw new Error('Campos obrigatórios ausentes.');
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('ESQUEMA_PONTOS');
    if (!sheet) throw new Error('Aba "ESQUEMA_PONTOS" não encontrada.');

    sheet.appendRow([
      dados.idEsquema,
      dados.ordem,
      dados.idPonto,
      dados.nomePonto,
      dados.tipo || ''
    ]);

    EsquemasService.invalidateCache();
    return true;
  } catch (e) {
    throw new Error('Erro ao salvar ponto: ' + e.message);
  }
}

/**
 * Busca distâncias em cache na aba DISTANCIAS.
 * @param {Array<{a:string,b:string}>} pairs
 * @returns {Object} { "normA:normB": km }
 */
function getDistanciasCached(pairs) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('DISTANCIAS');
    if (!sheet || sheet.getLastRow() < 2) return {};

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
    var map  = {};
    data.forEach(function(row) {
      var a = String(row[0]).trim(), b = String(row[1]).trim();
      var km = parseFloat(row[2]);
      var tv = String(row[3] || '').trim();
      if (a && b && km > 0) map[a + ':' + b] = { km: km, tipoVia: tv || 'BR' };
    });

    var result = {};
    (pairs || []).forEach(function(pair) {
      var norm = _normPair_(pair.a, pair.b);
      var key  = norm[0] + ':' + norm[1];
      if (map[key] !== undefined) result[key] = map[key];
    });
    return result;
  } catch (e) {
    return {};
  }
}

/**
 * Salva novas distâncias na aba DISTANCIAS (ignora duplicatas).
 * @param {Array<{a:string,b:string,km:number}>} pairKms
 */
function saveDistanciasCached(pairKms) {
  try {
    if (!pairKms || !pairKms.length) return;
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('DISTANCIAS');
    if (!sheet) {
      sheet = ss.insertSheet('DISTANCIAS');
      sheet.getRange(1, 1, 1, 4).setValues([['codigo_ponto_A', 'codigo_ponto_B', 'km', 'tipo_via']]);
    }

    // Garante que a coluna tipo_via existe e descobre sua posição
    var lastCol = sheet.getLastColumn();
    var tvCol = -1;
    if (lastCol >= 1) {
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      for (var j = 0; j < headers.length; j++) {
        if (String(headers[j]).trim().toLowerCase() === 'tipo_via') { tvCol = j + 1; break; }
      }
    }
    if (tvCol === -1) {
      tvCol = lastCol + 1;
      sheet.getRange(1, tvCol).setValue('tipo_via');
    }

    // Lê pares existentes com seus tipo_via atuais
    // existingMap: key -> { rowIdx (0-based), via }
    var existingMap = {};
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var readCols = Math.max(2, tvCol);
      var sheetData = sheet.getRange(2, 1, lastRow - 1, readCols).getValues();
      sheetData.forEach(function(row, idx) {
        var key = String(row[0]).trim() + ':' + String(row[1]).trim();
        var via = readCols >= tvCol ? String(row[tvCol - 1]).trim() : '';
        existingMap[key] = { rowIdx: idx, via: via };
      });
    }

    var newRows = [], newVias = [];
    var updateVia = []; // { rowIdx, via } para pares existentes com tipo_via vazio

    pairKms.forEach(function(pair) {
      if (!pair.a || !pair.b) return;
      var km      = Math.round(parseFloat(pair.km) * 100) / 100;
      var tipoVia = pair.tipoVia || 'BR';
      var norm    = _normPair_(pair.a, pair.b);
      var key     = norm[0] + ':' + norm[1];

      if (!existingMap[key]) {
        // Par novo: só insere se tiver km válido
        if (km > 0) {
          newRows.push([norm[0], norm[1], km]);
          newVias.push([tipoVia]);
          existingMap[key] = { rowIdx: -1, via: tipoVia }; // evita duplicata no mesmo lote
        }
      } else if (!existingMap[key].via && tipoVia) {
        // Par existente com tipo_via vazio: agenda atualização
        updateVia.push({ rowIdx: existingMap[key].rowIdx, via: tipoVia });
        existingMap[key].via = tipoVia; // evita duplicata no mesmo lote
      }
      // Par existente com tipo_via já definido → preserva, não sobrescreve
    });

    // Insere novos pares
    if (newRows.length) {
      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, newRows.length, 3).setValues(newRows);
      sheet.getRange(startRow, tvCol, newRows.length, 1).setValues(newVias);
    }

    // Atualiza tipo_via em pares existentes que estavam vazios
    updateVia.forEach(function(req) {
      sheet.getRange(req.rowIdx + 2, tvCol).setValue(req.via);
    });

  } catch (e) {
    Logger.log('[saveDistanciasCached] ' + e.message);
  }
}

function _normPair_(a, b) {
  var sa = String(a).trim(), sb = String(b).trim();
  return sa <= sb ? [sa, sb] : [sb, sa];
}

/**
 * Lê o mapa tipo_via da aba DISTANCIAS.
 * @returns {Object} { "normA:normB": tipoVia }
 */
function _lerTipoViaDistancias_() {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('DISTANCIAS');
    if (!sheet || sheet.getLastRow() < 2) return {};
    var lastCol = sheet.getLastColumn();
    if (lastCol < 4) return {};
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var tvIdx = -1;
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i]).trim().toLowerCase() === 'tipo_via') { tvIdx = i; break; }
    }
    if (tvIdx === -1) return {};
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
    var map  = {};
    data.forEach(function(row) {
      var a  = String(row[0]).trim(), b = String(row[1]).trim();
      var tv = String(row[tvIdx]).trim();
      if (a && b && tv) map[a + ':' + b] = tv;
    });
    return map;
  } catch(e) { return {}; }
}

/**
 * Atualiza a coluna tipo_via em DISTANCIAS para cada trecho salvo.
 * Cria a coluna se ainda não existir.
 * @param {Array<{pontoA, pontoB, tipoVia}>} legs
 */
function _atualizarTipoViaDistancias_(legs) {
  if (!legs || !legs.length) return;
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('DISTANCIAS');
    if (!sheet) return;

    // Localiza ou cria coluna tipo_via
    var lastCol  = sheet.getLastColumn();
    var tvCol    = -1;
    if (lastCol >= 1) {
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      for (var j = 0; j < headers.length; j++) {
        if (String(headers[j]).trim().toLowerCase() === 'tipo_via') { tvCol = j + 1; break; }
      }
    }
    if (tvCol === -1) {
      tvCol = lastCol + 1;
      sheet.getRange(1, tvCol).setValue('tipo_via');
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var pairs = sheet.getRange(2, 1, lastRow - 1, 2).getValues();

    legs.forEach(function(leg) {
      if (!leg.pontoA || !leg.pontoB) return;
      var norm = _normPair_(leg.pontoA, leg.pontoB);
      for (var i = 0; i < pairs.length; i++) {
        if (String(pairs[i][0]).trim() === norm[0] && String(pairs[i][1]).trim() === norm[1]) {
          sheet.getRange(i + 2, tvCol).setValue(leg.tipoVia || 'BR');
          break;
        }
      }
    });
  } catch(e) {
    Logger.log('[_atualizarTipoViaDistancias_] ' + e.message);
  }
}

/**
 * Salva ou atualiza a velocidade de um tipo de via para uma linha na aba TIPO_VIA.
 * @param {string} idEsquema
 * @param {string} tipo  — BR | Est | Mun | Urb
 * @param {number} vel   — velocidade em km/h
 */
function salvarTipoViaVelocidade(idEsquema, tipo, vel) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('TIPO_VIA');
    if (!sheet) {
      sheet = ss.insertSheet('TIPO_VIA');
      sheet.getRange(1, 1, 1, 3).setValues([['cod_linha', 'tipo', 'km']]);
    }
    var idStr   = String(idEsquema).trim();
    var tipoStr = String(tipo).trim();
    var velNum  = Math.round(parseFloat(vel) * 10) / 10;
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][0]).trim() === idStr && String(data[i][1]).trim() === tipoStr) {
          sheet.getRange(i + 2, 3).setValue(velNum);
          return true;
        }
      }
    }
    sheet.appendRow([idEsquema, tipoStr, velNum]);
    return true;
  } catch(e) {
    throw new Error('Erro ao salvar velocidade: ' + e.message);
  }
}

/**
 * Retorna as velocidades por tipo de via para um esquema.
 * Prioridade: 1) config da própria linha em TIPO_VIA
 *             2) média das outras linhas configuradas
 *             3) padrões globais (BR=85, Est=75, Mun=60, Urb=45)
 * @param {string} idEsquema
 * @returns {{ BR: number, Est: number, Mun: number, Urb: number }}
 */
function getTipoViaVelocidades(idEsquema) {
  var DEFAULTS = { BR: 85, Est: 75, Mun: 60, Urb: 45 };
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('TIPO_VIA');
    if (!sheet || sheet.getLastRow() < 2) return DEFAULTS;

    var data  = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    var idStr = String(idEsquema).trim();

    var lineVel  = {};
    var otherVel = { BR: [], Est: [], Mun: [], Urb: [] };

    data.forEach(function(row) {
      var cod  = String(row[0]).trim();
      var tipo = String(row[1]).trim();
      var vel  = parseFloat(row[2]);
      if (!tipo || isNaN(vel) || vel <= 0) return;
      if (cod === idStr) {
        lineVel[tipo] = vel;
      } else if (otherVel[tipo] !== undefined) {
        otherVel[tipo].push(vel);
      }
    });

    var result = {};
    ['BR', 'Est', 'Mun', 'Urb'].forEach(function(tipo) {
      if (lineVel[tipo] !== undefined) {
        result[tipo] = lineVel[tipo];
      } else if (otherVel[tipo].length > 0) {
        var sum = otherVel[tipo].reduce(function(a, b) { return a + b; }, 0);
        result[tipo] = Math.round(sum / otherVel[tipo].length);
      } else {
        result[tipo] = DEFAULTS[tipo];
      }
    });

    return result;
  } catch(e) {
    return DEFAULTS;
  }
}

/**
 * Colore as linhas de ESQUEMA_PONTOS por id_esquema.
 * Cores vivas com luminosidade suficiente para texto preto.
 * Relê a aba inteira — todos os esquemas ficam coloridos de forma consistente.
 */
function _colorirEsquemaPontos_(sheet) {
  try {
    var PALETTE = [
      '#FF6B6B', // coral
      '#FFD93D', // amarelo
      '#6BCB77', // verde
      '#4ECDC4', // teal
      '#74B9FF', // azul
      '#FD79A8', // rosa
      '#FDCB6E', // dourado
      '#A29BFE', // lavanda
      '#FF9A3C', // laranja
      '#00CEC9'  // ciano
    ];

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return;

    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

    // Mapeia cada id_esquema para uma cor (ordem de primeira aparição)
    var colorMap = {};
    var paletteIdx = 0;
    ids.forEach(function(row) {
      var id = String(row[0]).trim();
      if (id && colorMap[id] === undefined) {
        colorMap[id] = PALETTE[paletteIdx % PALETTE.length];
        paletteIdx++;
      }
    });

    // Agrupa linhas consecutivas de mesmo esquema em blocos para minimizar chamadas à API
    var blocks = [];
    var cur = null;
    ids.forEach(function(row, i) {
      var id    = String(row[0]).trim();
      var color = id ? colorMap[id] : '#FFFFFF';
      var sheetRow = i + 2;
      if (cur && cur.color === color) {
        cur.end = sheetRow;
      } else {
        cur = { start: sheetRow, end: sheetRow, color: color };
        blocks.push(cur);
      }
    });

    blocks.forEach(function(b) {
      sheet.getRange(b.start, 1, b.end - b.start + 1, lastCol).setBackground(b.color);
    });
  } catch(e) {
    Logger.log('[_colorirEsquemaPontos_] ' + e.message);
  }
}

/**
 * Busca o esquema de uma linha pelo nome e horário.
 * Enriquece cada ponto com entrada, saída, distância e tempo de deslocamento.
 * Retorna { found: true, html } ou { found: false }.
 */
function _getSchemaForLine_(lineName, departureTime) {
  if (!lineName) return { found: false };
  var esquemas = EsquemasService.getEsquemas();
  var normLine = _normSchemaStr_(lineName);
  var match    = null;

  for (var i = 0; i < esquemas.length; i++) {
    var esq       = esquemas[i];
    var eNorm     = _normSchemaStr_(esq.nome_linha || '');
    var timeMatch = !departureTime || (esq.horario || '').trim() === departureTime;
    if (eNorm === normLine && timeMatch) { match = esq; break; }
    if (!match && timeMatch && (eNorm.indexOf(normLine) !== -1 || normLine.indexOf(eNorm) !== -1)) {
      match = esq;
    }
  }

  if (!match) return { found: false };
  var pontos = EsquemasService.getPontosDoEsquema(match.id_esquema);
  if (!pontos || !pontos.length) return { found: false };

  // Tipo de via e velocidades por segmento
  var distVia = _lerTipoViaDistancias_();
  var speeds  = getTipoViaVelocidades(match.id_esquema);

  // Busca distâncias dos pares consecutivos em lote
  var pairs = [];
  for (var i = 0; i < pontos.length - 1; i++) {
    pairs.push({ a: pontos[i].id_ponto, b: pontos[i + 1].id_ponto });
  }
  var distCache = pairs.length ? getDistanciasCached(pairs) : {};

  var enriched = pontos.map(function(p, idx) {
    var ep = {
      ordem:             p.ordem,
      id_ponto:          p.id_ponto,
      nome_ponto:        p.nome_ponto,
      tipo:              p.tipo,
      horario_comercial: p.horario_comercial,
      tempo_local:       p.tempo_local,
      tipo_trecho:       p.tipo_trecho,
    };

    // tipo_trecho do próximo segmento (fallback via DISTANCIAS)
    if (!ep.tipo_trecho && idx < pontos.length - 1) {
      var normPair = _normPair_(p.id_ponto, pontos[idx + 1].id_ponto);
      ep.tipo_trecho = distVia[normPair[0] + ':' + normPair[1]] || '';
    }

    // Distância e tempo de deslocamento até o próximo ponto
    if (idx < pontos.length - 1) {
      var normPair2 = _normPair_(p.id_ponto, pontos[idx + 1].id_ponto);
      var km = distCache[normPair2[0] + ':' + normPair2[1]];
      if (km !== undefined && km > 0) {
        ep.distanciaProxKm = km;
        var vel = (ep.tipo_trecho && speeds[ep.tipo_trecho]) ? speeds[ep.tipo_trecho] : (speeds['BR'] || 85);
        ep.tempoDeslocMin = Math.round(km / vel * 60);
      }
    }

    // Entrada = horario_comercial; Saída = entrada + tempo_local
    if (ep.horario_comercial) {
      ep.entrada = ep.horario_comercial;
      var minLocal = parseInt(ep.tempo_local) || 0;
      if (minLocal > 0) {
        ep.saida = _addMinutes_(ep.horario_comercial, minLocal);
      }
    }

    return ep;
  });

  var html = ReportService.buildEsquemaHtml(enriched, match.nome_linha, match.horario);
  return { found: true, html: html };
}

function _addMinutes_(timeStr, minutes) {
  if (!timeStr || !minutes) return timeStr;
  var parts = String(timeStr).split(':');
  var h = parseInt(parts[0]) || 0;
  var m = parseInt(parts[1]) || 0;
  var total = h * 60 + m + minutes;
  var nh = Math.floor(total / 60) % 24;
  var nm = total % 60;
  return String(nh).padStart(2, '0') + ':' + String(nm).padStart(2, '0');
}

function _normSchemaStr_(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

function doGet(e) {
  var params = (e && e.parameter) || {};

  // ── JSON API ─────────────────────────────────────────────────────────────
  if (params.action) {
    try {
      if (params.action === 'getSchema') {
        var lineName     = (params.lineName     || '').trim();
        var depTime      = (params.departureTime || '').trim();
        var result       = _getSchemaForLine_(lineName, depTime);
        return ContentService.createTextOutput(JSON.stringify(result))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ error: 'unknown_action' }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ error: String(err.message || err) }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  var page = params.page || 'index';

  if (page === 'manager') {
    try {
      return HtmlService.createTemplateFromFile('EsquemasManager')
        .evaluate()
        .setTitle('Gestão de Esquemas · Viação Catedral')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    } catch (err) {
      return HtmlService.createHtmlOutput(
        '<body style="font-family:sans-serif;padding:40px;color:#c62828;">' +
        '<h2>Erro ao carregar Gestão de Esquemas</h2>' +
        '<p style="margin-top:12px;">' + String(err.message || err) + '</p>' +
        '<p style="margin-top:8px;color:#555;">Verifique se o arquivo <strong>EsquemasManager.html</strong> existe no projeto GAS.</p>' +
        '</body>'
      ).setTitle('Erro').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
  }

  const template = HtmlService.createTemplateFromFile("index");
  template.googleMapsApiKey = getGoogleMapsApiKey_();
  template.googleMapsEnabled = !!template.googleMapsApiKey;
  template.webAppUrl = ScriptApp.getService().getUrl();

  Logger.log("googleMapsEnabled=" + template.googleMapsEnabled);

  return template
    .evaluate()
    .setTitle("Analise de Viagem · Viacao Catedral")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/**
 * Retorna esquemas (fresh) + locais com coordenadas para a Web App de gestão.
 * @returns {{ esquemas: Array, locais: Array }}
 */
function getDadosManager() {
  try {
    EsquemasService.invalidateCache();
    var esquemas  = EsquemasService.getEsquemas();
    var terminais = EsquemasService.getTerminaisPorEsquema();
    var locais    = SheetsService.getLocaisParaManager();

    // Mapa código → local (para pegar lat/lng do ponto de partida)
    var locMap = {};
    locais.forEach(function(l) { locMap[String(l.codigo).trim()] = l; });

    esquemas.forEach(function(e) {
      var t = terminais[String(e.id_esquema).trim()]
            || { partida: { nome: '', idPonto: '' }, fim: { nome: '', idPonto: '' } };
      e.partida = t.partida.nome;
      e.fim     = t.fim.nome;
      var loc = t.partida.idPonto ? locMap[String(t.partida.idPonto).trim()] : null;
      e.regiao = (loc && loc.lat != null && loc.lng != null)
        ? GeoUtils.regiaoPorCoord(loc.lat, loc.lng)
        : '';
    });

    return {
      esquemas:          esquemas,
      locais:            locais,
      temposPermanencia: SheetsService.getTemposPermanencia()
    };
  } catch (e) {
    throw new Error('Erro ao carregar dados do manager: ' + e.message);
  }
}

/**
 * Cria um novo esquema na aba ESQUEMAS com ID auto-incrementado.
 * @param {{ nomeLinha: string, horario: string, sentido: string }} dados
 * @returns {{ id: number }}
 */
function criarEsquema(dados) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('ESQUEMAS');
    if (!sheet) throw new Error('Aba "ESQUEMAS" não encontrada.');

    var lastRow = sheet.getLastRow();
    var maxId   = 0;
    if (lastRow >= 2) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      ids.forEach(function(row) {
        var n = parseInt(row[0]);
        if (!isNaN(n) && n > maxId) maxId = n;
      });
    }
    var newId = maxId + 1;
    sheet.appendRow([newId, dados.nomeLinha || '', dados.horario || '', dados.sentido || '']);
    EsquemasService.invalidateCache();
    return { id: newId };
  } catch (e) {
    throw new Error('Erro ao criar esquema: ' + e.message);
  }
}

/**
 * Atualiza NOME_LINHA, HORARIO e SENTIDO de um esquema existente.
 * @param {string} idEsquema
 * @param {{ nomeLinha: string, horario: string, sentido: string }} dados
 * @returns {boolean}
 */
function atualizarEsquema(idEsquema, dados) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('ESQUEMAS');
    if (!sheet) throw new Error('Aba "ESQUEMAS" não encontrada.');

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error('Esquema não encontrado.');

    var ids   = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var idStr = String(idEsquema).trim();

    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === idStr) {
        sheet.getRange(i + 2, 2, 1, 3).setValues([[
          dados.nomeLinha || '',
          dados.horario   || '',
          dados.sentido   || ''
        ]]);
        EsquemasService.invalidateCache();
        return true;
      }
    }
    throw new Error('Esquema #' + idEsquema + ' não encontrado.');
  } catch (e) {
    throw new Error('Erro ao atualizar esquema: ' + e.message);
  }
}

/**
 * Helper para incluir arquivos HTML como templates.
 * Uso no index.html: <?!= include('style') ?>
 * @param {string} filename nome do arquivo sem extensão
 * @returns {string} conteúdo HTML
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getGoogleMapsApiKey_() {
  return (
    PropertiesService.getScriptProperties().getProperty(
      "GOOGLE_MAPS_API_KEY",
    ) || ""
  );
}

// ============================================================
//  API PÚBLICA — chamadas via google.script.run no frontend
// ============================================================

/**
 * Retorna todos os locais ativos da aba LOCAIS.
 * @returns {Array<Object>}
 */
function getLocais() {
  try {
    return SheetsService.getLocais();
  } catch (e) {
    throw new Error("Erro ao carregar locais: " + e.message);
  }
}

/**
 * Cadastra um novo motorista na aba MOTORISTAS e sincroniza com a tabela da API.
 * @param {{matricula:string, nome:string, base:string, ibutton:string}} dados
 * @returns {{matricula:string, nome:string, base:string, ibutton:string}}
 */
function salvarMotorista(dados) {
  try {
    var result = SheetsService.saveMotorista(dados);
    _sincronizarMotoristaComApi(result);
    return result;
  } catch (e) {
    throw new Error('Erro ao salvar motorista: ' + e.message);
  }
}

/**
 * Envia (upsert) os dados do motorista para a tabela drivers da API.
 * Não lança exceção — falha silenciosa para não bloquear o fluxo.
 */
function _sincronizarMotoristaComApi(motorista) {
  try {
    var props   = PropertiesService.getScriptProperties();
    var baseUrl = (props.getProperty('REPORT_API_URL') || '').replace(/\/$/, '');
    if (!baseUrl) return;

    var mat  = String(motorista.matricula || '').trim();
    var nome = String(motorista.nome      || '').trim();
    var base = String(motorista.base      || '').trim() || null;

    if (!nome) return;
    var code = mat || nome;

    UrlFetchApp.fetch(baseUrl + '/drivers/upsert', {
      method:      'post',
      contentType: 'application/json',
      payload:     JSON.stringify({ code: code, name: nome, base: base }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log('[salvarMotorista] Falha ao sincronizar com API: ' + e.message);
  }
}

/**
 * Atualiza o iButton de um motorista já cadastrado.
 * Busca por matrícula ou nome e preenche a coluna 4 (IBUTTON).
 * @param {string} matricula
 * @param {string} nome
 * @param {string} ibutton
 * @returns {boolean}
 */
function atualizarIbuttonMotorista(matricula, nome, ibutton) {
  try {
    return SheetsService.updateMotoristaIbutton(matricula, nome, ibutton);
  } catch (e) {
    return false;
  }
}

/**
 * Retorna todos os motoristas cadastrados na aba MOTORISTAS.
 * @returns {Array<Object>}
 */
function getMotoristas() {
  try {
    return SheetsService.getMotoristas();
  } catch (e) {
    return [];
  }
}

/**
 * Processa o texto CSV do relatório:
 * faz parse, cruzamento com LOCAIS e retorna array enriquecido.
 * @param {string} csvText
 * @returns {Array<Object>} enrichedTrip[]
 */
function processReport(csvText) {
  try {
    return AnalysisService.processReport(csvText);
  } catch (e) {
    throw new Error("Erro ao processar relatório: " + e.message);
  }
}

/**
 * Analisa a viagem enriquecida:
 * calcula segmentos, velocidades e alertas.
 * @param {Array<Object>} enrichedTrip
 * @returns {{ segments: Array, alerts: Array, summary: Object }}
 */
function analyzeTrip(enrichedTrip) {
  try {
    return AnalysisService.analyzeTrip(enrichedTrip);
  } catch (e) {
    throw new Error("Erro ao analisar viagem: " + e.message);
  }
}

/**
 * Calcula o bounding box para fitBounds no mapa.
 * @param {Array<{lat: number, lng: number}>} points
 * @returns {Object}
 */
function getBoundingBox(points) {
  try {
    return MapService.getBoundingBox(points);
  } catch (e) {
    return null;
  }
}

/**
 * Retorna dados iniciais para a aplicação:
 * lista de esquemas ativos e lista de motoristas.
 * @returns {{ esquemas: Array, motoristas: Array }}
 */
function getDadosIniciais() {
  try {
    var esquemas = EsquemasService.getEsquemas();
    var motoristas = SheetsService.getMotoristas();
    return { esquemas: esquemas, motoristas: motoristas };
  } catch (e) {
    throw new Error("Erro ao carregar dados iniciais: " + e.message);
  }
}

/**
 * Invalida o cache de esquemas e retorna a lista atualizada da planilha.
 * Chamado pelo botão de refresh no combobox de esquemas.
 * @returns {Array} lista de esquemas
 */
function refreshEsquemas() {
  try {
    EsquemasService.invalidateCache();
    return EsquemasService.getEsquemas();
  } catch (e) {
    throw new Error("Erro ao atualizar esquemas: " + e.message);
  }
}

/**
 * Retorna os pontos de um esquema específico, ordenados por ORDEM.
 * @param {string} idEsquema
 * @returns {Array<Object>}
 */
function getEsquemaPontos(idEsquema) {
  try {
    return EsquemasService.getPontosDoEsquema(idEsquema);
  } catch (e) {
    throw new Error("Erro ao carregar pontos do esquema: " + e.message);
  }
}

/**
 * Gera relatório operacional (por motorista ou por trecho).
 * Se params.enviarAPI === true, também envia para a API externa.
 *
 * @param {Object} params
 * @param {string} params.tipo        — 'MOTORISTA' | 'TRECHO'
 * @param {boolean} [params.enviarAPI]  — se true, envia para a API
 * @returns {{ payload: Object, apiResponse?: Object }}
 */
function gerarRelatorio(params) {
  try {
    var payload = null;

    if (params.tipo === "MOTORISTA") {
      payload = ReportService.gerarRelatorioMotorista(params);
    } else if (params.tipo === "TRECHO") {
      payload = ReportService.gerarRelatorioTrecho(params);
    } else if (params.tipo === "COMPLETO") {
      payload = ReportService.gerarRelatorioCompleto(params);
    } else {
      throw new Error("Tipo de relatório inválido: " + params.tipo);
    }

    if (params.enviarAPI) {
      // Passa params junto (contém enrichedTrip, summary, nomeLinha, etc.)
      var apiResponse = ReportService.enviarParaAPI(payload, params);
      return { payload: payload, apiResponse: apiResponse };
    }

    return { payload: payload };
  } catch (e) {
    throw new Error("Erro ao gerar relatório: " + e.message);
  }
}

/**
 * Cria ocorrências DESCUMP_OP_PARADA_FORA para cada parada fora do esquema.
 * Aceita o mesmo `params` passado para gerarRelatorio.
 *
 * @param {Object} params
 * @returns {Array}  [{ ponto, status, id?, httpCode?, message? }]
 */
function enviarParadasFora(params) {
  try {
    return ReportService.enviarParadasFora(params);
  } catch (e) {
    throw new Error("Erro ao enviar paradas fora: " + e.message);
  }
}
