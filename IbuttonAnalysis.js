// ============================================================
//  IbuttonAnalysis.gs  —  Detecção de (não) utilização do iButton
//  Responsabilidade: a partir do enrichedTrip (já com a coluna
//  `funcionario` de cada ponto) e dos vínculos motorista↔trecho
//  montados pelo usuário, classificar cada trecho quanto ao uso do
//  iButton e emitir alertas no MESMO formato dos alertas de
//  AnalysisService (tipo / trecho / seq / alertKey / severidade),
//  para reaproveitar o pipeline de Questionamento ao Motorista.
//
//  Regras (definidas pelo usuário):
//   - "Não utilização de iButton" só vale quando HÁ motorista
//     vinculado ao trecho (escala preenchida manualmente).
//   - Se o motorista vinculado tem iButton cadastrado na base
//     MOTORISTAS e o trecho tem pontos sem identificação
//     ("Não Informado") → IBUTTON_NAO_UTILIZADO (cobrança).
//   - Se o motorista vinculado NÃO tem iButton na base → ele
//     provavelmente não possui; não é culpa dele →
//     IBUTTON_VERIFICACAO (só a pergunta "você tem iButton?",
//     fora do controle de reincidência).
//   - "Não cadastrado (XXXXX)": o iButton FOI lido, apenas o código
//     não está na base → NÃO é não utilização → IBUTTON_NAO_CADASTRADO
//     (abre o modal de cadastro do número, carregando o código lido).
//   - Pontos "Não Informado" FORA de qualquer vínculo →
//     MOTORISTA_AUSENTE (registro interno, sem envio).
//
//  Módulo puro: não lê planilha nem faz HTTP. Quem busca a base de
//  motoristas e persiste é Code.gs (analisarIbutton).
// ============================================================

var IbuttonAnalysis = (() => {

  // Severidades alinhadas com AnalysisService ('critico'|'atencao'|'revisar'|'info'|'justificado')
  var SEV = {
    IBUTTON_NAO_UTILIZADO: 'atencao',
    IBUTTON_VERIFICACAO:   'revisar',
    IBUTTON_NAO_CADASTRADO: 'revisar',
    MOTORISTA_AUSENTE:     'info'
  };

  // ============================================================
  //  API PÚBLICA
  // ============================================================

  /**
   * Analisa o uso do iButton por trecho.
   *
   * @param {Array<Object>} enrichedTrip  pontos cronológicos (seq 1..N) com
   *        campos { seq, ponto, entrada, saida, veiculo, funcionario, ... }
   * @param {Array<{matricula:string, nome:string, nomeCsv:string,
   *        ponto_inicio:string, ponto_fim:string, seqMin:number,
   *        seqMax:number}>} vinculos  vínculos motorista↔trecho (manuais)
   * @param {Array<{matricula:string, nome:string, base:string,
   *        ibutton:string}>} motoristas  base da aba MOTORISTAS
   * @returns {{ alerts: Array<Object>, resumo: Object }}
   */
  function analisar(enrichedTrip, vinculos, motoristas) {
    var trip = (enrichedTrip || []).slice().sort(function (a, b) {
      return Number(a.seq || 0) - Number(b.seq || 0);
    });
    var vincs = (vinculos || []).filter(function (v) {
      return v && v.seqMin != null && v.seqMax != null;
    });
    var base = motoristas || [];

    var alerts = [];

    // --- 1. Trechos COM motorista vinculado ---
    vincs.forEach(function (v) {
      var pts = trip.filter(function (p) {
        return Number(p.seq) >= Number(v.seqMin) && Number(p.seq) <= Number(v.seqMax);
      });
      if (!pts.length) return;

      var naoInformado  = pts.filter(function (p) { return _classificar(p.funcionario).classe === 'NAO_INFORMADO'; });
      var naoCadastrado = pts.filter(function (p) { return _classificar(p.funcionario).classe === 'NAO_CADASTRADO'; });

      var codigosLidos = _unicos(naoCadastrado.map(function (p) {
        return _classificar(p.funcionario).codigo;
      }).filter(Boolean));

      var mot = _acharMotorista(base, v.matricula, v.nome || v.nomeCsv);
      var temIbuttonCadastrado = !!(mot && String(mot.ibutton || '').trim());

      var ctx = {
        trecho:             _labelTrecho(pts),
        seq:                Number(v.seqMin),
        seqInicio:          Number(v.seqMin),
        seqFim:             Number(v.seqMax),
        motoristaNome:      v.nome || (mot && mot.nome) || v.nomeCsv || '',
        motoristaMatricula: String(v.matricula || (mot && mot.matricula) || '').trim(),
        veiculo:            (pts[0] && pts[0].veiculo) || '',
        dataHoraInicio:     (pts[0] && pts[0].entrada) || '',
        pontoInicio:        (pts[0] && pts[0].ponto) || v.ponto_inicio || '',
        pontoFim:           (pts[pts.length - 1] && pts[pts.length - 1].ponto) || v.ponto_fim || '',
        pontosTotal:        pts.length,
        pontosSemId:        naoInformado.length,
        pontosNaoCadastrado: naoCadastrado.length,
        codigosNaoCadastrados: codigosLidos
      };

      // 1a. iButton lido mas código fora da base → cadastro, não cobrança.
      if (naoCadastrado.length) {
        alerts.push(_montar('IBUTTON_NAO_CADASTRADO', ctx,
          'Foi identificada a leitura de iButton com código não cadastrado (' +
          codigosLidos.join(', ') + ') no trecho ' + ctx.trecho + '. ' +
          'O iButton foi utilizado; falta apenas vincular o código ao motorista.'));
      }

      // 1b. Pontos sem identificação nenhuma no trecho do motorista.
      if (naoInformado.length) {
        if (temIbuttonCadastrado) {
          alerts.push(_montar('IBUTTON_NAO_UTILIZADO', ctx,
            'Identificada a não utilização do iButton em ' + naoInformado.length + ' de ' +
            pts.length + ' registros do trecho ' + ctx.trecho +
            ', atribuído a ' + (ctx.motoristaNome || 'motorista') + ' pela escala.'));
        } else {
          alerts.push(_montar('IBUTTON_VERIFICACAO', ctx,
            (ctx.motoristaNome || 'O motorista') + ' não possui iButton cadastrado na base. ' +
            'Antes de qualquer cobrança, confirmar se ele tem o dispositivo.'));
        }
      }
    });

    // --- 2. Pontos "Não Informado" FORA de qualquer vínculo ---
    var cobertos = {};
    vincs.forEach(function (v) {
      for (var s = Number(v.seqMin); s <= Number(v.seqMax); s++) cobertos[s] = true;
    });

    var run = [];
    trip.forEach(function (p) {
      var descoberto = !cobertos[Number(p.seq)];
      var semMotorista = _classificar(p.funcionario).classe === 'NAO_INFORMADO';
      if (descoberto && semMotorista) {
        run.push(p);
      } else if (run.length) {
        alerts.push(_montarAusencia(run));
        run = [];
      }
    });
    if (run.length) alerts.push(_montarAusencia(run));

    var resumo = {
      naoUtilizado:  alerts.filter(function (a) { return a.tipo === 'IBUTTON_NAO_UTILIZADO'; }).length,
      verificacao:   alerts.filter(function (a) { return a.tipo === 'IBUTTON_VERIFICACAO'; }).length,
      naoCadastrado: alerts.filter(function (a) { return a.tipo === 'IBUTTON_NAO_CADASTRADO'; }).length,
      motoristaAusente: alerts.filter(function (a) { return a.tipo === 'MOTORISTA_AUSENTE'; }).length
    };

    return { alerts: alerts, resumo: resumo };
  }

  // ============================================================
  //  HELPERS
  // ============================================================

  /**
   * Classifica o valor da coluna `funcionario` de um ponto do CSV.
   * @param {string} funcionario
   * @returns {{classe:('NOMEADO'|'NAO_INFORMADO'|'NAO_CADASTRADO'), codigo:string, nome:string}}
   */
  function _classificar(funcionario) {
    var f = String(funcionario == null ? '' : funcionario).trim();
    if (!f) return { classe: 'NAO_INFORMADO', codigo: '', nome: '' };

    var low = f.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (low === 'nao informado' || low === 'nao identificado') {
      return { classe: 'NAO_INFORMADO', codigo: '', nome: '' };
    }
    if (/nao\s*cadastrad[oa]/.test(low)) {
      // "Não Cadastrado(25A89)", "Não cadastrado 08231", "Não cadastrado (035E9)"
      var resto = f.replace(/n[aã]o\s*cadastrad[oa]/i, '').replace(/[()]/g, ' ').trim();
      var m = resto.match(/[0-9A-Za-z]{3,8}/);
      return { classe: 'NAO_CADASTRADO', codigo: m ? m[0].toUpperCase() : '', nome: '' };
    }
    return { classe: 'NOMEADO', codigo: '', nome: f };
  }

  /** Normaliza texto para comparação (maiúsculo, sem acento, espaços colapsados). */
  function _norm(s) {
    return String(s == null ? '' : s).trim().toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ');
  }

  /**
   * Acha o motorista na base por matrícula (exata → sem zeros à esquerda) e,
   * em último caso, por nome normalizado (só quando único).
   * @returns {Object|null}
   */
  function _acharMotorista(base, matricula, nome) {
    var mat = String(matricula == null ? '' : matricula).trim();
    if (mat) {
      var exato = base.filter(function (m) { return String(m.matricula).trim() === mat; });
      if (exato.length === 1) return exato[0];
      var semZero = mat.replace(/^0+/, '');
      var porSemZero = base.filter(function (m) {
        return String(m.matricula).trim().replace(/^0+/, '') === semZero && semZero;
      });
      if (porSemZero.length === 1) return porSemZero[0];
    }
    var n = _norm(nome);
    if (n) {
      var porNome = base.filter(function (m) { return _norm(m.nome) === n; });
      if (porNome.length === 1) return porNome[0];
    }
    return null;
  }

  function _unicos(arr) {
    var seen = {};
    var out = [];
    arr.forEach(function (x) {
      var k = String(x);
      if (!seen[k]) { seen[k] = true; out.push(x); }
    });
    return out;
  }

  /** Rótulo "Primeiro ponto → Último ponto" de uma lista de pontos. */
  function _labelTrecho(pts) {
    if (!pts || !pts.length) return '';
    var ini = (pts[0] && pts[0].ponto) || '';
    var fim = (pts[pts.length - 1] && pts[pts.length - 1].ponto) || '';
    return ini && fim ? (ini + ' → ' + fim) : (ini || fim);
  }

  /**
   * Monta um alerta no formato consumido pelo cliente / QuestionamentoStore.
   * `alertKey` segue o contrato tipo|trecho|seq usado em AnalysisService.
   */
  function _montar(tipo, ctx, diagnostico) {
    return {
      tipo:               tipo,
      trecho:             ctx.trecho,
      seq:                ctx.seq,
      seqInicio:          ctx.seqInicio,
      seqFim:             ctx.seqFim,
      alertKey:           tipo + '|' + ctx.trecho + '|' + ctx.seqInicio,
      nivel:              SEV[tipo] === 'info' ? 'info' : (SEV[tipo] === 'atencao' ? 'atencao' : 'info'),
      severidade:         SEV[tipo],
      descricao:          diagnostico,
      diagnostico:        diagnostico,
      motoristaNome:      ctx.motoristaNome || '',
      motoristaMatricula: ctx.motoristaMatricula || '',
      veiculo:            ctx.veiculo || '',
      dataHoraInicio:     ctx.dataHoraInicio || '',
      pontoInicio:        ctx.pontoInicio || '',
      pontoFim:           ctx.pontoFim || '',
      pontosTotal:        ctx.pontosTotal || 0,
      pontosSemId:        ctx.pontosSemId || 0,
      codigosNaoCadastrados: ctx.codigosNaoCadastrados || [],
      // Verificação é pergunta neutra — nunca entra na contagem de reincidência.
      contaReincidencia:  (tipo === 'IBUTTON_NAO_UTILIZADO')
    };
  }

  /** Alerta MOTORISTA_AUSENTE para um trecho contíguo sem vínculo. */
  function _montarAusencia(pts) {
    var trecho = _labelTrecho(pts);
    var seqIni = Number(pts[0].seq);
    var seqFim = Number(pts[pts.length - 1].seq);
    return {
      tipo:          'MOTORISTA_AUSENTE',
      trecho:        trecho,
      seq:           seqIni,
      seqInicio:     seqIni,
      seqFim:        seqFim,
      alertKey:      'MOTORISTA_AUSENTE|' + trecho + '|' + seqIni,
      nivel:         'info',
      severidade:    'info',
      descricao:     'Trecho ' + trecho + ' sem motorista identificado e sem vínculo de escala — ' +
                     pts.length + ' registro(s). Tratado como ausência de motorista (registro interno, sem cobrança).',
      diagnostico:   'Nenhum motorista foi identificado nem vinculado a este trecho. ' +
                     'Conforme a regra, não se cobra não utilização de iButton sem vínculo confirmado.',
      veiculo:       (pts[0] && pts[0].veiculo) || '',
      dataHoraInicio: (pts[0] && pts[0].entrada) || '',
      pontosTotal:   pts.length,
      contaReincidencia: false
    };
  }

  return {
    analisar:    analisar,
    _classificar: _classificar // exposto para Tests.gs
  };

})();
