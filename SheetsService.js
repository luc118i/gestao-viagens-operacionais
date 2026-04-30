// ============================================================
//  SheetsService.gs  —  Leitura das abas do Google Sheets
//  Responsabilidade: abstrair o acesso à planilha e retornar
//  arrays de objetos prontos para uso pelo AnalysisService
// ============================================================

var SheetsService = (() => {

  // Índices das colunas na aba LOCAIS (0-based)
  // Ordem: Código, Cód.Emb, Desc.Resumida, Descrição, Unid.Emp, Tipo,
  //        Aj.Hor, Raio, Raio Advert, Vel, Grupo PC, Dist.vel, Cod.ext,
  //        Ativo, Pedágio, Rodoviária, Suspensão, Garagem, Online,
  //        Auxiliar, Seletivo, Ponto Vel, Area Vel, Direções,
  //        Latitude, Longitude, Chave, Data Cadastro, Data Alteração
  const COL = {
    CODIGO:        0,
    DESC_RESUMIDA: 2,
    DESCRICAO:     3,
    TIPO:          5,
    VEL:           9,
    RAIO:          7,
    ATIVO:        13,
    PEDAGIO:      14,
    RODOVIARIA:   15,
    GARAGEM:      17,
    LATITUDE:     24,
    LONGITUDE:    25
  };

  /**
   * Lê a aba "LOCAIS" e retorna array de objetos enriquecidos.
   * Filtra apenas registros com Ativo = 'T' e que possuam lat/lng válidos.
   * @returns {Array<Object>}
   */
  function getLocais() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('LOCAIS');

    if (!sheet) {
      throw new Error('Aba "LOCAIS" não encontrada na planilha.');
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const data = sheet.getRange(2, 1, lastRow - 1, 29).getValues();
    const locais = [];

    data.forEach((row, idx) => {
      const lat = parseFloat(row[COL.LATITUDE]);
      const lng = parseFloat(row[COL.LONGITUDE]);

      // Filtra apenas registros com coordenadas válidas
      // NÃO filtra por Ativo — o campo usa convenção variável (F/T/S/N) no sistema exportador
      if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return;

      locais.push({
        codigo:       String(row[COL.CODIGO]).trim(),
        descResumida: String(row[COL.DESC_RESUMIDA]).trim(),
        descricao:    String(row[COL.DESCRICAO]).trim(),
        tipo:         String(row[COL.TIPO]).trim(),
        vel:          parseFloat(row[COL.VEL]) || 0,
        raio:         parseFloat(row[COL.RAIO]) || 0,
        // Aceita 'T' (True) ou 'S' (Sim) como verdadeiro — o CSV exportado usa ambos
        pedagio:      _isTrueFlag(row[COL.PEDAGIO]),
        rodoviaria:   _isTrueFlag(row[COL.RODOVIARIA]),
        garagem:      _isTrueFlag(row[COL.GARAGEM]),
        lat:          lat,
        lng:          lng
      });
    });

    return locais;
  }

  /**
   * Lê a aba "MOTORISTAS" e retorna array de objetos.
   * Estrutura esperada: Matricula | Nome | Base (cabeçalho na linha 1)
   * @returns {Array<{matricula: string, nome: string, base: string}>}
   */
  function getMotoristas() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('MOTORISTAS');

    if (!sheet) return []; // aba opcional

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    const motoristas = [];

    data.forEach((row) => {
      const matricula = String(row[0]).trim();
      const nome      = String(row[1]).trim();
      const base      = String(row[2]).trim();
      const ibutton   = String(row[3] || '').trim();
      if (matricula && nome) {
        motoristas.push({ matricula, nome, base, ibutton });
      }
    });

    return motoristas;
  }

  /**
   * Interpreta flags booleanas do CSV exportado.
   * O sistema usa 'T' (True), 'S' (Sim), '1' e 'Y' como verdadeiro.
   * Usa 'F', 'N', '0', '' como falso.
   */
  function _isTrueFlag(val) {
    const v = String(val || '').trim().toUpperCase();
    return v === 'T' || v === 'S' || v === '1' || v === 'Y';
  }

  /**
   * Lê a aba "LOCAIS" e retorna todos os registros ativos (sem filtro de coordenadas).
   * Usado pelo formulário de cadastro de pontos de esquema.
   * @returns {Array<{codigo: string, descricao: string, tipo: string}>}
   */
  function getLocaisSimples() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('LOCAIS');

    if (!sheet) throw new Error('Aba "LOCAIS" não encontrada na planilha.');

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const data = sheet.getRange(2, 1, lastRow - 1, 29).getValues();
    const locais = [];

    data.forEach((row) => {
      const codigo = String(row[COL.CODIGO]).trim();
      if (!codigo) return;
      locais.push({
        codigo:    codigo,
        descricao: String(row[COL.DESCRICAO] || row[COL.DESC_RESUMIDA]).trim(),
        tipo:      String(row[COL.TIPO]).trim()
      });
    });

    return locais;
  }

  /**
   * Lê a aba "LOCAIS" retornando todos os registros com coordenadas onde disponível.
   * Usado pela Web App de gestão de esquemas (precisa de lat/lng para o mapa).
   * @returns {Array<{codigo, descricao, tipo, lat, lng}>}
   */
  function getLocaisParaManager() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('LOCAIS');
    if (!sheet) throw new Error('Aba "LOCAIS" não encontrada na planilha.');

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const data = sheet.getRange(2, 1, lastRow - 1, 29).getValues();
    const locais = [];

    data.forEach((row) => {
      const codigo = String(row[COL.CODIGO]).trim();
      if (!codigo) return;
      const lat = parseFloat(row[COL.LATITUDE]);
      const lng = parseFloat(row[COL.LONGITUDE]);
      locais.push({
        codigo:    codigo,
        descricao: String(row[COL.DESCRICAO] || row[COL.DESC_RESUMIDA]).trim(),
        tipo:      String(row[COL.TIPO]).trim(),
        lat:       (!isNaN(lat) && lat !== 0) ? lat : null,
        lng:       (!isNaN(lng) && lng !== 0) ? lng : null
      });
    });

    return locais;
  }

  /**
   * Adiciona um novo motorista na aba MOTORISTAS.
   * @param {{matricula:string, nome:string, base:string}} dados
   * @returns {{matricula:string, nome:string, base:string}}
   */
  function saveMotorista({ matricula, nome, base, ibutton }) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('MOTORISTAS');
    if (!sheet) throw new Error('Aba "MOTORISTAS" não encontrada.');
    const mat  = String(matricula || '').trim();
    const nom  = String(nome      || '').trim();
    const bas  = String(base      || '').trim();
    const ibt  = String(ibutton   || '').trim();
    if (!nom) throw new Error('Nome do motorista é obrigatório.');
    sheet.appendRow([mat, nom, bas, ibt]);
    return { matricula: mat, nome: nom, base: bas, ibutton: ibt };
  }

  /**
   * Atualiza o iButton de um motorista existente (busca por matrícula ou nome).
   * @param {string} matricula
   * @param {string} nome
   * @param {string} ibutton
   * @returns {boolean}
   */
  function updateMotoristaIbutton(matricula, nome, ibutton) {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('MOTORISTAS');
    if (!sheet) return false;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return false;
    const ibt = String(ibutton || '').trim();
    if (!ibt) return false;
    const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    const matNorm  = String(matricula || '').trim().toUpperCase();
    const nomeNorm = String(nome      || '').trim().toUpperCase();
    for (var i = 0; i < data.length; i++) {
      const rowMat  = String(data[i][0] || '').trim().toUpperCase();
      const rowNome = String(data[i][1] || '').trim().toUpperCase();
      if ((matNorm && rowMat === matNorm) || (nomeNorm && rowNome === nomeNorm)) {
        sheet.getRange(i + 2, 4).setValue(ibt);
        return true;
      }
    }
    return false;
  }

  return { getLocais, getMotoristas, getLocaisSimples, getLocaisParaManager, saveMotorista, updateMotoristaIbutton };
})();
