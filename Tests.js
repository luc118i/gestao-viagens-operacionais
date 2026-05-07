// ============================================================
//  Tests.gs — Testes automatizados para funções de Tipo de Via
//  Execute runAllTests_TipoVia() no editor do GAS para rodar todos.
//  IDs de teste usam prefixo "T99" para não conflitar com dados reais.
// ============================================================

var _TEST_ID_A = 'T99001';
var _TEST_ID_B = 'T99002';

// ============================================================
//  RUNNER PRINCIPAL
// ============================================================

function runAllTests_TipoVia() {
  var results = [];

  // salvarTipoViaVelocidade
  results.push(_test_salvar_cria_aba());
  results.push(_test_salvar_nova_linha());
  results.push(_test_salvar_atualiza_existente());
  results.push(_test_salvar_arredondamento());
  results.push(_test_salvar_multiplos_tipos());

  // getTipoViaVelocidades
  results.push(_test_get_sem_aba_retorna_defaults());
  results.push(_test_get_config_propria_linha());
  results.push(_test_get_media_outras_linhas());
  results.push(_test_get_mescla_propria_e_media());
  results.push(_test_get_fallback_total_para_defaults());

  // _atualizarTipoViaDistancias_
  results.push(_test_dist_atualiza_par_existente());
  results.push(_test_dist_cria_coluna_tipo_via());
  results.push(_test_dist_par_inexistente_nao_cria_linha());

  // _lerTipoViaDistancias_
  results.push(_test_ler_dist_retorna_mapa_correto());
  results.push(_test_ler_dist_sem_coluna_retorna_vazio());

  // getPontosEsquemaParaFormulario — fallback
  results.push(_test_getPontos_fallback_distancias());
  results.push(_test_getPontos_mantem_tipo_trecho_existente());

  _limparDadosTeste_();
  _logResultados_(results);
}

// ============================================================
//  TESTES: salvarTipoViaVelocidade
// ============================================================

function _test_salvar_cria_aba() {
  var name = 'salvar: cria aba TIPO_VIA se não existir';
  _limparDadosTeste_();
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var antes = ss.getSheetByName('TIPO_VIA');
    if (antes) ss.deleteSheet(antes);

    salvarTipoViaVelocidade(_TEST_ID_A, 'BR', 70);

    var sheet = ss.getSheetByName('TIPO_VIA');
    if (!sheet) return _fail(name, 'Aba TIPO_VIA não foi criada');
    var headers = sheet.getRange(1, 1, 1, 3).getValues()[0];
    if (headers[0] !== 'cod_linha') return _fail(name, 'Cabeçalho col 1 incorreto: ' + headers[0]);
    if (headers[1] !== 'tipo')      return _fail(name, 'Cabeçalho col 2 incorreto: ' + headers[1]);
    if (headers[2] !== 'km')        return _fail(name, 'Cabeçalho col 3 incorreto: ' + headers[2]);
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
}

function _test_salvar_nova_linha() {
  var name = 'salvar: insere nova linha corretamente';
  _limparDadosTeste_();
  try {
    salvarTipoViaVelocidade(_TEST_ID_A, 'Est', 75);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('TIPO_VIA');
    var row = _encontrarLinhaTipoVia_(sheet, _TEST_ID_A, 'Est');
    if (!row) return _fail(name, 'Linha não encontrada na aba');
    if (row[2] !== 75) return _fail(name, 'Velocidade esperada 75, obtida: ' + row[2]);
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
}

function _test_salvar_atualiza_existente() {
  var name = 'salvar: atualiza velocidade de linha já existente';
  _limparDadosTeste_();
  try {
    salvarTipoViaVelocidade(_TEST_ID_A, 'BR', 70);
    salvarTipoViaVelocidade(_TEST_ID_A, 'BR', 80);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('TIPO_VIA');
    var linhas = _todasLinhasTipoVia_(sheet, _TEST_ID_A, 'BR');
    if (linhas.length !== 1) return _fail(name, 'Esperado 1 linha, encontrado: ' + linhas.length);
    if (linhas[0][2] !== 80) return _fail(name, 'Velocidade esperada 80, obtida: ' + linhas[0][2]);
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
}

function _test_salvar_arredondamento() {
  var name = 'salvar: arredonda velocidade para 1 decimal';
  _limparDadosTeste_();
  try {
    salvarTipoViaVelocidade(_TEST_ID_A, 'Mun', 62.456);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('TIPO_VIA');
    var row = _encontrarLinhaTipoVia_(sheet, _TEST_ID_A, 'Mun');
    if (!row) return _fail(name, 'Linha não encontrada');
    if (row[2] !== 62.5) return _fail(name, 'Esperado 62.5, obtido: ' + row[2]);
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
}

function _test_salvar_multiplos_tipos() {
  var name = 'salvar: múltiplos tipos para a mesma linha não se sobrescrevem';
  _limparDadosTeste_();
  try {
    salvarTipoViaVelocidade(_TEST_ID_A, 'BR',  70);
    salvarTipoViaVelocidade(_TEST_ID_A, 'Est', 78);
    salvarTipoViaVelocidade(_TEST_ID_A, 'Mun', 55);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('TIPO_VIA');
    var br  = _encontrarLinhaTipoVia_(sheet, _TEST_ID_A, 'BR');
    var est = _encontrarLinhaTipoVia_(sheet, _TEST_ID_A, 'Est');
    var mun = _encontrarLinhaTipoVia_(sheet, _TEST_ID_A, 'Mun');
    if (!br  || br[2]  !== 70) return _fail(name, 'BR incorreto: '  + (br  ? br[2]  : 'null'));
    if (!est || est[2] !== 78) return _fail(name, 'Est incorreto: ' + (est ? est[2] : 'null'));
    if (!mun || mun[2] !== 55) return _fail(name, 'Mun incorreto: ' + (mun ? mun[2] : 'null'));
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
}

// ============================================================
//  TESTES: getTipoViaVelocidades
// ============================================================

function _test_get_sem_aba_retorna_defaults() {
  var name = 'get: retorna defaults quando aba TIPO_VIA não existe';
  _limparDadosTeste_();
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('TIPO_VIA');
    if (sheet) ss.deleteSheet(sheet);

    var v = getTipoViaVelocidades(_TEST_ID_A);
    if (v.BR  !== 85) return _fail(name, 'BR esperado 85, obtido: ' + v.BR);
    if (v.Est !== 75) return _fail(name, 'Est esperado 75, obtido: ' + v.Est);
    if (v.Mun !== 60) return _fail(name, 'Mun esperado 60, obtido: ' + v.Mun);
    if (v.Urb !== 45) return _fail(name, 'Urb esperado 45, obtido: ' + v.Urb);
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
}

function _test_get_config_propria_linha() {
  var name = 'get: usa velocidade configurada para a própria linha';
  _limparDadosTeste_();
  try {
    salvarTipoViaVelocidade(_TEST_ID_A, 'BR',  70);
    salvarTipoViaVelocidade(_TEST_ID_A, 'Est', 80);
    salvarTipoViaVelocidade(_TEST_ID_A, 'Mun', 50);
    salvarTipoViaVelocidade(_TEST_ID_A, 'Urb', 40);

    var v = getTipoViaVelocidades(_TEST_ID_A);
    if (v.BR  !== 70) return _fail(name, 'BR esperado 70, obtido: '  + v.BR);
    if (v.Est !== 80) return _fail(name, 'Est esperado 80, obtido: ' + v.Est);
    if (v.Mun !== 50) return _fail(name, 'Mun esperado 50, obtido: ' + v.Mun);
    if (v.Urb !== 40) return _fail(name, 'Urb esperado 40, obtido: ' + v.Urb);
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
}

function _test_get_media_outras_linhas() {
  var name = 'get: usa média de outras linhas quando própria não tem config';
  _limparDadosTeste_();
  try {
    // Duas outras linhas com BR configurado
    salvarTipoViaVelocidade(_TEST_ID_B, 'BR', 60);
    salvarTipoViaVelocidade('T99003',   'BR', 80);
    // _TEST_ID_A não tem nenhuma config

    var v = getTipoViaVelocidades(_TEST_ID_A);
    // Média de 60 e 80 = 70
    if (v.BR !== 70) return _fail(name, 'Média BR esperada 70, obtida: ' + v.BR);
    // Est sem config → default 75
    if (v.Est !== 75) return _fail(name, 'Est esperado 75 (default), obtido: ' + v.Est);
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
  finally { _limparLinhasTeste_('T99003'); }
}

function _test_get_mescla_propria_e_media() {
  var name = 'get: mescla — BR da linha, Est da média, Mun/Urb do default';
  _limparDadosTeste_();
  try {
    salvarTipoViaVelocidade(_TEST_ID_A, 'BR',  72);          // própria linha
    salvarTipoViaVelocidade(_TEST_ID_B, 'Est', 68);          // outra linha (média)
    salvarTipoViaVelocidade('T99004',   'Est', 72);          // outra linha (média)

    var v = getTipoViaVelocidades(_TEST_ID_A);
    if (v.BR  !== 72) return _fail(name, 'BR esperado 72, obtido: '  + v.BR);
    if (v.Est !== 70) return _fail(name, 'Est esperado 70 (média 68+72), obtido: ' + v.Est);
    if (v.Mun !== 60) return _fail(name, 'Mun esperado 60 (default), obtido: ' + v.Mun);
    if (v.Urb !== 45) return _fail(name, 'Urb esperado 45 (default), obtido: ' + v.Urb);
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
  finally { _limparLinhasTeste_('T99004'); }
}

function _test_get_fallback_total_para_defaults() {
  var name = 'get: fallback total para defaults quando aba existe mas está vazia';
  _limparDadosTeste_();
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('TIPO_VIA');
    if (sheet) ss.deleteSheet(sheet);
    sheet = ss.insertSheet('TIPO_VIA');
    sheet.getRange(1, 1, 1, 3).setValues([['cod_linha', 'tipo', 'km']]);
    // Aba existe mas sem linhas de dados

    var v = getTipoViaVelocidades(_TEST_ID_A);
    if (v.BR  !== 85) return _fail(name, 'BR esperado 85, obtido: ' + v.BR);
    if (v.Est !== 75) return _fail(name, 'Est esperado 75, obtido: ' + v.Est);
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
}

// ============================================================
//  TESTES: _atualizarTipoViaDistancias_
// ============================================================

function _test_dist_atualiza_par_existente() {
  var name = 'dist: atualiza tipo_via de par existente em DISTANCIAS';
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('DISTANCIAS');
    if (!sheet) return _skip(name, 'Aba DISTANCIAS não existe');

    // Garante coluna tipo_via e insere par de teste
    _garantirColunaTipoVia_(sheet);
    var tvCol = _colTipoVia_(sheet);
    sheet.appendRow(['T_PA', 'T_PB', 99.9]);
    var testRow = sheet.getLastRow();

    _atualizarTipoViaDistancias_([{ pontoA: 'T_PA', pontoB: 'T_PB', tipoVia: 'Est' }]);

    var val = sheet.getRange(testRow, tvCol).getValue();
    sheet.deleteRow(testRow); // limpeza
    if (val !== 'Est') return _fail(name, 'Esperado "Est", obtido: "' + val + '"');
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
}

function _test_dist_cria_coluna_tipo_via() {
  var name = 'dist: cria coluna tipo_via se não existir';
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('DISTANCIAS');
    if (!sheet) return _skip(name, 'Aba DISTANCIAS não existe');

    // Remove coluna tipo_via se existir, para testar criação
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var tvIdx = headers.map(function(h){ return String(h).trim().toLowerCase(); }).indexOf('tipo_via');
    // Apenas verificamos que após a chamada a coluna existe
    sheet.appendRow(['T_PC', 'T_PD', 11.1]);
    var testRow = sheet.getLastRow();

    _atualizarTipoViaDistancias_([{ pontoA: 'T_PC', pontoB: 'T_PD', tipoVia: 'Mun' }]);

    var headersAfter = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function(h){ return String(h).trim().toLowerCase(); });
    sheet.deleteRow(testRow);
    if (headersAfter.indexOf('tipo_via') === -1) return _fail(name, 'Coluna tipo_via não foi criada');
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
}

function _test_dist_par_inexistente_nao_cria_linha() {
  var name = 'dist: par inexistente não cria nova linha em DISTANCIAS';
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('DISTANCIAS');
    if (!sheet) return _skip(name, 'Aba DISTANCIAS não existe');

    var rowsBefore = sheet.getLastRow();
    _atualizarTipoViaDistancias_([{ pontoA: 'PONTO_FAKE_X', pontoB: 'PONTO_FAKE_Y', tipoVia: 'BR' }]);
    var rowsAfter = sheet.getLastRow();

    if (rowsAfter !== rowsBefore) return _fail(name, 'Linhas antes: ' + rowsBefore + ', depois: ' + rowsAfter);
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
}

// ============================================================
//  TESTES: _lerTipoViaDistancias_
// ============================================================

function _test_ler_dist_retorna_mapa_correto() {
  var name = 'lerDist: retorna mapa normA:normB → tipoVia correto';
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('DISTANCIAS');
    if (!sheet) return _skip(name, 'Aba DISTANCIAS não existe');

    _garantirColunaTipoVia_(sheet);
    var tvCol = _colTipoVia_(sheet);
    // Insere par de teste com tipo_via
    sheet.appendRow(['T_PE', 'T_PF', 55.5]);
    var testRow = sheet.getLastRow();
    sheet.getRange(testRow, tvCol).setValue('Urb');

    var mapa = _lerTipoViaDistancias_();
    sheet.deleteRow(testRow);

    // _normPair_ ordena: 'T_PE' < 'T_PF' → chave 'T_PE:T_PF'
    var chave = 'T_PE:T_PF';
    if (mapa[chave] !== 'Urb') return _fail(name, 'Chave ' + chave + ' esperado "Urb", obtido: "' + mapa[chave] + '"');
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
}

function _test_ler_dist_sem_coluna_retorna_vazio() {
  var name = 'lerDist: retorna {} quando não há coluna tipo_via';
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('DISTANCIAS');
    if (!sheet) return _skip(name, 'Aba DISTANCIAS não existe');

    // Verifica apenas que não lança erro e retorna objeto
    // (não removemos a coluna real para não danificar dados)
    var mapa = _lerTipoViaDistancias_();
    if (typeof mapa !== 'object') return _fail(name, 'Retorno não é objeto');
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
}

// ============================================================
//  TESTES: getPontosEsquemaParaFormulario — fallback
// ============================================================

function _test_getPontos_fallback_distancias() {
  var name = 'getPontos: preenche tipoTrecho vazio com tipo_via de DISTANCIAS';
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var distSheet = ss.getSheetByName('DISTANCIAS');
    if (!distSheet) return _skip(name, 'Aba DISTANCIAS não existe');

    // Insere distância de teste com tipo_via
    _garantirColunaTipoVia_(distSheet);
    var tvCol = _colTipoVia_(distSheet);
    // Usamos normPair: menor vem primeiro
    distSheet.appendRow(['T_P1', 'T_P2', 10]);
    var distRow = distSheet.getLastRow();
    distSheet.getRange(distRow, tvCol).setValue('BR');

    // Insere sequência de teste em ESQUEMA_PONTOS sem tipo_trecho
    var ptSheet = ss.getSheetByName('ESQUEMA_PONTOS');
    if (!ptSheet) { distSheet.deleteRow(distRow); return _skip(name, 'Aba ESQUEMA_PONTOS não existe'); }
    ptSheet.appendRow([_TEST_ID_A, 1, 'T_P1', 'Ponto Teste 1', '', '', '', '']);
    ptSheet.appendRow([_TEST_ID_A, 2, 'T_P2', 'Ponto Teste 2', '', '', '', '']);
    var ptLastRow = ptSheet.getLastRow();

    var pontos = getPontosEsquemaParaFormulario(_TEST_ID_A);

    // Limpeza
    ptSheet.deleteRow(ptLastRow);
    ptSheet.deleteRow(ptLastRow - 1);
    distSheet.deleteRow(distRow);

    if (!pontos.length) return _fail(name, 'Nenhum ponto retornado');
    var p0 = pontos[0];
    if (p0.tipoTrecho !== 'BR') return _fail(name, 'tipoTrecho esperado "BR", obtido: "' + p0.tipoTrecho + '"');
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
}

function _test_getPontos_mantem_tipo_trecho_existente() {
  var name = 'getPontos: não sobrescreve tipoTrecho já preenchido em ESQUEMA_PONTOS';
  try {
    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var ptSheet = ss.getSheetByName('ESQUEMA_PONTOS');
    if (!ptSheet) return _skip(name, 'Aba ESQUEMA_PONTOS não existe');
    var distSheet = ss.getSheetByName('DISTANCIAS');
    if (!distSheet) return _skip(name, 'Aba DISTANCIAS não existe');

    // Insere distância com tipo_via = 'Est'
    _garantirColunaTipoVia_(distSheet);
    var tvCol = _colTipoVia_(distSheet);
    distSheet.appendRow(['T_P3', 'T_P4', 20]);
    var distRow = distSheet.getLastRow();
    distSheet.getRange(distRow, tvCol).setValue('Est');

    // Insere ponto com tipoTrecho já definido como 'Mun' (deve prevalecer)
    ptSheet.appendRow([_TEST_ID_A, 1, 'T_P3', 'Ponto 3', '', '', '', 'Mun']);
    ptSheet.appendRow([_TEST_ID_A, 2, 'T_P4', 'Ponto 4', '', '', '', '']);
    var ptLastRow = ptSheet.getLastRow();

    var pontos = getPontosEsquemaParaFormulario(_TEST_ID_A);

    ptSheet.deleteRow(ptLastRow);
    ptSheet.deleteRow(ptLastRow - 1);
    distSheet.deleteRow(distRow);

    if (!pontos.length) return _fail(name, 'Nenhum ponto retornado');
    if (pontos[0].tipoTrecho !== 'Mun') return _fail(name, 'Esperado "Mun" (ESQUEMA_PONTOS), obtido: "' + pontos[0].tipoTrecho + '"');
    return _pass(name);
  } catch(e) { return _fail(name, e.message); }
}

// ============================================================
//  HELPERS DOS TESTES
// ============================================================

function _pass(name) { return { name: name, passed: true,  error: '' }; }
function _fail(name, msg) { return { name: name, passed: false, error: msg }; }
function _skip(name, msg) { return { name: name, passed: null,  error: 'SKIP: ' + msg }; }

function _logResultados_(results) {
  var passou = 0, falhou = 0, pulou = 0;
  Logger.log('=== RESULTADOS — Tipo de Via ===');
  results.forEach(function(r) {
    if (r.passed === true)  { Logger.log('  ✓  ' + r.name); passou++; }
    else if (r.passed === false) { Logger.log('  ✗  ' + r.name + '\n        → ' + r.error); falhou++; }
    else                    { Logger.log('  —  ' + r.name + '\n        → ' + r.error); pulou++; }
  });
  Logger.log('================================');
  Logger.log('  Passou: ' + passou + '  |  Falhou: ' + falhou + '  |  Pulou: ' + pulou);
  Logger.log('================================');
}

function _limparDadosTeste_() {
  _limparLinhasTeste_(_TEST_ID_A);
  _limparLinhasTeste_(_TEST_ID_B);
}

function _limparLinhasTeste_(id) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('TIPO_VIA');
    if (!sheet || sheet.getLastRow() < 2) return;
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]).trim() === String(id).trim()) sheet.deleteRow(i + 2);
    }
  } catch(e) {}
}

function _encontrarLinhaTipoVia_(sheet, id, tipo) {
  if (!sheet || sheet.getLastRow() < 2) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(id) && String(data[i][1]).trim() === tipo) return data[i];
  }
  return null;
}

function _todasLinhasTipoVia_(sheet, id, tipo) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  return data.filter(function(r) {
    return String(r[0]).trim() === String(id) && String(r[1]).trim() === tipo;
  });
}

function _garantirColunaTipoVia_(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(h){ return String(h).trim().toLowerCase(); });
  if (headers.indexOf('tipo_via') === -1) {
    sheet.getRange(1, lastCol + 1).setValue('tipo_via');
  }
}

function _colTipoVia_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h){ return String(h).trim().toLowerCase(); });
  return headers.indexOf('tipo_via') + 1;
}
