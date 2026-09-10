// ============================================================
//  QuestionamentoTemplates.gs  —  Texto da cobrança ao motorista
//  Tom formal e firme: registra a(s) falha(s) operacional(is) e exige
//  justificativa. Formatação do WhatsApp aplicada (*negrito*, _itálico_,
//  > citação, • listas) e, no consolidado, agrupamento por tipo de falha
//  para não virar um paredão de texto.
//
//  montarCapa()  → legenda curta do banner quando a mensagem é longa
//                  (o WhatsApp corta legenda de imagem em ~1024 caracteres;
//                   nesse caso o texto completo vai numa 2ª mensagem).
// ============================================================

var QuestionamentoTemplates = (() => {

  var TITULO = '*⚠️ MONITORAMENTO CATEDRAL*';

  /** Primeiro nome, capitalizado, para a saudação. */
  function _primeiroNome(nome) {
    var n = String(nome || '').trim().split(/\s+/)[0] || '';
    if (!n) return '';
    return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
  }

  /** Assinatura no fim da mensagem — varia conforme o monitor logado. */
  function _assinatura(nome) {
    var n = String(nome || '').trim();
    if (n.indexOf('@') > -1) n = n.split('@')[0];
    n = n.replace(/[._-]+/g, ' ').trim();
    if (n) n = n.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    return '\n\n_— ' + (n ? n + ', ' : '') + 'Equipe de Monitoramento Catedral_';
  }

  function _fmtMin(v) {
    var m = Math.round(Number(v) || 0);
    if (!m) return '';
    if (m < 60) return m + ' min';
    var hh = Math.floor(m / 60), mm = m % 60;
    return hh + 'h' + (mm ? ('0' + mm).slice(-2) : '');
  }

  /** "DD/MM/AAAA HH:MM" a partir de "YYYY-MM-DD HH:MM:SS" (ou '' se vazio). */
  function _fmtDataHora(s) {
    var t = String(s || '').trim().replace('T', ' ');
    var m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ ]?(\d{2}:\d{2})?/);
    if (!m) return '';
    return m[3] + '/' + m[2] + '/' + m[1] + (m[4] ? ' ' + m[4] : '');
  }

  /** Descrição factual da falha (minúscula) — usada na mensagem de 1 evento. */
  function _fato(ev) {
    var tipo  = String(ev.tipo || '').toUpperCase();
    var local = String(ev.trecho || ev.ponto || '').trim();
    var vel   = ev.velocidadeKmh != null ? (Math.round(ev.velocidadeKmh) + ' km/h') : '';
    var faixa = (ev.velEsperadaMin != null && ev.velEsperadaMax != null)
      ? (ev.velEsperadaMin + '–' + ev.velEsperadaMax + ' km/h') : '';
    var tempo = _fmtMin(ev.tempoMin);

    var quando = _fmtDataHora(ev.dataHoraInicio);
    var trechoTxt = String(ev.trechoSigla || ev.trecho || ev.ponto || '').trim();

    switch (tipo) {
      case 'IBUTTON_NAO_UTILIZADO':
        return 'foi identificada a *não utilização do iButton*' +
          (quando ? ' na viagem iniciada em ' + quando : '') +
          (trechoTxt ? ', trecho ' + trechoTxt : '') +
          (ev.linha ? ', linha ' + ev.linha : '') +
          (ev.veiculo ? ', prefixo ' + ev.veiculo : '') +
          '. A utilização do iButton é obrigatória durante toda a operação';
      case 'IBUTTON_VERIFICACAO':
        return 'não consta iButton vinculado ao seu cadastro' +
          (quando ? ' e a viagem iniciada em ' + quando : '') +
          (trechoTxt ? ' (trecho ' + trechoTxt + ')' : '') +
          ' não registrou identificação. Precisamos confirmar se você possui o dispositivo';
      case 'MOTORISTA_AUSENTE':
        return 'a viagem' + (trechoTxt ? ' no trecho ' + trechoTxt : '') +
          (quando ? ', iniciada em ' + quando + ',' : '') +
          ' não teve motorista identificado em nenhum ponto de controle';
      case 'PONTO_NAO_VISITADO':
        return 'o veículo não passou pelo ponto de controle ' + (local || 'previsto') +
          ', obrigatório no itinerário da linha';
      case 'LOCAL_NAO_IDENTIFICADO':
        return 'foi registrada parada em local não previsto no esquema da linha' +
          (local ? ' (' + local + ')' : '');
      case 'PARADA_PROIBIDA':
        return 'foi registrada parada em local não autorizado' + (local ? ' (' + local + ')' : '');
      case 'PARADA_LONGA':
        return 'o tempo de permanência ' + (local ? 'em ' + local + ' ' : '') +
          'foi ' + (tempo ? 'de ' + tempo + ', ' : '') + 'acima do limite previsto para o local';
      case 'VELOCIDADE_BAIXA':
        return 'a velocidade média ' + (local ? 'no trecho ' + local + ' ' : '') +
          (vel ? 'ficou em ' + vel + ', ' : 'ficou ') + 'abaixo do padrão operacional exigido' +
          (faixa ? ' (' + faixa + ')' : '');
      case 'VELOCIDADE_ALTA':
      case 'VELOCIDADE_EXCESSIVA':
        return 'a velocidade média ' + (local ? 'no trecho ' + local + ' ' : '') +
          (vel ? 'foi de ' + vel + ', ' : 'ficou ') + 'acima do limite estabelecido' +
          (faixa ? ' (padrão ' + faixa + ')' : '');
      default:
        var assunto = String(ev.evento_label || ev.label || ev.descricao || '').trim();
        return (assunto ? assunto.charAt(0).toLowerCase() + assunto.slice(1)
                        : 'foi identificada uma inconsistência operacional') +
          (local && assunto ? ' em ' + local : '');
    }
  }

  // Categorias do consolidado, na ordem de exibição.
  var _CATS = [
    { m: function (t) { return t === 'VELOCIDADE_ALTA' || t === 'VELOCIDADE_EXCESSIVA'; }, ico: '🚨', titulo: 'Excesso de velocidade' },
    { m: function (t) { return t === 'VELOCIDADE_BAIXA'; },                                 ico: '🐢', titulo: 'Velocidade abaixo do padrão' },
    { m: function (t) { return t === 'PARADA_PROIBIDA'; },                                  ico: '⛔', titulo: 'Parada em local não autorizado' },
    { m: function (t) { return t === 'PARADA_LONGA'; },                                     ico: '⏱️', titulo: 'Permanência acima do previsto' },
    { m: function (t) { return t === 'PONTO_NAO_VISITADO'; },                               ico: '📍', titulo: 'Ponto de controle não visitado' },
    { m: function (t) { return t === 'LOCAL_NAO_IDENTIFICADO'; },                           ico: '❓', titulo: 'Parada em local não previsto' },
    { m: function (t) { return t === 'IBUTTON_NAO_UTILIZADO'; },                            ico: '🔑', titulo: 'Não utilização do iButton' },
    { m: function (t) { return t === 'IBUTTON_VERIFICACAO'; },                              ico: '❔', titulo: 'Confirmação de iButton' },
    { m: function () { return true; },                                                     ico: '▫️', titulo: 'Outras inconsistências' }
  ];

  /** Linha (bullet) de um item dentro do seu grupo. */
  function _linhaItem(it) {
    var tipo  = String(it.tipo || '').toUpperCase();
    var local = String(it.trecho || it.ponto || '').trim();
    var vel   = it.velocidadeKmh != null ? Math.round(it.velocidadeKmh) : null;
    var faixa = (it.velEsperadaMin != null && it.velEsperadaMax != null)
      ? (it.velEsperadaMin + '–' + it.velEsperadaMax) : '';
    var tempo = _fmtMin(it.tempoMin);

    if (tipo === 'VELOCIDADE_BAIXA' || tipo === 'VELOCIDADE_ALTA' || tipo === 'VELOCIDADE_EXCESSIVA') {
      return (vel != null ? '*' + vel + ' km/h*' : 'velocidade fora do padrão') +
        (local ? ' — ' + local : '') + (faixa ? ' _(padrão ' + faixa + ' km/h)_' : '');
    }
    if (tipo === 'PARADA_LONGA') {
      return (local || 'local não informado') + (tempo ? ' — *' + tempo + '*' : '');
    }
    return local || String(it.label || it.descricao || 'item');
  }

  /**
   * Mensagem de cobrança de UM evento.
   * @param {Object} ev  { tipo, evento_label, ponto, trecho, motoristaNome,
   *                        monitorNome, velocidadeKmh, velEsperadaMin,
   *                        velEsperadaMax, tempoMin, distKm, descricao }
   */
  function montarMensagem(ev) {
    ev = ev || {};
    var nome = _primeiroNome(ev.motoristaNome);

    // iButton tem texto próprio (tom de cobrança para não utilização;
    // pergunta neutra para confirmação de posse do dispositivo).
    var tIb = String(ev.tipo || '').toUpperCase();
    if (tIb === 'IBUTTON_NAO_UTILIZADO' || tIb === 'IBUTTON_VERIFICACAO' || tIb === 'MOTORISTA_AUSENTE') {
      var fatoIb = _fato(ev);
      fatoIb = fatoIb.charAt(0).toUpperCase() + fatoIb.slice(1);
      var corpo = TITULO + '\n\nPrezado(a) *' + (nome || 'condutor(a)') + '*,\n\n> ' + fatoIb + '.\n\n';
      if (tIb === 'IBUTTON_NAO_UTILIZADO') {
        corpo += 'A ocorrência está sendo *registrada*. Informe, por favor, o *motivo* pelo qual o iButton não foi utilizado nesta viagem.\n\n' +
          '_A reincidência poderá resultar na aplicação de medidas disciplinares, conforme os procedimentos da empresa._\n' +
          'O retorno deve ser enviado por esta conversa.';
      } else if (tIb === 'IBUTTON_VERIFICACAO') {
        corpo += 'Você possui iButton? Caso *sim*, informe o *código* gravado na parte metálica do dispositivo (os *5 últimos números*), para regularizarmos seu cadastro; caso *não*, responda também por esta conversa.\n' +
          'O retorno deve ser enviado por esta conversa.';
      } else {
        corpo += 'Confirme quem foi o condutor responsável por este trecho.\n' +
          'O retorno deve ser enviado por esta conversa.';
      }
      return corpo + _assinatura(ev.monitorNome);
    }

    var fato = _fato(ev);
    fato = fato.charAt(0).toUpperCase() + fato.slice(1);
    return TITULO + '\n\n' +
      'Prezado(a) *' + (nome || 'condutor(a)') + '*, identificamos a seguinte falha operacional' +
      (ev.trecho ? ' no trecho *' + ev.trecho + '*' : '') + ', que *exige justificativa*:\n\n' +
      '> ' + fato + '.\n\n' +
      '_Solicitamos que apresente o esclarecimento o quanto antes._\nO retorno deve ser enviado por esta conversa.' +
      _assinatura(ev.monitorNome);
  }

  /**
   * Mensagem de cobrança CONSOLIDADA — falhas agrupadas por tipo.
   * @param {{motoristaNome:string, monitorNome:string, trecho:string, itens:Array}} opts
   */
  function montarMensagemConsolidada(opts) {
    opts = opts || {};
    var itens = opts.itens || [];
    var nome = _primeiroNome(opts.motoristaNome);
    var trechoTxt = String(opts.trecho || '').trim();
    var ondeTxt = trechoTxt ? 'no trecho *' + trechoTxt + '*' : 'no trecho sob sua responsabilidade';
    var cab = TITULO + '\n\nPrezado(a) *' + (nome || 'condutor(a)') + '*,';

    if (!itens.length) {
      return cab + ' precisamos de um posicionamento seu sobre ' + ondeTxt +
        '. O retorno deve ser enviado por esta conversa.' + _assinatura(opts.monitorNome);
    }

    var grupos = _CATS.map(function (c) { return { cat: c, lista: [] }; });
    itens.forEach(function (it) {
      var t = String(it.tipo || '').toUpperCase();
      for (var i = 0; i < _CATS.length; i++) {
        if (_CATS[i].m(t)) { grupos[i].lista.push(it); break; }
      }
    });

    var blocos = grupos
      .filter(function (g) { return g.lista.length; })
      .map(function (g) {
        var linhas = g.lista.map(function (it) { return '• ' + _linhaItem(it); }).join('\n');
        return '*' + g.cat.ico + ' ' + g.cat.titulo + ' (' + g.lista.length + ')*\n' + linhas;
      })
      .join('\n\n');

    var plural = itens.length > 1;
    var intro = ' identificamos *' + itens.length + (plural ? ' falhas operacionais*' : ' falha operacional*') +
      ' ' + ondeTxt + (plural ? ' que exigem' : ' que exige') + ' justificativa:';

    return cab + intro + '\n\n' + blocos + '\n\n' +
      '_Solicitamos que se manifeste sobre cada item acima o quanto antes._\n' +
      'O retorno deve ser enviado por esta conversa.' +
      _assinatura(opts.monitorNome);
  }

  /**
   * Legenda curta do banner quando a mensagem completa é longa demais para
   * caber na legenda da imagem (o corpo vai numa 2ª mensagem).
   * @param {{motoristaNome:string, trecho:string, total:number}} opts
   */
  function montarCapa(opts) {
    opts = opts || {};
    var nome = _primeiroNome(opts.motoristaNome);
    var n = Number(opts.total || 0);
    var trechoTxt = String(opts.trecho || '').trim();
    var plural = n !== 1;
    return TITULO + '\n\n' +
      'Prezado(a) *' + (nome || 'condutor(a)') + '*, registramos *' + n +
      (plural ? ' falhas operacionais*' : ' falha operacional*') +
      (trechoTxt ? ' no trecho *' + trechoTxt + '*' : '') +
      ' que ' + (plural ? 'exigem' : 'exige') + ' justificativa.\n\n' +
      'Os itens estão detalhados na mensagem a seguir. 👇';
  }

  return {
    montarMensagem: montarMensagem,
    montarMensagemConsolidada: montarMensagemConsolidada,
    montarCapa: montarCapa
  };

})();
