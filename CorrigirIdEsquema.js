// ============================================================
//  CorrigirIdEsquema.gs  —  Utilitário de correção da coluna ID_ESQUEMA
//  Responsabilidade: recriar os valores de ID_ESQUEMA na aba ESQUEMAS
//  a partir da correspondência exata (COD_LINHA, NOME_LINHA, SENTIDO)
//  contra a aba ESQUEMA_PONTOS — sem usar fórmula baseada no nº da linha.
//
//  Contexto: a coluna ID_ESQUEMA era preenchida por =SE(B?="";"";LIN()-1).
//  Após exclusão de linhas durante uma formatação, a sequência desalinhou.
//  Esta rotina restaura o ID correto de cada registro.
//
//  COMO USAR (no editor do Apps Script):
//    1) Execute previewCorrecaoIdEsquema()  → não grava nada; só registra no
//       Log o que SERIA corrigido e o que não tem correspondência.
//    2) Confira o Log (Ctrl+Enter / "Execução" → Logs).
//    3) Se estiver correto, execute corrigirIdEsquema() → grava de fato.
//  Também disponível no menu "Gestão de Esquemas" da planilha.
// ============================================================

/**
 * PRÉVIA (não grava): mostra no Log quantos e quais IDs seriam corrigidos.
 * @returns {{total:number, corrigidos:number, semCorrespondencia:number}}
 */
function previewCorrecaoIdEsquema() {
  return _corrigirIdEsquemaCore(/* aplicar */ false);
}

/**
 * APLICA a correção na aba ESQUEMAS (grava a coluna ID_ESQUEMA).
 * @returns {{total:number, corrigidos:number, semCorrespondencia:number}}
 */
function corrigirIdEsquema() {
  return _corrigirIdEsquemaCore(/* aplicar */ true);
}

/**
 * Núcleo da correção.
 * @param {boolean} aplicar  true grava na planilha; false apenas simula (preview).
 */
function _corrigirIdEsquemaCore(aplicar) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ---- 1) Monta o mapa de referência a partir de ESQUEMA_PONTOS ----
  var shPts = ss.getSheetByName('ESQUEMA_PONTOS');
  if (!shPts) throw new Error('Aba "ESQUEMA_PONTOS" não encontrada.');
  if (shPts.getLastRow() < 2) throw new Error('Aba "ESQUEMA_PONTOS" está vazia.');

  var ptsValues = shPts.getRange(1, 1, shPts.getLastRow(), shPts.getLastColumn()).getValues();
  var ptsHeader = ptsValues[0].map(_normCabecalho);

  var colPts = _mapearColunas(ptsHeader, {
    id_esquema: ['id_esquema', 'id', 'esquema', 'cod_esquema', 'codigo_esquema'],
    cod_linha:  ['cod_linha', 'codigo_linha', 'cod_da_linha', 'codlinha'],
    nome_linha: ['nome_linha', 'nome', 'linha', 'descricao'],
    sentido:    ['sentido', 'direcao', 'destino', 'sentido_linha']
  });

  // Diagnóstico claro caso a aba não tenha as colunas de identidade da linha.
  var faltando = ['id_esquema', 'cod_linha', 'nome_linha', 'sentido']
    .filter(function(c) { return colPts[c] === undefined; });
  if (faltando.length) {
    throw new Error(
      'A aba "ESQUEMA_PONTOS" não possui as colunas necessárias para a busca: [' +
      faltando.join(', ') + ']. Cabeçalhos encontrados: [' + ptsHeader.join(', ') + ']. ' +
      'A correspondência exige COD_LINHA + NOME_LINHA + SENTIDO + ID_ESQUEMA na aba de referência. ' +
      'Confirme qual aba contém esse mapeamento.'
    );
  }

  // Chave (cod|nome|sentido) → id_esquema. Detecta conflitos (mesma chave, ids diferentes).
  var mapaRef = {};
  var conflitos = {};
  for (var i = 1; i < ptsValues.length; i++) {
    var row = ptsValues[i];
    var id  = String(row[colPts.id_esquema]).trim();
    if (!id) continue;
    var chave = _chaveLinha(row[colPts.cod_linha], row[colPts.nome_linha], row[colPts.sentido]);
    if (chave === '||') continue; // linha de referência sem dados de identidade
    if (mapaRef[chave] === undefined) {
      mapaRef[chave] = id;
    } else if (mapaRef[chave] !== id) {
      conflitos[chave] = (conflitos[chave] || [mapaRef[chave]]);
      if (conflitos[chave].indexOf(id) === -1) conflitos[chave].push(id);
    }
  }
  Object.keys(conflitos).forEach(function(k) {
    Logger.log('[AVISO] Chave com IDs conflitantes em ESQUEMA_PONTOS: "' + k + '" → ' + conflitos[k].join(', '));
  });

  // ---- 2) Lê a aba ESQUEMAS (alvo da correção) ----
  var shEsq = ss.getSheetByName('ESQUEMAS');
  if (!shEsq) throw new Error('Aba "ESQUEMAS" não encontrada.');
  if (shEsq.getLastRow() < 2) throw new Error('Aba "ESQUEMAS" está vazia.');

  var nRows = shEsq.getLastRow();
  var esqValues = shEsq.getRange(1, 1, nRows, shEsq.getLastColumn()).getValues();
  var esqHeader = esqValues[0].map(_normCabecalho);

  var colEsq = _mapearColunas(esqHeader, {
    id_esquema: ['id_esquema', 'id', 'cod_esquema', 'codigo_esquema', 'esquema'],
    cod_linha:  ['cod_linha', 'codigo_linha', 'cod_da_linha', 'codlinha'],
    nome_linha: ['nome_linha', 'nome', 'linha', 'descricao'],
    sentido:    ['sentido', 'direcao', 'destino', 'sentido_linha']
  });
  var faltandoEsq = ['id_esquema', 'cod_linha', 'nome_linha', 'sentido']
    .filter(function(c) { return colEsq[c] === undefined; });
  if (faltandoEsq.length) {
    throw new Error(
      'A aba "ESQUEMAS" não possui as colunas: [' + faltandoEsq.join(', ') +
      ']. Cabeçalhos encontrados: [' + esqHeader.join(', ') + '].'
    );
  }

  // ---- 3) Calcula correções ----
  var colIdIdx = colEsq.id_esquema;                 // 0-based
  var colunaIdAtual = [];                            // valores atuais da coluna ID (sob o cabeçalho)
  var novaColunaId  = [];                            // valores a gravar
  var corrigidos = 0;
  var semCorrespondencia = [];
  var detalhesCorrecao = [];

  for (var r = 1; r < esqValues.length; r++) {
    var linha = esqValues[r];
    var idAtual = String(linha[colIdIdx]).trim();
    colunaIdAtual.push([linha[colIdIdx]]);

    var cod    = String(linha[colEsq.cod_linha]).trim();
    var nome   = String(linha[colEsq.nome_linha]).trim();
    var sent   = String(linha[colEsq.sentido]).trim();

    // Linha em branco (sem identidade) → preserva como está.
    if (!cod && !nome && !sent) {
      novaColunaId.push([linha[colIdIdx]]);
      continue;
    }

    var chave   = _chaveLinha(cod, nome, sent);
    var idCerto = mapaRef[chave];

    if (idCerto === undefined) {
      semCorrespondencia.push('Linha ' + (r + 1) + ': ' + cod + ' | ' + nome + ' | ' + sent);
      novaColunaId.push([linha[colIdIdx]]); // mantém o valor atual (rule 4: não inventa)
      continue;
    }

    if (idAtual !== String(idCerto)) {
      corrigidos++;
      detalhesCorrecao.push('Linha ' + (r + 1) + ': "' + idAtual + '" → "' + idCerto + '"  (' + nome + ' | ' + sent + ')');
      novaColunaId.push([_coagirNumero(idCerto)]);
    } else {
      novaColunaId.push([linha[colIdIdx]]);
    }
  }

  // ---- 4) Aplica (ou só registra) ----
  Logger.log('=== Correção ID_ESQUEMA (' + (aplicar ? 'APLICAR' : 'PRÉVIA') + ') ===');
  Logger.log('Total de registros: ' + (esqValues.length - 1));
  Logger.log('Registros a corrigir: ' + corrigidos);
  detalhesCorrecao.forEach(function(d) { Logger.log('  ' + d); });
  if (semCorrespondencia.length) {
    Logger.log('Sem correspondência exata (' + semCorrespondencia.length + ') — mantidos sem alteração:');
    semCorrespondencia.forEach(function(d) { Logger.log('  ' + d); });
  }

  if (aplicar && corrigidos > 0) {
    // Grava só a coluna ID_ESQUEMA, da linha 2 até o fim (demais colunas intactas).
    shEsq.getRange(2, colIdIdx + 1, novaColunaId.length, 1).setValues(novaColunaId);
    if (typeof EsquemasService !== 'undefined' && EsquemasService.invalidateCache) {
      EsquemasService.invalidateCache();
    }
    Logger.log('Gravação concluída.');
  } else if (aplicar) {
    Logger.log('Nada a gravar — todos os IDs já estavam corretos.');
  } else {
    Logger.log('PRÉVIA — nenhuma alteração gravada. Rode corrigirIdEsquema() para aplicar.');
  }

  return {
    total: esqValues.length - 1,
    corrigidos: corrigidos,
    semCorrespondencia: semCorrespondencia.length
  };
}

/**
 * DIAGNÓSTICO RÁPIDO: confirma se o COD_LINHA está sendo lido da aba ESQUEMAS.
 * Invalida o cache e loga os primeiros esquemas com o cod_linha lido.
 * Se aqui aparecer o código mas a tela não mostrar → é deploy/cache do front.
 * Se aqui vier "(vazio)" → o problema é a coluna/cabeçalho na planilha.
 */
function verCodLinha() {
  EsquemasService.invalidateCache();
  var esq = EsquemasService.getEsquemas();
  Logger.log('Total de esquemas: ' + esq.length);
  esq.slice(0, 10).forEach(function(e) {
    Logger.log('#' + e.id_esquema + ' | ' + e.nome_linha +
      ' | cod_linha="' + (e.cod_linha || '(vazio)') + '"');
  });
}

/**
 * DIAGNÓSTICO: verifica se a chave (origem, destino) é suficiente para
 * identificar cada esquema sem ambiguidade.
 *
 * Para cada id_esquema, deriva da ESQUEMA_PONTOS o ponto de PARTIDA (primeiro
 * não-garagem/fechamento) e o de FIM (último não-garagem/fechamento) e agrupa
 * por (idPonto_partida → idPonto_fim). Esquemas que caem no mesmo grupo NÃO
 * podem ser distinguidos só por origem/destino — precisariam do HORÁRIO.
 *
 * Não grava nada. Rode antes de decidir a estratégia de correção.
 * @returns {{totalEsquemas:number, chavesUnicas:number, colisoes:number}}
 */
function diagnosticarOrigemDestino() {
  if (typeof EsquemasService === 'undefined' || !EsquemasService.getPontosTodosEsquemas) {
    throw new Error('EsquemasService.getPontosTodosEsquemas indisponível.');
  }
  var pontosPorEsq = EsquemasService.getPontosTodosEsquemas(); // { id: [pontos ordenados por ORDEM] }

  // Deriva, por esquema, origem/destino (id do local) e o horario_comercial da partida.
  var info = {}; // id -> { origemId, destinoId, origemNome, destinoNome, horario }
  Object.keys(pontosPorEsq).forEach(function(id) {
    var pts = pontosPorEsq[id];
    var partida = _primeiroPontoUtil(pts);
    var fim     = _ultimoPontoUtil(pts);
    info[id] = {
      origemId:    partida ? String(partida.id_ponto || '') : '',
      destinoId:   fim     ? String(fim.id_ponto || '')     : '',
      origemNome:  partida ? String(partida.nome_ponto || '') : '',
      destinoNome: fim     ? String(fim.nome_ponto || '')     : '',
      horario:     partida ? String(partida.horario_comercial || '').trim() : ''
    };
  });

  var ids = Object.keys(info);
  var totalEsquemas = ids.length;

  // --- Chave A: origem→destino ---
  var gruposA = {};
  ids.forEach(function(id) {
    var k = info[id].origemId + '→' + info[id].destinoId;
    (gruposA[k] = gruposA[k] || []).push(id);
  });
  var colisoresA = Object.keys(gruposA).filter(function(k) { return gruposA[k].length > 1; });

  // --- Chave B: origem→destino + horario_comercial da partida ---
  var gruposB = {};
  ids.forEach(function(id) {
    var k = info[id].origemId + '→' + info[id].destinoId + '@' + info[id].horario;
    (gruposB[k] = gruposB[k] || []).push(id);
  });
  var colisoresB = Object.keys(gruposB).filter(function(k) { return gruposB[k].length > 1; });

  // Cobertura do horario_comercial (quantas partidas têm horário preenchido)
  var comHorario = ids.filter(function(id) { return info[id].horario !== ''; }).length;

  Logger.log('=== Diagnóstico de chave para reconstruir ID_ESQUEMA ===');
  Logger.log('Total de esquemas: ' + totalEsquemas);
  Logger.log('Partidas com horario_comercial preenchido: ' + comHorario + ' de ' + totalEsquemas);
  Logger.log('');
  Logger.log('[Chave A] origem→destino  — colisões: ' + colisoresA.length);
  Logger.log('[Chave B] origem→destino + horário  — colisões: ' + colisoresB.length);

  if (colisoresA.length) {
    Logger.log('');
    Logger.log('--- Detalhe: grupos que origem/destino NÃO separa (e o horário de cada um) ---');
    colisoresA.forEach(function(k) {
      var g = gruposA[k];
      var amostra = info[g[0]];
      Logger.log('  [' + amostra.origemNome + ' → ' + amostra.destinoNome + ']');
      g.forEach(function(id) {
        Logger.log('      id ' + id + '  | horario_comercial partida: "' + (info[id].horario || '(vazio)') + '"');
      });
    });
  }

  if (colisoresB.length === 0 && colisoresA.length > 0) {
    Logger.log('');
    Logger.log('✅ origem+destino+HORÁRIO separa todos os esquemas. A correção é viável de forma determinística.');
  } else if (colisoresB.length > 0) {
    Logger.log('');
    Logger.log('⚠️ Ainda há ' + colisoresB.length + ' colisão(ões) mesmo com horário — provavelmente horario_comercial vazio/duplicado. Veja o detalhe acima.');
  }

  return {
    totalEsquemas: totalEsquemas,
    partidasComHorario: comHorario,
    colisoesOrigemDestino: colisoresA.length,
    colisoesComHorario: colisoresB.length
  };
}

/** Primeiro ponto não-garagem/fechamento; senão o primeiro. */
function _primeiroPontoUtil(pts) {
  for (var i = 0; i < pts.length; i++) {
    if (/garagem/i.test(String(pts[i].nome_ponto || '')) || /fechamento/i.test(String(pts[i].tipo || ''))) continue;
    return pts[i];
  }
  return pts.length ? pts[0] : null;
}

/** Último ponto não-garagem/fechamento; senão o último. */
function _ultimoPontoUtil(pts) {
  for (var i = pts.length - 1; i >= 0; i--) {
    if (/garagem/i.test(String(pts[i].nome_ponto || '')) || /fechamento/i.test(String(pts[i].tipo || ''))) continue;
    return pts[i];
  }
  return pts.length ? pts[pts.length - 1] : null;
}

// ============================================================
//  HELPERS
// ============================================================

/** Normaliza cabeçalho: minúsculo, sem acento, espaços → underscore. */
function _normCabecalho(h) {
  if (h === null || h === undefined) return '';
  return String(h).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '_');
}

/**
 * Mapeia campos lógicos → índice de coluna (0-based) por aliases de cabeçalho.
 * @param {string[]} header  cabeçalhos já normalizados
 * @param {Object} aliases   { campo: [alias1, alias2, ...] }
 * @returns {Object} { campo: índice|undefined }
 */
function _mapearColunas(header, aliases) {
  var out = {};
  Object.keys(aliases).forEach(function(campo) {
    var variantes = aliases[campo];
    for (var j = 0; j < variantes.length; j++) {
      var idx = header.indexOf(variantes[j]);
      if (idx !== -1) { out[campo] = idx; break; }
    }
  });
  return out;
}

/**
 * Chave de correspondência exata da linha: COD_LINHA | NOME_LINHA | SENTIDO.
 * Normaliza apenas espaços e caixa (uppercase) para tolerar diferenças
 * triviais (ex.: "Ida" vs "IDA") sem deixar de ser uma correspondência exata
 * de conteúdo. Acentos são preservados.
 */
function _chaveLinha(cod, nome, sentido) {
  return [cod, nome, sentido].map(function(v) {
    return String(v === null || v === undefined ? '' : v)
      .trim().replace(/\s+/g, ' ').toUpperCase();
  }).join('|');
}

/** Converte "12" → 12 (número) quando for inteiro puro; senão mantém string. */
function _coagirNumero(v) {
  var s = String(v).trim();
  return /^\d+$/.test(s) ? parseInt(s, 10) : v;
}
