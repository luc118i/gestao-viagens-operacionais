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
 * Retorna os pontos de TODOS os esquemas (mesmo formato camelCase de
 * getPontosEsquemaParaFormulario), em uma única leitura. Usado na geração de
 * PDFs em lote.
 * @returns {Object<string, Array>}  { id_esquema: [ {idPonto, nomePonto, ...} ] }
 */
function getTodosPontosParaFormulario() {
  try {
    var by      = EsquemasService.getPontosTodosEsquemas();
    var distVia = _lerTipoViaDistancias_();
    var out = {};
    Object.keys(by).forEach(function(id) {
      var result = by[id].map(function(p) {
        return { idPonto: p.id_ponto, nomePonto: p.nome_ponto, tipo: p.tipo || '', horarioComercial: p.horario_comercial || '', tempoLocal: p.tempo_local || '', tipoTrecho: p.tipo_trecho || '' };
      });
      for (var i = 0; i < result.length - 1; i++) {
        if (!result[i].tipoTrecho) {
          var norm = _normPair_(result[i].idPonto, result[i + 1].idPonto);
          result[i].tipoTrecho = distVia[norm[0] + ':' + norm[1]] || '';
        }
      }
      out[id] = result;
    });
    return out;
  } catch (e) {
    throw new Error('Erro ao ler pontos de todos os esquemas: ' + (e.message || e));
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
 * Converte uma lista de HTMLs (um por esquema) em PDFs reais e devolve cada um
 * em base64. Usa o conversor nativo do Google (Utilities.newBlob →
 * getAs('application/pdf')), confiável para HTML/CSS server-side. O rodapé NÃO é
 * incluído aqui — o cliente o carimba em todas as páginas via pdf-lib, já que o
 * conversor do Google não fixa rodapé por página.
 *
 * @param {Array<{name:string, html:string}>} items
 * @returns {Array<{name:string, b64:string}>}  PDFs (nomes únicos) em base64.
 */
function gerarPdfsEsquemas(items) {
  if (!items || !items.length) throw new Error('Nenhum esquema para gerar.');
  var usados = {};  // evita nomes repetidos no zip final
  return items.map(function(it, i) {
    var nome = String(it.name || ('esquema_' + (i + 1) + '.pdf')).replace(/[\\/:*?"<>|]/g, '-');
    if (!/\.pdf$/i.test(nome)) nome += '.pdf';
    var aberto = nome.replace(/\.pdf$/i, ''), n = 1, unico = nome;
    while (usados[unico.toLowerCase()]) { n++; unico = aberto + ' (' + n + ').pdf'; }
    usados[unico.toLowerCase()] = true;
    var pdf = Utilities
      .newBlob(it.html || '', 'text/html', unico.replace(/\.pdf$/i, '.html'))
      .getAs('application/pdf');
    return { name: unico, b64: Utilities.base64Encode(pdf.getBytes()) };
  });
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

// ============================================================
//  ANÁLISE DE ESQUEMA — regras determinísticas + IA (Groq)
//  Aponta o que está fora do comum num esquema (ex.: encerramento
//  incompatível com o nome da linha, ponto sem coordenada, etc.).
// ============================================================

/**
 * Analisa um esquema: regras locais + (opcional) IA via Groq.
 * @param {string} idEsquema
 * @param {boolean} usarIA
 * @returns {{ idEsquema, nomeLinha, regras:Array, ia:Object|null }}
 */
function analisarEsquema(idEsquema, usarIA) {
  try {
    var esq = null;
    EsquemasService.getEsquemas().forEach(function(e) {
      if (String(e.id_esquema).trim() === String(idEsquema).trim()) esq = e;
    });
    if (!esq) throw new Error('Esquema não encontrado.');

    var pontos = EsquemasService.getPontosDoEsquema(idEsquema) || [];
    var locMap = {};
    SheetsService.getLocaisParaManager().forEach(function(l) { locMap[String(l.codigo).trim()] = l; });

    var resultado = {
      idEsquema: idEsquema,
      nomeLinha: esq.nome_linha,
      regras: _analisarRegras_(esq, pontos, locMap),
      ia: null
    };
    if (usarIA) {
      try { resultado.ia = _chamarGroq_(_resumoEsquema_(esq, pontos, locMap)); }
      catch (e) { resultado.ia = { erro: String(e.message || e) }; }
    }
    return resultado;
  } catch (e) {
    throw new Error('Erro ao analisar esquema: ' + (e.message || e));
  }
}

/**
 * Analisa vários esquemas em conjunto, numa única chamada de IA, para detectar
 * inconsistências ENTRE as linhas (mesmo local com horários divergentes,
 * partida/encerramento incoerentes, pontos cadastrados de formas diferentes…).
 * As regras determinísticas continuam rodando por esquema e voltam agregadas.
 * @param {string[]} idsEsquema
 * @param {boolean} usarIA
 * @returns {{quantidade:number, esquemas:Array, regras:Array, ia:Object}}
 */
function analisarEsquemasEmGrupo(idsEsquema, usarIA) {
  try {
    var ids = (idsEsquema || []).map(function(x) { return String(x).trim(); }).filter(Boolean);
    if (!ids.length) throw new Error('Nenhum esquema selecionado.');

    var locMap = {};
    SheetsService.getLocaisParaManager().forEach(function(l) { locMap[String(l.codigo).trim()] = l; });

    var todos = EsquemasService.getEsquemas();
    var porId = {};
    todos.forEach(function(e) { porId[String(e.id_esquema).trim()] = e; });

    var itens = [];           // { esq, pontos }
    var regrasAgreg = [];     // [{ idEsquema, nomeLinha, regras:[…] }]
    ids.forEach(function(id) {
      var esq = porId[id];
      if (!esq) return;
      var pontos = EsquemasService.getPontosDoEsquema(id) || [];
      itens.push({ esq: esq, pontos: pontos });
      regrasAgreg.push({
        idEsquema: id,
        nomeLinha: esq.nome_linha,
        regras: _analisarRegras_(esq, pontos, locMap)
      });
    });
    if (!itens.length) throw new Error('Nenhum dos esquemas selecionados foi encontrado.');

    var resultado = {
      quantidade: itens.length,
      esquemas: itens.map(function(it) { return { idEsquema: it.esq.id_esquema, nomeLinha: it.esq.nome_linha }; }),
      regras: regrasAgreg,
      ia: null
    };
    if (usarIA) {
      try { resultado.ia = _chamarGroqGrupo_(_resumoGrupo_(itens, locMap)); }
      catch (e) { resultado.ia = { erro: String(e.message || e) }; }
    }
    return resultado;
  } catch (e) {
    throw new Error('Erro ao analisar grupo: ' + (e.message || e));
  }
}

/** Monta o resumo textual de vários esquemas para a IA comparar entre si. */
function _resumoGrupo_(itens, locMap) {
  var blocos = itens.map(function(it, idx) {
    return '=== ESQUEMA ' + (idx + 1) + ' (#' + it.esq.id_esquema + ') ===\n' + _resumoEsquema_(it.esq, it.pontos, locMap);
  }).join('\n\n');
  return 'Total de esquemas no grupo: ' + itens.length + '\n\n' + blocos;
}

/** Chama a Groq para a análise comparativa de um grupo de esquemas. */
function _chamarGroqGrupo_(resumo) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('GROQ_API_KEY');
  if (!key) return { erro: 'Chave GROQ_API_KEY não configurada nas Script Properties.' };
  var model = props.getProperty('GROQ_MODEL') || 'llama-3.3-70b-versatile';
  var sys = 'Você é um analista de rotas rodoviárias interestaduais no Brasil. Recebe vários esquemas de viagem (cada um com sua sequência de paradas) e deve compará-los ENTRE SI, apontando APENAS o que está claramente fora do comum: '
    + 'um mesmo local (mesmo código) aparecendo com horários comerciais divergentes em linhas diferentes; partidas/encerramentos incoerentes com o nome da linha; cidades fora de ordem geográfica; o mesmo ponto cadastrado de formas diferentes; desvios grandes; e qualquer inconsistência relevante entre os esquemas. '
    + 'Organize a resposta em bullets curtos, agrupando por tema e sempre citando os esquemas (pelo #) envolvidos. Se os esquemas forem coerentes entre si, diga que não encontrou inconsistências. Não invente dados que não estão no resumo.';
  var payload = {
    model: model, temperature: 0.2, max_tokens: 1200,
    messages: [{ role: 'system', content: sys }, { role: 'user', content: resumo }]
  };
  var res = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) return { erro: 'Groq HTTP ' + code + ': ' + String(body).slice(0, 300) };
  var data = JSON.parse(body);
  var texto = (data && data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : '';
  return { texto: String(texto || '').trim(), model: model };
}

/** Normaliza: maiúsculo, sem acento. */
function _upNorm_(s) { return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

/** Extrai os dois extremos do nome da linha (ex.: "NATAL X SAO PAULO VIA APODI" → [NATAL, SAO PAULO]). */
function _linhaEndpoints_(nomeLinha) {
  var s = _upNorm_(nomeLinha).replace(/\([^)]*\)/g, ' ').replace(/\bVIA\b[\s\S]*/, ' ');
  var parts = s.split(/\s+[X\-]\s+/).map(function(t) { return t.trim(); }).filter(Boolean);
  if (parts.length < 2) return [];
  return [parts[0], parts[parts.length - 1]];
}

/** Regras determinísticas de anomalia. Retorna [{nivel, tipo, msg}]. */
function _analisarRegras_(esq, pontos, locMap) {
  var out = [];
  var eps = _linhaEndpoints_(esq.nome_linha);

  var reais = pontos.filter(function(p) { return !/garagem/i.test(p.nome_ponto || '') && !/fechamento/i.test(p.tipo || ''); });
  var prim = reais[0], ult = reais[reais.length - 1];
  if (eps.length === 2 && prim && ult) {
    var nP = _upNorm_(prim.nome_ponto), nU = _upNorm_(ult.nome_ponto);
    if (!eps.some(function(c) { return nP.indexOf(c) !== -1; }))
      out.push({ nivel: 'alto', tipo: 'partida', msg: 'Partida "' + prim.nome_ponto + '" não corresponde aos extremos da linha (' + eps.join(' / ') + ').' });
    if (!eps.some(function(c) { return nU.indexOf(c) !== -1; }))
      out.push({ nivel: 'alto', tipo: 'encerramento', msg: 'Encerramento "' + ult.nome_ponto + '" não corresponde aos extremos da linha (' + eps.join(' / ') + ').' });
  }

  var semCoord = [];
  pontos.forEach(function(p) {
    var l = locMap[String(p.id_ponto).trim()];
    if (!l) out.push({ nivel: 'medio', tipo: 'cadastro', msg: 'Ponto "' + (p.nome_ponto || p.id_ponto) + '" (cód ' + p.id_ponto + ') não está na base LOCAIS.' });
    else if (l.lat == null || l.lng == null) semCoord.push(p.nome_ponto || p.id_ponto);
  });
  if (semCoord.length)
    out.push({ nivel: 'medio', tipo: 'coordenada', msg: semCoord.length + ' ponto(s) sem coordenada (ficam fora do mapa e do cálculo): ' + semCoord.slice(0, 5).join(', ') + (semCoord.length > 5 ? '…' : '') });

  for (var i = 1; i < pontos.length; i++) {
    if (String(pontos[i - 1].id_ponto).trim() === String(pontos[i].id_ponto).trim())
      out.push({ nivel: 'alto', tipo: 'duplicado', msg: 'Ponto repetido em sequência: "' + (pontos[i].nome_ponto || pontos[i].id_ponto) + '" (posições ' + i + ' e ' + (i + 1) + ').' });
  }
  return out;
}

/** Monta o resumo textual do esquema para a IA. */
function _resumoEsquema_(esq, pontos, locMap) {
  var linhas = pontos.map(function(p, i) {
    var l = locMap[String(p.id_ponto).trim()] || {};
    var coord = (l.lat != null && l.lng != null) ? (Number(l.lat).toFixed(4) + ',' + Number(l.lng).toFixed(4)) : 'SEM COORD';
    var hc = p.horario_comercial ? (' | comercial ' + p.horario_comercial) : '';
    return (i + 1) + '. ' + (p.nome_ponto || p.id_ponto) + ' [cód ' + p.id_ponto + ' | ' + coord + (p.tipo ? ' | ' + p.tipo : '') + hc + ']';
  }).join('\n');
  return 'Linha: ' + esq.nome_linha
    + '\nHorário de partida: ' + (esq.horario || '?')
    + '\nSentido: ' + (esq.sentido || '?')
    + '\nTotal de pontos: ' + pontos.length
    + '\n\nSequência de paradas (em ordem):\n' + linhas;
}

/** Chama a Groq (API compatível com OpenAI) via UrlFetchApp. */
function _chamarGroq_(resumo) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('GROQ_API_KEY');
  if (!key) return { erro: 'Chave GROQ_API_KEY não configurada nas Script Properties.' };
  var model = props.getProperty('GROQ_MODEL') || 'llama-3.3-70b-versatile';
  var sys = 'Você é um analista de rotas rodoviárias interestaduais no Brasil. Recebe a sequência de paradas de um esquema de viagem e aponta APENAS o que está claramente fora do comum: '
    + 'encerramento ou partida incompatível com o nome da linha; cidades fora de ordem geográfica; desvios grandes; paradas que não fazem sentido para o trajeto; possíveis erros de cadastro. '
    + 'Responda em português, com bullets curtos e diretos, citando a posição do ponto. Se estiver tudo coerente, diga que não encontrou anomalias. Não invente dados que não estão no resumo.';
  var payload = {
    model: model, temperature: 0.2, max_tokens: 800,
    messages: [{ role: 'system', content: sys }, { role: 'user', content: resumo }]
  };
  var res = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) return { erro: 'Groq HTTP ' + code + ': ' + String(body).slice(0, 300) };
  var data = JSON.parse(body);
  var texto = (data && data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : '';
  return { texto: String(texto || '').trim(), model: model };
}

// ============================================================
//  AJUSTE DE ROTA — sobreposição de distância/tempo por trecho A→B
//  Guardado por par de pontos (cod_a, cod_b) na aba ROTAS_AJUSTADAS.
//  Vale para TODA linha que tem A e B consecutivos (nos dois sentidos),
//  sem reescrever esquema: o cálculo de horário consulta o ajuste.
// ============================================================

var _ROTAS_SHEET = 'ROTAS_AJUSTADAS';
var _ROTAS_HEADER = ['cod_a', 'cod_b', 'nome_a', 'nome_b', 'distancia_km', 'tempo_min', 'via_coords', 'motivo', 'ativo', 'data'];

/** Retorna (criando se preciso) a aba de rotas ajustadas, com cabeçalho. */
function _getRotasSheet_(criar) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(_ROTAS_SHEET);
  if (!sheet && criar) {
    sheet = ss.insertSheet(_ROTAS_SHEET);
    sheet.getRange(1, 1, 1, _ROTAS_HEADER.length).setValues([_ROTAS_HEADER]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Lê todos os ajustes de rota ativos.
 * @returns {Array<{codA,codB,nomeA,nomeB,km,min,viaCoords,motivo}>}
 */
function getRotasAjustadas() {
  try {
    var sheet = _getRotasSheet_(false);
    if (!sheet) return [];
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    var data = sheet.getRange(2, 1, lastRow - 1, _ROTAS_HEADER.length).getValues();
    var out = [];
    data.forEach(function(r) {
      var codA = String(r[0]).trim(), codB = String(r[1]).trim();
      if (!codA || !codB) return;
      var ativo = String(r[8]).trim().toUpperCase();
      if (ativo === 'F' || ativo === 'N' || ativo === '0') return; // inativo
      out.push({
        codA: codA, codB: codB,
        nomeA: String(r[2] || '').trim(), nomeB: String(r[3] || '').trim(),
        km:  Number(r[4]) || 0,
        min: Number(r[5]) || 0,
        viaCoords: String(r[6] || ''),
        motivo: String(r[7] || '').trim()
      });
    });
    return out;
  } catch (e) {
    throw new Error('Erro ao ler rotas ajustadas: ' + (e.message || e));
  }
}

/**
 * Cria/atualiza o ajuste de um trecho (chave = cod_a + cod_b).
 * @param {{codA,codB,nomeA,nomeB,km,min,viaCoords,motivo}} d
 * @returns {{codA,codB}}
 */
function salvarRotaAjustada(d) {
  try {
    d = d || {};
    var codA = String(d.codA || '').trim();
    var codB = String(d.codB || '').trim();
    if (!codA || !codB) throw new Error('Os pontos A e B são obrigatórios.');
    if (codA === codB)  throw new Error('A e B não podem ser o mesmo ponto.');
    var km  = Number(String(d.km).replace(',', '.'));
    var min = Number(String(d.min).replace(',', '.'));
    if (!(km > 0) && !(min > 0)) throw new Error('Informe a distância (km) e/ou o tempo (min).');

    var sheet = _getRotasSheet_(true);
    var row = [codA, codB, String(d.nomeA || ''), String(d.nomeB || ''),
              km > 0 ? km : '', min > 0 ? min : '', String(d.viaCoords || ''),
              String(d.motivo || ''), 'T', Utilities.formatDate(new Date(), ss_tz_(), 'yyyy-MM-dd HH:mm:ss')];

    // Procura linha existente do mesmo trecho
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var keys = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      for (var i = 0; i < keys.length; i++) {
        if (String(keys[i][0]).trim() === codA && String(keys[i][1]).trim() === codB) {
          sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
          return { codA: codA, codB: codB };
        }
      }
    }
    sheet.appendRow(row);
    return { codA: codA, codB: codB };
  } catch (e) {
    throw new Error('Erro ao salvar ajuste de rota: ' + (e.message || e));
  }
}

/** Remove o ajuste de um trecho. */
function excluirRotaAjustada(codA, codB) {
  try {
    codA = String(codA).trim(); codB = String(codB).trim();
    var sheet = _getRotasSheet_(false);
    if (!sheet) return false;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return false;
    var keys = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = keys.length - 1; i >= 0; i--) {
      if (String(keys[i][0]).trim() === codA && String(keys[i][1]).trim() === codB) {
        sheet.deleteRow(i + 2);
        return true;
      }
    }
    return false;
  } catch (e) {
    throw new Error('Erro ao excluir ajuste de rota: ' + (e.message || e));
  }
}

/** Fuso da planilha (helper). */
function ss_tz_() {
  try { return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(); }
  catch (e) { return 'America/Sao_Paulo'; }
}

// ============================================================
//  EDIÇÃO EM MASSA — substituir ponto / inserir entre pontos
//  Todas as operações suportam dry-run (aplicar=false) para preview.
//  Leitura e escrita em bloco: 1 getValues + 1 setValues.
// ============================================================

/**
 * Lê toda a aba ESQUEMA_PONTOS (cols A..H) agrupada e ordenada por esquema.
 * @returns {{ byEsq: Object<string,Array>, order: string[] }}
 */
function _bulkLerPontos_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { byEsq: {}, order: [] };
  var data  = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var byEsq = {}, order = [];
  data.forEach(function(r) {
    var esq = String(r[0]).trim();
    if (!esq) return;
    if (!byEsq[esq]) { byEsq[esq] = []; order.push(esq); }
    byEsq[esq].push({
      ordem: Number(r[1]) || 0,
      cod:   String(r[2]).trim(),
      nome:  String(r[3]).trim(),
      tipo:  r[4], hc: r[5], tl: r[6], tt: r[7]
    });
  });
  Object.keys(byEsq).forEach(function(k) {
    byEsq[k].sort(function(a, b) { return a.ordem - b.ordem; });
  });
  return { byEsq: byEsq, order: order };
}

/**
 * Reescreve a aba ESQUEMA_PONTOS inteira a partir do mapa, renumerando ORDEM.
 */
function _bulkEscreverPontos_(sheet, byEsq, order) {
  var out = [];
  order.forEach(function(esq) {
    byEsq[esq].forEach(function(p, idx) {
      out.push([esq, idx + 1, p.cod, p.nome, p.tipo || '', p.hc || '', p.tl !== '' ? p.tl : '', p.tt || '']);
    });
  });
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) sheet.getRange(2, 1, lastRow - 1, 8).clearContent();
  if (out.length)  sheet.getRange(2, 1, out.length, 8).setValues(out);
}

/**
 * Substitui o ponto X pelo ponto Y em TODOS os esquemas que contêm X.
 * Esquemas que já contêm Y são pulados (evita parada duplicada).
 * In-place: preserva ordem, tempos e tipo de trecho das linhas alteradas.
 * @param {string} codX  código do ponto a remover
 * @param {string} codY  código do ponto destino
 * @param {string} nomeY nome do ponto destino
 * @param {boolean} aplicar  false = dry-run (preview), true = grava
 * @returns {{ applied: string[], skipped: Array<{id:string,motivo:string}> }}
 */
function substituirPontoEmMassa(codX, codY, nomeY, aplicar) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('ESQUEMA_PONTOS');
    if (!sheet) throw new Error('Aba "ESQUEMA_PONTOS" não encontrada.');

    codX = String(codX).trim();
    codY = String(codY).trim();
    if (!codX || !codY) throw new Error('Pontos de origem e destino são obrigatórios.');
    if (codX === codY)  throw new Error('Os pontos de origem e destino são iguais.');

    var d = _bulkLerPontos_(sheet);
    var applied = [], skipped = [];

    d.order.forEach(function(esq) {
      var pts  = d.byEsq[esq];
      if (!pts.some(function(p) { return p.cod === codX; })) return; // não tem X
      if (pts.some(function(p) { return p.cod === codY; })) {
        skipped.push({ id: esq, motivo: 'já contém o ponto destino' });
        return;
      }
      if (aplicar) {
        pts.forEach(function(p) { if (p.cod === codX) { p.cod = codY; p.nome = String(nomeY || codY); } });
      }
      applied.push(esq);
    });

    if (aplicar && applied.length) {
      _bulkEscreverPontos_(sheet, d.byEsq, d.order);
      EsquemasService.invalidateCache();
      _colorirEsquemaPontos_(sheet);
    }
    return { applied: applied, skipped: skipped };
  } catch (e) {
    throw new Error('Erro ao substituir ponto: ' + (e.message || e));
  }
}

/**
 * Insere um ou mais pontos entre A e B em todos os esquemas onde A e B são
 * paradas CONSECUTIVAS. Trata os dois sentidos: A→B insere na ordem dada;
 * B→A (volta) insere na ordem espelhada. O tipo de trecho dos novos legs
 * herda o tipo_trecho do trecho A→B original.
 * @param {string} codA
 * @param {string} codB
 * @param {Array<{cod:string,nome:string,tipo?:string}>} novos
 * @param {boolean} aplicar  false = dry-run (preview), true = grava
 * @returns {{ applied: string[], skipped: Array<{id:string,motivo:string}> }}
 */
function inserirEntrePontosEmMassa(codA, codB, novos, aplicar) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('ESQUEMA_PONTOS');
    if (!sheet) throw new Error('Aba "ESQUEMA_PONTOS" não encontrada.');

    codA = String(codA).trim();
    codB = String(codB).trim();
    if (!codA || !codB) throw new Error('Os pontos A e B são obrigatórios.');
    if (codA === codB)  throw new Error('Os pontos A e B são iguais.');
    novos = (novos || []).map(function(n) {
      return { cod: String(n.cod).trim(), nome: String(n.nome || n.cod).trim(), tipo: n.tipo || '' };
    }).filter(function(n) { return n.cod; });
    if (!novos.length) throw new Error('Nenhum ponto para inserir.');

    var d = _bulkLerPontos_(sheet);
    var applied = [], skipped = [];

    d.order.forEach(function(esq) {
      var pts = d.byEsq[esq];
      var res = [], changed = false;
      for (var i = 0; i < pts.length; i++) {
        res.push(pts[i]);
        var cur = pts[i], nxt = pts[i + 1];
        if (!nxt) continue;
        var seq = null;
        if (cur.cod === codA && nxt.cod === codB) seq = novos;                 // ida
        else if (cur.cod === codB && nxt.cod === codA) seq = novos.slice().reverse(); // volta
        if (seq) {
          seq.forEach(function(n) {
            res.push({ ordem: 0, cod: n.cod, nome: n.nome, tipo: n.tipo, hc: '', tl: '', tt: cur.tt });
          });
          changed = true;
        }
      }
      if (changed) { if (aplicar) d.byEsq[esq] = res; applied.push(esq); }
    });

    if (aplicar && applied.length) {
      _bulkEscreverPontos_(sheet, d.byEsq, d.order);
      EsquemasService.invalidateCache();
      _colorirEsquemaPontos_(sheet);
    }
    return { applied: applied, skipped: skipped };
  } catch (e) {
    throw new Error('Erro ao inserir pontos: ' + (e.message || e));
  }
}

// ============================================================
//  CADASTRO DE LOCAL (aba LOCAIS) — novo ponto
// ============================================================

/**
 * Retorna o maior código numérico da aba LOCAIS + 1, como sugestão de código
 * para um novo ponto. Códigos não numéricos são ignorados no cálculo.
 * @returns {string}
 */
function getProximoCodigoLocal() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('LOCAIS');
    if (!sheet) return '1';
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return '1';
    var col = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var max = 0;
    col.forEach(function(r) {
      var n = parseInt(String(r[0]).trim(), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return String(max + 1);
  } catch (e) {
    return '';
  }
}

/** Converte booleano do formulário em flag 'T'/'F' (convenção do exportador). */
function _boolFlag_(v) { return v ? 'T' : 'F'; }

/** Número ou '' (não grava 0 indevido em campos vazios). */
function _numOrEmpty_(v) {
  if (v === null || v === undefined || String(v).trim() === '') return '';
  var n = Number(String(v).replace(',', '.'));
  return isNaN(n) ? '' : n;
}

/**
 * Cadastra um novo ponto na aba LOCAIS (26 colunas, A..Z).
 * Valida que o código não existe e que descrição foi informada.
 * @param {Object} d  campos do formulário
 * @returns {{ codigo:string, descricao:string, tipo:string, lat:(number|null), lng:(number|null) }}
 */
function cadastrarLocal(d) {
  try {
    d = d || {};
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('LOCAIS');
    if (!sheet) throw new Error('Aba "LOCAIS" não encontrada.');

    var codigo = String(d.codigo || '').trim();
    var descricao = String(d.descricao || '').trim();
    if (!codigo)    throw new Error('O código é obrigatório.');
    if (!descricao) throw new Error('A descrição é obrigatória.');

    // Valida duplicidade de código
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var cods = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < cods.length; i++) {
        if (String(cods[i][0]).trim() === codigo) {
          throw new Error('Já existe um local com o código ' + codigo + '.');
        }
      }
    }

    var lat = _numOrEmpty_(d.latitude);
    var lng = _numOrEmpty_(d.longitude);

    // Monta a linha na ordem das colunas A..Z (0..25)
    var row = [];
    row[0]  = codigo;                              // Código
    row[1]  = String(d.codEmb || '').trim();       // Cód. Emb.
    row[2]  = String(d.descResumida || '').trim(); // Desc. Resumida
    row[3]  = descricao;                           // Descrição
    row[4]  = String(d.unidade || '').trim();      // Unidade Empresarial
    row[5]  = String(d.tipo || '').trim();         // Tipo
    row[6]  = _numOrEmpty_(d.ajusteHorario);       // Ajuste Horário
    row[7]  = _numOrEmpty_(d.raio);                // Raio
    row[8]  = _numOrEmpty_(d.raioAdvert);          // Raio Advert.
    row[9]  = _numOrEmpty_(d.vel);                 // Vel.
    row[10] = String(d.grupoPc || '').trim();      // Grupo PC.
    row[11] = _numOrEmpty_(d.distVel);             // Dist. uso vel.
    row[12] = String(d.codigoExterno || '').trim();// Código externo
    row[13] = _boolFlag_(d.ativo);                 // Ativo
    row[14] = _boolFlag_(d.pedagio);               // Pedágio
    row[15] = _boolFlag_(d.rodoviaria);            // Rodoviária
    row[16] = _boolFlag_(d.suspensao);             // Suspensão
    row[17] = _boolFlag_(d.garagem);               // Garagem
    row[18] = _boolFlag_(d.online);                // Online
    row[19] = _boolFlag_(d.auxiliar);              // Auxiliar
    row[20] = _boolFlag_(d.seletivo);              // Seletivo
    row[21] = _boolFlag_(d.pontoVel);              // Ponto Vel.
    row[22] = _boolFlag_(d.areaVel);               // Area Vel.
    row[23] = String(d.direcoes || '').trim();     // Direções
    row[24] = lat;                                 // Latitude
    row[25] = lng;                                 // Longitude

    sheet.appendRow(row);

    return {
      codigo:    codigo,
      descricao: descricao,
      tipo:      row[5],
      lat:       lat === '' ? null : lat,
      lng:       lng === '' ? null : lng
    };
  } catch (e) {
    throw new Error('Erro ao cadastrar local: ' + (e.message || e));
  }
}

/**
 * Importa vários locais de uma vez (vindos de um CSV parseado no cliente).
 * Cada linha é um array na ordem das colunas da aba LOCAIS (até 29 colunas).
 * - Código inédito: insere.
 * - Código já existente: atualiza in-place se atualizar=true; senão pula.
 * - Código repetido no próprio arquivo: pula a 2ª ocorrência.
 * @param {Array<Array>} rows
 * @param {boolean} atualizar  true = sobrescreve existentes com os dados do CSV
 * @returns {{ imported:string[], updated:string[], skipped:Array<{codigo:string,motivo:string}> }}
 */
function importarLocais(rows, atualizar) {
  try {
    rows = rows || [];
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('LOCAIS');
    if (!sheet) throw new Error('Aba "LOCAIS" não encontrada.');

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var width   = Math.max(lastCol, 29);

    // Lê toda a base atual (para localizar e atualizar linhas existentes)
    var data = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
    var idxByCod = {};
    data.forEach(function(r, i) { var c = String(r[0]).trim(); if (c) idxByCod[c] = i; });

    var imported = [], updated = [], skipped = [], seen = {}, toAppend = [];

    rows.forEach(function(r) {
      var cod = String((r && r[0] != null ? r[0] : '')).trim();
      if (!cod)      { skipped.push({ codigo: '(vazio)', motivo: 'sem código' }); return; }
      if (seen[cod]) { skipped.push({ codigo: cod, motivo: 'repetido no arquivo' }); return; }
      seen[cod] = true;

      if (idxByCod[cod] !== undefined) {
        if (!atualizar) { skipped.push({ codigo: cod, motivo: 'já existe na base' }); return; }
        // Sobrescreve as primeiras 29 colunas, preservando colunas extras à direita
        var row = data[idxByCod[cod]];
        for (var k = 0; k < 29; k++) { row[k] = (r[k] !== undefined && r[k] !== null) ? r[k] : ''; }
        updated.push(cod);
      } else {
        var a = r.slice();
        while (a.length < width) a.push('');
        toAppend.push(a);
        imported.push(cod);
      }
    });

    // Grava as atualizações (reescreve o bloco de dados existente)
    if (updated.length && data.length) {
      sheet.getRange(2, 1, data.length, width).setValues(data);
    }
    // Anexa os novos
    if (toAppend.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, width).setValues(toAppend);
    }

    return { imported: imported, updated: updated, skipped: skipped };
  } catch (e) {
    throw new Error('Erro ao importar locais: ' + (e.message || e));
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
      var mgr = HtmlService.createTemplateFromFile('EsquemasManager');
      mgr.webAppUrl  = ScriptApp.getService().getUrl();
      mgr.initialEsq = String(params.esq || '').trim();
      return mgr
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
 * Exclui um esquema da aba ESQUEMAS e todos os seus pontos de ESQUEMA_PONTOS.
 * @param {string} idEsquema
 * @returns {{ excluido: number, pontosExcluidos: number }}
 */
function excluirEsquema(idEsquema) {
  try {
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var id  = String(idEsquema).trim();
    if (!id) throw new Error('ID do esquema não informado.');

    // --- Aba ESQUEMAS ---
    var shEsq     = ss.getSheetByName('ESQUEMAS');
    var excluido  = 0;
    if (shEsq) {
      var lastRow = shEsq.getLastRow();
      if (lastRow >= 2) {
        var vals = shEsq.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var i = vals.length - 1; i >= 0; i--) {
          if (String(vals[i][0]).trim() === id) {
            shEsq.deleteRow(i + 2);
            excluido++;
          }
        }
      }
    }

    // --- Aba ESQUEMA_PONTOS ---
    var shPts         = ss.getSheetByName('ESQUEMA_PONTOS');
    var pontosExcluidos = 0;
    if (shPts) {
      var lastPtRow = shPts.getLastRow();
      if (lastPtRow >= 2) {
        var ptVals = shPts.getRange(2, 1, lastPtRow - 1, 1).getValues();
        for (var j = ptVals.length - 1; j >= 0; j--) {
          if (String(ptVals[j][0]).trim() === id) {
            shPts.deleteRow(j + 2);
            pontosExcluidos++;
          }
        }
      }
    }

    EsquemasService.invalidateCache();
    return { excluido: excluido, pontosExcluidos: pontosExcluidos };
  } catch (e) {
    throw new Error('Erro ao excluir esquema: ' + e.message);
  }
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
    var pontosPorEsq = EsquemasService.getPontosTodosEsquemas();
    var locais    = SheetsService.getLocaisParaManager();

    // Mapa código → local (para pegar lat/lng do ponto de partida)
    var locMap = {};
    locais.forEach(function(l) { locMap[String(l.codigo).trim()] = l; });

    esquemas.forEach(function(e) {
      var t = terminais[String(e.id_esquema).trim()]
            || { partida: { nome: '', idPonto: '' }, fim: { nome: '', idPonto: '' } };
      // Nome exibido = o que está guardado no esquema (nome_ponto); a base LOCAIS
      // é só fallback quando o nome guardado está vazio. Isso evita exibir um nome
      // divergente quando o código do ponto aponta para outro local na base.
      var locP = t.partida.idPonto ? locMap[String(t.partida.idPonto).trim()] : null;
      var locF = t.fim.idPonto     ? locMap[String(t.fim.idPonto).trim()]     : null;
      e.partida   = t.partida.nome || (locP && locP.descricao) || '';
      e.fim       = t.fim.nome     || (locF && locF.descricao) || '';
      e.temPontos = !!terminais[String(e.id_esquema).trim()];
      e.regiao = (locP && locP.lat != null && locP.lng != null)
        ? GeoUtils.regiaoPorCoord(locP.lat, locP.lng)
        : '';

      // Paradas distintas do esquema (para agrupar/buscar por local).
      // Lista de { cod, nome } na ordem da viagem, sem repetições (por código).
      var pts  = pontosPorEsq[String(e.id_esquema).trim()] || [];
      var seen = {};
      e.paradas = [];
      pts.forEach(function(p) {
        var cod  = String(p.id_ponto || '').trim();
        if (!cod || seen[cod]) return;
        seen[cod] = true;
        var locP2 = locMap[cod];
        var nome  = String(p.nome_ponto || (locP2 && locP2.descricao) || cod).trim();
        e.paradas.push({ cod: cod, nome: nome });
      });
    });

    return {
      esquemas:          esquemas,
      locais:            locais,
      temposPermanencia: SheetsService.getTemposPermanencia(),
      rotasAjustadas:    getRotasAjustadas()
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
    // Injeta tempos da aba TEMPO_PERMANENCIA nos params — usado pelo ReportService
    // para calcular excesso de parada por ponto (substitui tempo_local do esquema).
    params.temposPermanencia = SheetsService.getTemposPermanencia();

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
