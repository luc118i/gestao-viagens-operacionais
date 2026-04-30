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
    return pontos.map(function(p) {
      return { idPonto: p.id_ponto, nomePonto: p.nome_ponto, tipo: p.tipo || '' };
    });
  } catch (e) {
    return [];
  }
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
      sheet.appendRow([idEsquema, idx + 1, p.idPonto, p.nomePonto, p.tipo || '']);
    });

    EsquemasService.invalidateCache();
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

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'index';

  if (page === 'manager') {
    try {
      return HtmlService.createHtmlOutputFromFile('EsquemasManager')
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
    return {
      esquemas: EsquemasService.getEsquemas(),
      locais:   SheetsService.getLocaisParaManager()
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
 * Cadastra um novo motorista na aba MOTORISTAS.
 * @param {{matricula:string, nome:string, base:string, ibutton:string}} dados
 * @returns {{matricula:string, nome:string, base:string, ibutton:string}}
 */
function salvarMotorista(dados) {
  try {
    return SheetsService.saveMotorista(dados);
  } catch (e) {
    throw new Error('Erro ao salvar motorista: ' + e.message);
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
