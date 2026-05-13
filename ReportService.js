// ============================================================
//  ReportService.gs  —  Geração e envio de relatórios operacionais
//  Responsabilidade: montar payloads estruturados de relatório,
//  calcular paradas/excessos e enviar para API externa
// ============================================================

var ReportService = (() => {
  var TEMPO_ESPERADO_PADRAO = 40;

  // ============================================================
  //  FUNÇÕES PÚBLICAS
  // ============================================================

  /**
   * Gera relatório por motorista.
   *
   * @param {Object} params
   * @param {string} params.idEsquema
   * @param {string} params.nomeLinha
   * @param {Object} params.motorista   — { matricula, nome, ponto_inicio, ponto_fim }
   * @param {Array}  params.enrichedTrip
   * @param {Array}  params.esquemaPontos
   * @param {Array}  params.segments    — resultado de analyzeTrip.segments
   * @returns {Object}  payload estruturado
   */
  function gerarRelatorioMotorista(params) {
    var idEsquema = params.idEsquema || "";
    var nomeLinha = params.nomeLinha || "";
    var motorista = params.motorista || {};
    var enrichedTrip = params.enrichedTrip || [];
    var esquemaPontos = params.esquemaPontos || [];
    var segments = params.segments || [];

    // Filtra por seq quando o cliente já calculou o intervalo (mais confiável que match por nome)
    var trechoTrip;
    if (params.seqInicio != null && params.seqFim != null) {
      var minSeq = Math.min(params.seqInicio, params.seqFim);
      var maxSeq = Math.max(params.seqInicio, params.seqFim);
      trechoTrip = enrichedTrip.filter(function(p) { return p.seq >= minSeq && p.seq <= maxSeq; });
      if (trechoTrip.length === 0) trechoTrip = enrichedTrip;
    } else {
      trechoTrip = ComparisonService.extrairTrecho(
        enrichedTrip,
        esquemaPontos,
        motorista.ponto_inicio,
        motorista.ponto_fim,
      );
    }

    // Comparação dentro do trecho
    var esquemaTrecho = _filtrarEsquemaComFallback(esquemaPontos, motorista.ponto_inicio, motorista.ponto_fim, trechoTrip);
    var comparacao = ComparisonService.compararRota(esquemaTrecho, trechoTrip);

    var pontosNaoVisitados =
      ComparisonService.getPontosNaoVisitados(comparacao);

    // Calcula paradas e excessos
    var paradas = _calcularParadas(trechoTrip);
    var excessos = _calcularExcessos(trechoTrip);

    // Eventos de alerta nos segmentos do trecho
    var eventos = _extrairEventos(segments, trechoTrip);

    var trechoInfo = {
      ponto_inicio: motorista.ponto_inicio || "",
      ponto_fim: motorista.ponto_fim || "",
      total_pontos: trechoTrip.length,
    };

    return {
      tipo: "MOTORISTA",
      id_esquema: idEsquema,
      nome_linha: nomeLinha,
      gerado_em: _nowIso(),
      motorista: {
        matricula: motorista.matricula || "",
        nome: motorista.nome || "",
        base: motorista.base || "",
      },
      trecho: trechoInfo,
      tripForMap: trechoTrip,          // apenas pontos do trecho para o mapa
      esquemaTrecho: esquemaTrecho,    // esquema filtrado ao trecho do motorista
      trechoStats: _computeTrechoStats(trechoTrip),
      pontos_nao_visitados: pontosNaoVisitados.map(function (p) {
        return {
          id_ponto: p.id_ponto,
          nome_ponto: p.nome_ponto,
          ordem: p.ordem,
        };
      }),
      paradas: paradas,
      excessos: excessos,
      eventos: eventos,
    };
  }

  /**
   * Gera relatório por trecho (sem motorista específico).
   *
   * @param {Object} params
   * @param {string} params.idEsquema
   * @param {string} params.nomeLinha
   * @param {string} params.idPontoA
   * @param {string} params.idPontoB
   * @param {Array}  params.enrichedTrip
   * @param {Array}  params.esquemaPontos
   * @param {Array}  params.segments
   * @returns {Object}  payload estruturado
   */
  function gerarRelatorioTrecho(params) {
    var idEsquema = params.idEsquema || "";
    var nomeLinha = params.nomeLinha || "";
    var idPontoA = params.idPontoA || "";
    var idPontoB = params.idPontoB || "";
    var enrichedTrip = params.enrichedTrip || [];
    var esquemaPontos = params.esquemaPontos || [];
    var segments = params.segments || [];

    // Filtra por seq quando o cliente já calculou o intervalo
    var trechoTrip;
    if (params.seqInicio != null && params.seqFim != null) {
      var minSeq = Math.min(params.seqInicio, params.seqFim);
      var maxSeq = Math.max(params.seqInicio, params.seqFim);
      trechoTrip = enrichedTrip.filter(function(p) { return p.seq >= minSeq && p.seq <= maxSeq; });
      if (trechoTrip.length === 0) trechoTrip = enrichedTrip;
    } else {
      trechoTrip = ComparisonService.extrairTrecho(
        enrichedTrip,
        esquemaPontos,
        idPontoA,
        idPontoB,
      );
    }

    var esquemaTrecho = _filtrarEsquemaComFallback(esquemaPontos, idPontoA, idPontoB, trechoTrip);
    var comparacao = ComparisonService.compararRota(esquemaTrecho, trechoTrip);
    var pontosNaoVisitados =
      ComparisonService.getPontosNaoVisitados(comparacao);

    var paradas = _calcularParadas(trechoTrip);
    var excessos = _calcularExcessos(trechoTrip);
    var eventos = _extrairEventos(segments, trechoTrip);

    return {
      tipo: "TRECHO",
      id_esquema: idEsquema,
      nome_linha: nomeLinha,
      gerado_em: _nowIso(),
      trecho: {
        ponto_inicio: idPontoA,
        ponto_fim: idPontoB,
        total_pontos: trechoTrip.length,
      },
      tripForMap: trechoTrip,
      esquemaTrecho: esquemaTrecho,    // esquema filtrado ao trecho
      trechoStats: _computeTrechoStats(trechoTrip),
      pontos_nao_visitados: pontosNaoVisitados.map(function (p) {
        return {
          id_ponto: p.id_ponto,
          nome_ponto: p.nome_ponto,
          ordem: p.ordem,
        };
      }),
      paradas: paradas,
      excessos: excessos,
      eventos: eventos,
    };
  }

  /**
   * Envia o relatório para a API de ocorrências.
   * Fluxo de 2 etapas:
   *   1. POST /occurrences  → cria o registro e obtém o ID
   *   2. GET /reports/occurrences/:id/pdf  → gera e obtém URL do PDF
   *
   * Requer Script Properties:
   *   REPORT_API_URL    — base URL da API (ex: https://api.example.com)
   *   REPORT_TYPE_CODE  — código do tipo de ocorrência (ex: ANALISE_OP)
   *   REPORTS_PDF_TTL   — TTL da URL assinada em segundos (padrão: 3600)
   *
   * @param {Object} payload  — payload estruturado gerado por gerarRelatorio*
   * @param {Object} params   — params originais (contém enrichedTrip, summary, etc.)
   * @returns {Object}  { status, body: { id, url } }
   */
  function enviarParaAPI(payload, params) {
    var props = PropertiesService.getScriptProperties();
    var baseUrl = (props.getProperty("REPORT_API_URL") || "").replace(
      /\/$/,
      "",
    );
    if (!baseUrl) {
      throw new Error(
        "Propriedade REPORT_API_URL não configurada nas Script Properties.",
      );
    }

    // ── Passo 1: monta o payload de ocorrência ──────────────────────
    var occPayload = _buildOccurrencePayload(payload, params || {});

    var createResp = UrlFetchApp.fetch(baseUrl + "/occurrences", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(occPayload),
      muteHttpExceptions: true,
    });

    var createCode = createResp.getResponseCode();
    var createBody = createResp.getContentText();

    if (createCode < 200 || createCode > 299) {
      throw new Error(
        "API /occurrences retornou HTTP " + createCode + ": " + createBody,
      );
    }

    var createParsed = {};
    try {
      createParsed = JSON.parse(createBody);
    } catch (e) {
      createParsed = { raw: createBody };
    }

    var occurrenceId = createParsed.id;
    if (!occurrenceId) {
      // Criou mas não retornou ID — retorna o body como está
      return { status: createCode, body: createParsed };
    }

    // ── Passo 2: gera o PDF ─────────────────────────────────────────
    var ttl = props.getProperty("REPORTS_PDF_TTL") || "3600";
    var pdfResp = UrlFetchApp.fetch(
      baseUrl +
        "/reports/occurrences/" +
        occurrenceId +
        "/pdf?ttl=" +
        ttl,
      { method: "get", muteHttpExceptions: true },
    );

    var pdfCode = pdfResp.getResponseCode();
    if (pdfCode < 200 || pdfCode > 299) {
      // Ocorrência criada mas PDF falhou — retorna ID sem URL
      return {
        status: createCode,
        body: {
          id: occurrenceId,
          warning: "PDF generation failed (HTTP " + pdfCode + ")",
        },
      };
    }

    var pdfParsed = {};
    try {
      pdfParsed = JSON.parse(pdfResp.getContentText());
    } catch (e) {}

    return {
      status: 200,
      body: {
        id: occurrenceId,
        url: (pdfParsed.data && pdfParsed.data.pdf && pdfParsed.data.pdf.signedUrl) || null,
      },
    };
  }

  // ============================================================
  //  HELPERS PRIVADOS
  // ============================================================

  /**
   * Filtra os pontos do esquema para o intervalo entre idPontoA e idPontoB.
   */
  function _filtrarEsquemaPorTrecho(esquemaPontos, idPontoA, idPontoB) {
    if (!idPontoA || !idPontoB) return esquemaPontos;

    var keyA = String(idPontoA).trim();
    var keyB = String(idPontoB).trim();
    var ordemA = null;
    var ordemB = null;
    esquemaPontos.forEach(function (ep) {
      var epId   = String(ep.id_ponto   || '').trim();
      var epNome = String(ep.nome_ponto || '').trim();
      if (epId === keyA || epNome === keyA) ordemA = ep.ordem;
      if (epId === keyB || epNome === keyB) ordemB = ep.ordem;
    });

    if (ordemA === null || ordemB === null) return null;

    var minOrdem = Math.min(ordemA, ordemB);
    var maxOrdem = Math.max(ordemA, ordemB);

    return esquemaPontos.filter(function (ep) {
      return ep.ordem >= minOrdem && ep.ordem <= maxOrdem;
    });
  }

  /**
   * Filtra esquema pelo trecho com fallback por seq quando o match por nome/id falha.
   * @param {Array}  esquemaPontos
   * @param {string} pontoA
   * @param {string} pontoB
   * @param {Array}  trechoTrip  — pontos reais do trecho (já filtrados por seq)
   */
  function _filtrarEsquemaComFallback(esquemaPontos, pontoA, pontoB, trechoTrip) {
    var byName = _filtrarEsquemaPorTrecho(esquemaPontos, pontoA, pontoB);
    if (byName !== null) return byName;

    // Fallback: infere intervalo de ordem pelos codigos visitados no trechoTrip
    var codigosSet = {};
    trechoTrip.forEach(function(p) {
      if (p.matched && p.codigo) codigosSet[String(p.codigo)] = true;
    });
    var ordens = esquemaPontos
      .filter(function(ep) { return codigosSet[String(ep.id_ponto)]; })
      .map(function(ep) { return ep.ordem; });

    if (ordens.length >= 2) {
      var lo = Math.min.apply(null, ordens);
      var hi = Math.max.apply(null, ordens);
      return esquemaPontos.filter(function(ep) { return ep.ordem >= lo && ep.ordem <= hi; });
    }
    // último recurso: só os visitados
    return esquemaPontos.filter(function(ep) { return codigosSet[String(ep.id_ponto)]; });
  }

  /**
   * Calcula paradas do trecho (pontos com parada_s > 0).
   * Tempo real - tempo esperado:
   *   garagem   → 40 min esperado
   *   rodoviaria → 15 min esperado
   *   padrão    → 5 min esperado
   */
  function _calcularParadas(trechoTrip) {
    var paradas = [];
    var lastIdx = trechoTrip.length - 1;
    trechoTrip.forEach(function (pt, idx) {
      if (idx === 0 || idx === lastIdx) return;
      if (!pt.parada_s || pt.parada_s <= 0) return;
      var tipoKey = String(pt.tipo || '').trim();
      var paradaMin = Math.round((pt.parada_s / 60) * 10) / 10;

      var nome = String(pt.ponto || '').toUpperCase();
      var esperadoMin = /RODOVI[AÁ]RIA|RODOVIARIA/.test(nome) ? 15
        : /GARAGEM/.test(nome) ? 20
        : TEMPO_ESPERADO_PADRAO; // 40 min para qualquer outro
      var semLimite = false;

      paradas.push({
        ponto: pt.ponto,
        codigo: pt.codigo || null,
        entrada: pt.entrada,
        saida: pt.saida,
        parada_min: paradaMin,
        esperado_min: esperadoMin,
        excesso_min: semLimite || esperadoMin === null
          ? 0
          : Math.max(0, Math.round((paradaMin - esperadoMin - 5) * 10) / 10),
        sem_limite: semLimite,
        tipo: tipoKey,
      });
    });
    return paradas;
  }

  /**
   * Retorna somente as paradas com excesso de tempo (tempo real > esperado).
   * Pontos sem limite definido (tipo 1 — fechamento) são excluídos.
   */
  function _calcularExcessos(trechoTrip) {
    return _calcularParadas(trechoTrip).filter(function (p) {
      return !p.sem_limite && p.excesso_min > 0;
    });
  }

  /**
   * Extrai eventos de alerta dos segmentos que envolvam pontos do trecho.
   */
  function _extrairEventos(segments, trechoTrip) {
    if (!segments || !segments.length) return [];

    // Conjunto de nomes de pontos no trecho
    var pontosNoTrecho = {};
    trechoTrip.forEach(function (pt) {
      if (pt.ponto) pontosNoTrecho[pt.ponto] = true;
    });

    var eventos = [];
    segments.forEach(function (seg) {
      if (!seg.alertas || !seg.alertas.length) return;
      // Inclui segmento se "de" ou "para" está no trecho
      var noTrecho = pontosNoTrecho[seg.de] || pontosNoTrecho[seg.para];
      if (!noTrecho) return;
      seg.alertas.forEach(function (a) {
        eventos.push({
          tipo: a.tipo,
          nivel: a.nivel,
          descricao: a.descricao,
          trecho: seg.de + " → " + seg.para,
        });
      });
    });

    return eventos;
  }

  // ============================================================
  //  RELATÓRIO COMPLETO
  // ============================================================

  /**
   * Gera relatório consolidado com toda a viagem (sem filtro de trecho/motorista).
   * @param {Object} params
   * @returns {Object}  payload estruturado
   */
  function gerarRelatorioCompleto(params) {
    var idEsquema = params.idEsquema || "";
    var nomeLinha = params.nomeLinha || "";
    var enrichedTrip = params.enrichedTrip || [];
    var esquemaPontos = params.esquemaPontos || [];
    var segments = params.segments || [];

    var paradas = _calcularParadas(enrichedTrip);
    var excessos = _calcularExcessos(enrichedTrip);
    var eventos = _extrairEventos(segments, enrichedTrip);

    var comparacao =
      esquemaPontos.length > 0
        ? ComparisonService.compararRota(esquemaPontos, enrichedTrip)
        : [];
    var pontosNaoVisitados =
      comparacao.length > 0
        ? ComparisonService.getPontosNaoVisitados(comparacao)
        : [];

    return {
      tipo: "COMPLETO",
      id_esquema: idEsquema,
      nome_linha: nomeLinha,
      gerado_em: _nowIso(),
      trecho: {
        ponto_inicio: enrichedTrip.length > 0 ? enrichedTrip[0].ponto : "",
        ponto_fim:
          enrichedTrip.length > 0
            ? enrichedTrip[enrichedTrip.length - 1].ponto
            : "",
        total_pontos: enrichedTrip.length,
      },
      tripForMap: enrichedTrip,
      trechoStats: _computeTrechoStats(enrichedTrip),
      pontos_nao_visitados: pontosNaoVisitados.map(function (p) {
        return {
          id_ponto: p.id_ponto,
          nome_ponto: p.nome_ponto,
          ordem: p.ordem,
        };
      }),
      paradas: paradas,
      excessos: excessos,
      eventos: eventos,
    };
  }

  // ============================================================
  //  HELPERS DE INTEGRAÇÃO COM API
  // ============================================================

  /**
   * Converte o payload estruturado do relatório para o formato
   * esperado pelo endpoint POST /occurrences da API.
   */
  function _buildOccurrencePayload(payload, params) {
    var props = PropertiesService.getScriptProperties();
    var typeCode = props.getProperty("REPORT_TYPE_CODE") || "ANALISE_OP";
    var enrichedTrip = params.enrichedTrip || [];
    var summary = params.summary || {};

    // Datas e horários — usa o trecho filtrado como referência de tempo
    var tripForMap = payload.tripForMap || enrichedTrip;
    var firstPt = tripForMap[0] || enrichedTrip[0] || {};
    var lastPt  = tripForMap[tripForMap.length - 1] || enrichedTrip[enrichedTrip.length - 1] || {};
    var tripDate = _parseDateBrToIso(summary.dataViagem || "");
    var today = _todayIso();
    var startTime = _extractTime(firstPt.entrada);
    var endTime   = _extractTime(lastPt.saida || lastPt.entrada);

    var mapaHtml = "";

    // Relato em HTML estruturado
    var relatoHtml = mapaHtml + _buildRelatoHtml(payload, params);

    // Título do relatório
    var titulo = _buildReportTitle(payload, params);

    return {
      typeCode: typeCode,
      eventDate: tripDate || today,
      tripDate: tripDate || today,
      startTime: startTime || "00:00",
      endTime: endTime || "23:59",
      vehicleNumber: String(
        summary.veiculo || firstPt.veiculo || "" || "—",
      ).trim(),
      lineLabel: params.nomeLinha || "",
      tripTime: params.horario || startTime || null,
      reportTitle: titulo,
      relatoHtml: relatoHtml,
      // place = trecho analisado (exibido em DADOS DA VIAGEM para ANALISE_OP)
      place: (function() {
        var t = payload.trecho || {};
        if (!t.ponto_inicio || !t.ponto_fim) return '';
        return t.ponto_inicio + ' \u2192 ' + t.ponto_fim + ' (' + (t.total_pontos || 0) + ' pontos)';
      })(),
      showSectionTripulacao: !!(payload.motorista && (payload.motorista.nome || payload.motorista.matricula)),
      showSectionPassageiros: false,
      showSectionDados: false,
      showSectionViagem: true,
      showSectionIdentificacao: false,
      drivers: (function() {
        var m = payload.motorista || {};
        if (!m.nome && !m.matricula) return [];
        return [{ position: 1, name: m.nome || '', registry: m.matricula || '', baseCode: m.base || '' }];
      })(),
      paradasProibidas: (function() {
        var tripForMap = payload.tripForMap || [];
        var esquemaPontos = payload.esquemaTrecho || params.esquemaPontos || [];
        var esquemaIdSet = {};
        esquemaPontos.forEach(function(ep) {
          if (ep.id_ponto) esquemaIdSet[String(ep.id_ponto).trim()] = true;
        });
        var lastIdx = tripForMap.length - 1;
        var result = [];
        tripForMap.forEach(function(pt, idx) {
          if (idx === 0 || idx === lastIdx) return;
          if (!pt.parada_s || pt.parada_s <= 0) return;
          if (pt.codigo && esquemaIdSet[String(pt.codigo).trim()]) return;
          if (!pt.proibido42) return;
          result.push({ localNome: pt.ponto || '—', localCodigo: pt.codigo || null });
        });
        return result;
      })(),
      paradaForaRelatoHtml: _buildEsquemaHtml(
        params.esquemaPontos || [],
        params.nomeLinha || '',
        params.horario   || ''
      ),
    };
  }

  function _buildEsquemaHtml(esquemaPontos, nomeLinha, horarioEsquema) {
    var esquemaOrdenado = (esquemaPontos || []).slice().sort(function(a, b) {
      return (a.ordem || 0) - (b.ordem || 0);
    });
    if (esquemaOrdenado.length === 0) return '';
    var TH = 'background:#f0f2f8;padding:6px 10px;font-size:9px;font-weight:700;text-transform:uppercase;' +
             'letter-spacing:.05em;color:#5a6070;border:1px solid #cdd2e5;white-space:nowrap;';
    var TD = 'padding:7px 10px;border:1px solid #dde1ee;vertical-align:middle;';
    var temComercial = esquemaOrdenado.some(function(ep) { return ep.horario_comercial; });
    var temParada    = esquemaOrdenado.some(function(ep) { return ep.tempo_local; });
    var h = '<div style="border-top:2px solid #f47920;padding-top:16px;">' +
            '<h4 style="font-size:13px;margin:0 0 10px;color:#1a1d23;font-weight:800;letter-spacing:0.02em;">' +
            'Esquema da Viagem — ' + (nomeLinha || '—') +
            (horarioEsquema ? ' &nbsp;·&nbsp; <span style="color:#f47920;">' + horarioEsquema + '</span>' : '') +
            '</h4>' +
            '<table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid #cdd2e5;">' +
            '<thead><tr>' +
            '<th style="' + TH + 'text-align:center;width:36px;">#</th>' +
            '<th style="' + TH + 'text-align:left;">Cidade</th>' +
            (temComercial ? '<th style="' + TH + 'text-align:center;">Horário</th>' : '') +
            (temParada    ? '<th style="' + TH + 'text-align:center;">Parada</th>'  : '') +
            '</tr></thead><tbody>';
    esquemaOrdenado.forEach(function(ep, idx) {
      var isFirst = idx === 0;
      var isLast  = idx === esquemaOrdenado.length - 1;
      var rowBg   = isFirst ? 'background:#f0fff8;'
                  : isLast  ? 'background:#fff8f0;'
                  : (!ep.horario_comercial && temComercial) ? 'background:#fff8f2;' : '';
      var nomeCel = '<strong>' + (ep.nome_ponto || ep.id_ponto || '—') + '</strong>' +
                    (isFirst ? ' <span style="font-size:9px;background:#f47920;color:#fff;border-radius:3px;padding:1px 5px;margin-left:3px;">✈</span>' : '');
      var horCel  = ep.horario_comercial
        ? '<strong style="color:#1565c0;">' + ep.horario_comercial + '</strong>'
        : '<span style="color:#ccc;">—</span>';
      var paradaCel = (isFirst || isLast) ? '—' : (ep.tempo_local ? ep.tempo_local : '00:05');
      h += '<tr style="' + rowBg + '">' +
           '<td style="' + TD + 'text-align:center;color:#888;">' + (ep.ordem || idx + 1) + '</td>' +
           '<td style="' + TD + '">' + nomeCel + '</td>' +
           (temComercial ? '<td style="' + TD + 'text-align:center;font-family:monospace;">' + horCel    + '</td>' : '') +
           (temParada    ? '<td style="' + TD + 'text-align:center;">'                       + paradaCel + '</td>' : '') +
           '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  /**
   * Gera título curto para o relatório.
   */
  function _buildReportTitle(payload, params) {
    var linha = params.nomeLinha || payload.nome_linha || "";
    var veiculo = (params.summary || {}).veiculo || "";
    var tipo = payload.tipo || "";
    var horario = params.horario || "";
    var partes = ["Análise de Viagem"];
    if (linha) partes.push(linha + (horario ? " " + horario : ""));
    if (veiculo) partes.push("Veículo " + veiculo);
    if (tipo === "MOTORISTA" && payload.motorista)
      partes.push(payload.motorista.nome);
    return partes.join(" · ");
  }

  /**
   * Gera HTML com a imagem do mapa estático via Google Maps.
   * Usa apenas os pontos identificados (com lat/lng) do trecho.
   */
  function _buildMapaHtml(enrichedTrip, apiKey) {
    if (!apiKey || !enrichedTrip || enrichedTrip.length === 0) return "";

    var pontos = enrichedTrip.filter(function (p) {
      return (
        p.lat && p.lng && typeof p.lat === "number" && typeof p.lng === "number"
      );
    });
    if (pontos.length < 2) return "";

    // Simplifica: no máximo 50 pontos para não ultrapassar o limite de URL
    var passo = Math.max(1, Math.floor(pontos.length / 50));
    var sample = [];
    for (var i = 0; i < pontos.length; i += passo) {
      sample.push(pontos[i]);
    }
    // Garante que o último ponto está incluído
    if (sample[sample.length - 1] !== pontos[pontos.length - 1]) {
      sample.push(pontos[pontos.length - 1]);
    }

    var pathCoords = sample
      .map(function (p) {
        return p.lat + "," + p.lng;
      })
      .join("|");
    var pathStr = "color:0xF4791FFF|weight:4|" + pathCoords;

    // Marcadores: início (verde) e fim (vermelho)
    var markerInicio =
      "color:green|label:I|" + pontos[0].lat + "," + pontos[0].lng;
    var markerFim =
      "color:red|label:F|" +
      pontos[pontos.length - 1].lat +
      "," +
      pontos[pontos.length - 1].lng;

    var url =
      "https://maps.googleapis.com/maps/api/staticmap" +
      "?size=640x360&maptype=roadmap&scale=2" +
      "&path=" +
      encodeURIComponent(pathStr) +
      "&markers=" +
      encodeURIComponent(markerInicio) +
      "&markers=" +
      encodeURIComponent(markerFim) +
      "&key=" +
      encodeURIComponent(apiKey);

    return (
      '<div style="margin-bottom:20px;">' +
      '<img src="' +
      url +
      '" alt="Mapa da Rota" ' +
      'style="width:100%;max-width:640px;border-radius:8px;border:1px solid #e0e0e0;" />' +
      '<div style="font-size:10px;color:#999;margin-top:4px;text-align:center;">Rota operacional · ' +
      pontos.length +
      " pontos com coordenadas</div>" +
      "</div>"
    );
  }

  /**
   * Gera um mapa vetorial SVG da rota a partir das coordenadas do enrichedTrip.
   * Não depende de API externa — usa projeção Mercator simples.
   * Inclui traçado colorido por velocidade e marcadores de início/fim.
   */
  function _buildMapaSvg(enrichedTrip) {
    var W = 660, H = 320, PAD = 24;

    var pontos = (enrichedTrip || []).filter(function(p) {
      return p.lat && p.lng && typeof p.lat === 'number' && typeof p.lng === 'number';
    });
    if (pontos.length < 2) return '';

    // Projeção Mercator: lat → Y
    function mercY(lat) {
      var r = lat * Math.PI / 180;
      return Math.log(Math.tan(Math.PI / 4 + r / 2));
    }

    var lats = pontos.map(function(p) { return p.lat; });
    var lngs = pontos.map(function(p) { return p.lng; });
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    var minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
    var minY = mercY(minLat), maxY = mercY(maxLat);

    var scaleX = (W - PAD * 2) / (maxLng - minLng || 1);
    var scaleY = (H - PAD * 2) / (maxY - minY || 1);

    function toX(lng) { return PAD + (lng - minLng) * scaleX; }
    function toY(lat) { return H - PAD - (mercY(lat) - minY) * scaleY; }

    // Segmentos coloridos por velocidade
    var segSvg = '';
    for (var i = 0; i < pontos.length - 1; i++) {
      var a = pontos[i], b = pontos[i + 1];
      var vel = a.velocidade_kmh || 0;
      var cor = vel >= 100 ? '#d94040'
              : vel >= 90  ? '#e8820a'
              : vel >= 80  ? '#f4c430'
              : vel >= 50  ? '#22a96a'
              : '#5b8dd9';
      segSvg += '<line x1="' + toX(a.lng).toFixed(1) + '" y1="' + toY(a.lat).toFixed(1) +
                '" x2="' + toX(b.lng).toFixed(1) + '" y2="' + toY(b.lat).toFixed(1) +
                '" stroke="' + cor + '" stroke-width="3" stroke-linecap="round"/>';
    }

    // Marcadores de parada (pontos com parada_s > 0)
    var stopSvg = '';
    pontos.forEach(function(p) {
      if (p.parada_s && p.parada_s > 60) {
        stopSvg += '<circle cx="' + toX(p.lng).toFixed(1) + '" cy="' + toY(p.lat).toFixed(1) +
                   '" r="4" fill="white" stroke="#444" stroke-width="1.5"/>';
      }
    });

    // Marcadores de início e fim
    var p0 = pontos[0], pN = pontos[pontos.length - 1];
    var startMark = '<circle cx="' + toX(p0.lng).toFixed(1) + '" cy="' + toY(p0.lat).toFixed(1) +
                    '" r="7" fill="#22a96a" stroke="white" stroke-width="2"/>' +
                    '<text x="' + toX(p0.lng).toFixed(1) + '" y="' + (toY(p0.lat) + 4).toFixed(1) +
                    '" font-size="8" font-weight="bold" fill="white" text-anchor="middle">A</text>';
    var endMark   = '<circle cx="' + toX(pN.lng).toFixed(1) + '" cy="' + toY(pN.lat).toFixed(1) +
                    '" r="7" fill="#d94040" stroke="white" stroke-width="2"/>' +
                    '<text x="' + toX(pN.lng).toFixed(1) + '" y="' + (toY(pN.lat) + 4).toFixed(1) +
                    '" font-size="8" font-weight="bold" fill="white" text-anchor="middle">B</text>';

    // Legenda
    var legenda =
      '<rect x="' + (W - 155) + '" y="8" width="147" height="74" rx="4" fill="white" fill-opacity="0.88" stroke="#ddd" stroke-width="1"/>' +
      '<text x="' + (W - 148) + '" y="23" font-size="9" font-weight="bold" fill="#333">Velocidade</text>' +
      _svgLegendRow(W - 148, 35, '#22a96a', '≤ 79 km/h') +
      _svgLegendRow(W - 148, 47, '#f4c430', '80–89 km/h') +
      _svgLegendRow(W - 148, 59, '#e8820a', '90–99 km/h') +
      _svgLegendRow(W - 148, 71, '#d94040', '≥ 100 km/h');

    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"' +
              ' style="background:#e8f0f8;border-radius:8px;">' +
              '<rect width="' + W + '" height="' + H + '" fill="#e8f0f8" rx="8"/>' +
              segSvg + stopSvg + startMark + endMark + legenda +
              '</svg>';

    var b64 = Utilities.base64Encode(svg);
    return '<div style="margin-bottom:20px;">' +
           '<img src="data:image/svg+xml;base64,' + b64 + '" alt="Mapa da Rota" ' +
           'style="width:100%;max-width:' + W + 'px;border-radius:8px;border:1px solid #dde3ef;" />' +
           '<div style="font-size:10px;color:#999;margin-top:4px;text-align:center;">Rota operacional</div>' +
           '</div>';
  }

  function _svgLegendRow(x, y, cor, label) {
    return '<rect x="' + x + '" y="' + (y - 7) + '" width="16" height="8" rx="2" fill="' + cor + '"/>' +
           '<text x="' + (x + 20) + '" y="' + y + '" font-size="8.5" fill="#444">' + label + '</text>';
  }

  function _fmtMin(min) {
    var total = Math.round(Number(min) || 0);
    var hh = Math.floor(total / 60);
    var mm = total % 60;
    return ('0' + hh).slice(-2) + 'h' + ('0' + mm).slice(-2);
  }

  /**
   * Gera o corpo HTML estruturado do relatório operacional.
   */
  function _buildRelatoHtml(payload, params) {
    var summary = params.summary || {};
    var stats = payload.trechoStats || {};  // km/tempo do trecho filtrado
    var linhaStr = params.nomeLinha || payload.nome_linha || "—";
    var horarioEsquema = params.horario || "";
    var motorista = payload.motorista || {};
    var trecho = payload.trecho || {};
    var paradas = payload.paradas || [];
    var excessos = payload.excessos || [];
    var eventos = payload.eventos || [];
    var naoVisit = payload.pontos_nao_visitados || [];

    // Para MOTORISTA/TRECHO usa o esquema filtrado ao trecho; para COMPLETO usa o esquema inteiro
    var esquemaPontos = payload.esquemaTrecho || params.esquemaPontos || [];
    var esquemaIdSet = {};
    esquemaPontos.forEach(function(ep) {
      if (ep.id_ponto) esquemaIdSet[String(ep.id_ponto).trim()] = true;
    });

    // Pontos extremos do esquema (início e fim da operação) não são penalizados por parada
    var _esqOrd = esquemaPontos.slice().sort(function(a, b) { return (a.ordem || 0) - (b.ordem || 0); });
    var _extremos = {};
    if (_esqOrd.length > 0) {
      var _cA = String(_esqOrd[0].id_ponto || '').trim();
      var _cZ = String(_esqOrd[_esqOrd.length - 1].id_ponto || '').trim();
      if (_cA) _extremos[_cA] = true;
      if (_cZ) _extremos[_cZ] = true;
    }
    paradas = paradas.filter(function(p) { return !p.codigo || !_extremos[String(p.codigo).trim()]; });
    excessos = excessos.filter(function(e) { return !e.codigo || !_extremos[String(e.codigo).trim()]; });

    // Tempo esperado por ponto (do esquema operacional)
    var esqTLMap = {};
    _esqOrd.forEach(function(ep) {
      if (ep.id_ponto && ep.tempo_local) {
        var parts = String(ep.tempo_local).trim().split(':');
        var tl = parts.length === 2
          ? (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0)
          : parseFloat(ep.tempo_local) || 0;
        if (tl > 0) esqTLMap[String(ep.id_ponto).trim()] = tl;
      }
    });

    var tripForMap = payload.tripForMap || [];
    var tripLastIdx = tripForMap.length - 1;
    var paradasFora = [];
    tripForMap.forEach(function(pt, idx) {
      if (idx === 0 || idx === tripLastIdx) return;
      if (!pt.matched || !pt.parada_s || pt.parada_s <= 0) return;
      if (pt.codigo && esquemaIdSet[String(pt.codigo).trim()]) return;
      paradasFora.push({
        ponto:      pt.ponto,
        codigo:     pt.codigo || null,
        entrada:    pt.entrada,
        saida:      pt.saida,
        parada_min: Math.round((pt.parada_s / 60) * 10) / 10,
        proibido:   !!(pt.proibido42),
      });
    });

    var h = "";

    // Cabeçalho de resumo — usa stats do trecho filtrado (não da viagem completa)
    h +=
      '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;">';
    h += '<tr style="background:#f5f5f5;">';
    var dataViagem = summary.dataViagem || stats.dataInicio || "";
    if (dataViagem)
      h += '<td style="padding:6px 10px;"><strong>Data da viagem</strong><br/>' + dataViagem + "</td>";
    if (summary.veiculo)
      h += '<td style="padding:6px 10px;"><strong>Veículo</strong><br/>' + summary.veiculo + "</td>";
    if (linhaStr !== "—")
      h += '<td style="padding:6px 10px;"><strong>Linha</strong><br/>' + linhaStr + "</td>";
    if (horarioEsquema)
      h += '<td style="padding:6px 10px;"><strong>Horário</strong><br/>' + horarioEsquema + "</td>";
    var kmTrecho = stats.totalKm != null ? stats.totalKm : summary.totalKm;
    if (kmTrecho)
      h += '<td style="padding:6px 10px;"><strong>Km (trecho)</strong><br/>' + kmTrecho + " km</td>";
    if (stats.inicio)
      h += '<td style="padding:6px 10px;"><strong>Início</strong><br/>' + stats.inicio + "</td>";
    if (stats.fim)
      h += '<td style="padding:6px 10px;"><strong>Fim</strong><br/>' + stats.fim + "</td>";
    h += "</tr></table>";

    // Tabela de registro do trecho — chegada / tempo no local / saída (MOTORISTA e TRECHO)
    if (payload.tipo !== 'COMPLETO' && tripForMap.length > 0) {
      var pontosRegistro = tripForMap.filter(function(pt) {
        return pt.matched || (pt.parada_s && pt.parada_s > 0);
      });
      if (pontosRegistro.length > 0) {
        var THR = 'background:#f0f2f8;padding:6px 10px;font-size:9px;font-weight:700;text-transform:uppercase;' +
                  'letter-spacing:.05em;color:#5a6070;border:1px solid #cdd2e5;white-space:nowrap;text-align:center;';
        var TDR = 'padding:7px 10px;border:1px solid #dde1ee;vertical-align:middle;font-size:11px;';
        h += '<div style="margin-bottom:20px;">' +
             '<h4 style="font-size:13px;margin:0 0 10px;color:#1a1d23;font-weight:800;letter-spacing:0.02em;">' +
             'Registro do Trecho</h4>' +
             '<table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid #cdd2e5;">' +
             '<thead><tr>' +
             '<th style="' + THR + 'width:32px;">#</th>' +
             '<th style="' + THR + 'text-align:left;">Ponto</th>' +
             '<th style="' + THR + '">Chegada</th>' +
             '<th style="' + THR + '">Tempo no Local</th>' +
             '<th style="' + THR + '">Saída</th>' +
             '</tr></thead><tbody>';
        var _firstGaragem = /GARAGEM/.test(String((pontosRegistro[0] || {}).ponto || '').toUpperCase());
        var _hasMiddle = pontosRegistro.some(function(pt, i) {
          return i > 0 && i < pontosRegistro.length - 1 && !/GARAGEM/.test(String(pt.ponto || '').toUpperCase());
        });
        var _showFim = !_firstGaragem || _hasMiddle;
        var _isMotorista = payload.tipo === 'MOTORISTA';
        pontosRegistro.forEach(function(pt, idx) {
          var codigo = String(pt.codigo || '').trim();
          var isExtremo = !!_extremos[codigo];
          var paradaMin = pt.parada_s > 0 ? Math.round((pt.parada_s / 60) * 10) / 10 : 0;
          var nome = String(pt.ponto || '').toUpperCase();
          var isGaragem = /GARAGEM/.test(nome);
          var isFirst = idx === 0;
          var isLast  = idx === pontosRegistro.length - 1;
          // Ponto fora do esquema: tem parada, não é garagem e não consta no esquema
          var isForaEsquema = !isGaragem && paradaMin > 0 && !(codigo && esquemaIdSet[codigo]);
          var esperadoMin = esqTLMap[codigo] != null ? esqTLMap[codigo]
            : /RODOVI[AÁ]RIA|RODOVIARIA/.test(nome) ? 15
            : isGaragem ? 20
            : TEMPO_ESPERADO_PADRAO;
          var excessoMin = (isExtremo || isGaragem) ? 0 : Math.max(0, Math.round((paradaMin - esperadoMin) * 10) / 10);
          var showInicioTag = isFirst && !isGaragem;
          var showFimTag    = isLast  && !isGaragem && _showFim;
          var rowBg = showInicioTag  ? 'background:#f0fff8;'
                    : showFimTag    ? 'background:#fff8f0;'
                    : isForaEsquema ? 'background:#fff3f3;'
                    : excessoMin > 0 ? 'background:#fff8f8;'
                    : (!pt.matched && paradaMin > 0) ? 'background:#fffbf0;'
                    : '';
          var nomeCel = pt.ponto || '—';
          if (showInicioTag || showFimTag) {
            nomeCel = '<strong>' + nomeCel + '</strong>' +
              (showInicioTag
                ? ' <span style="font-size:9px;background:#22a96a;color:#fff;border-radius:3px;padding:1px 5px;margin-left:3px;">Início</span>'
                : ' <span style="font-size:9px;background:#e8820a;color:#fff;border-radius:3px;padding:1px 5px;margin-left:3px;">Fim</span>');
          } else if (!pt.matched && !isGaragem) {
            nomeCel = '<em style="color:#888;">' + nomeCel + '</em>';
          }
          // Último ponto de relatório por motorista: sem tempo no local nem saída
          var ocultarTempoSaida = _isMotorista && isLast;
          var paradaHtml = ocultarTempoSaida || isGaragem || paradaMin <= 0
            ? '<span style="color:#bbb;">—</span>'
            : isForaEsquema
              ? '<span style="color:#c0392b;font-weight:700;">' + _fmtMin(paradaMin) + ' <span style="font-size:9px;background:#c0392b;color:#fff;border-radius:3px;padding:1px 4px;">Fora</span></span>'
              : excessoMin > 0
                ? '<span style="color:#d94040;font-weight:700;">' + _fmtMin(paradaMin) + ' <span style="font-size:9px;">(+' + _fmtMin(excessoMin) + ' exc.)</span></span>'
                : '<span>' + _fmtMin(paradaMin) + '</span>';
          var chegada = _extractTime(pt.entrada) || '—';
          var saida   = ocultarTempoSaida ? '—' : (_extractTime(pt.saida || pt.entrada) || '—');
          h += '<tr style="' + rowBg + '">' +
               '<td style="' + TDR + 'text-align:center;color:#888;">' + (pt.seq || (idx + 1)) + '</td>' +
               '<td style="' + TDR + '">' + nomeCel + '</td>' +
               '<td style="' + TDR + 'text-align:center;font-family:monospace;">' + chegada + '</td>' +
               '<td style="' + TDR + 'text-align:center;">' + paradaHtml + '</td>' +
               '<td style="' + TDR + 'text-align:center;font-family:monospace;">' + saida + '</td>' +
               '</tr>';
        });
        h += '</tbody></table></div>';
      }
    }

    // Paradas com excesso
    if (excessos.length > 0) {
      h +=
        '<h4 style="font-size:13px;margin:0 0 8px;color:#d94040;">Paradas com Excesso de Tempo (' +
        excessos.length +
        ")</h4>";
      h +=
        '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px;">';
      h +=
        '<thead><tr style="background:#f5f5f5;"><th style="padding:6px 8px;text-align:left;">Ponto</th>' +
        '<th style="padding:6px 8px;text-align:right;">Parada</th>' +
        '<th style="padding:6px 8px;text-align:right;">Esperado</th>' +
        '<th style="padding:6px 8px;text-align:right;color:#d94040;">Excesso</th>' +
        '<th style="padding:6px 8px;">Entrada</th><th style="padding:6px 8px;">Saída</th></tr></thead>';
      h += "<tbody>";
      excessos.forEach(function (e) {
        h +=
          '<tr style="border-bottom:1px solid #eee;">' +
          '<td style="padding:5px 8px;">' +
          (e.ponto || "—") +
          "</td>" +
          '<td style="padding:5px 8px;text-align:right;">' +
          _fmtMin(e.parada_min) +
          "</td>" +
          '<td style="padding:5px 8px;text-align:right;">' +
          (e.esperado_min !== null ? _fmtMin(e.esperado_min) : '—') +
          "</td>" +
          '<td style="padding:5px 8px;text-align:right;color:#d94040;font-weight:700;">+' +
          _fmtMin(e.excesso_min) +
          "</td>" +
          '<td style="padding:5px 8px;font-family:monospace;font-size:10px;">' +
          _formatDateTimeBr(e.entrada) +
          "</td>" +
          '<td style="padding:5px 8px;font-family:monospace;font-size:10px;">' +
          _formatDateTimeBr(e.saida) +
          "</td>" +
          "</tr>";
      });
      h += "</tbody></table>";
    }

    // Paradas fora do esquema
    if (paradasFora.length > 0) {
      h +=
        '<h4 style="font-size:13px;margin:0 0 8px;color:#d00000;">Paradas Fora do Esquema (' +
        paradasFora.length + ')</h4>';
      h +=
        '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px;">';
      h +=
        '<thead><tr style="background:#f5f5f5;">' +
        '<th style="padding:6px 8px;text-align:left;">Ponto</th>' +
        '<th style="padding:6px 8px;text-align:right;">Parada</th>' +
        '<th style="padding:6px 8px;">Entrada</th>' +
        '<th style="padding:6px 8px;">Saída</th>' +
        '<th style="padding:6px 8px;text-align:center;">Status</th>' +
        '</tr></thead><tbody>';
      paradasFora.forEach(function(p) {
        var statusHtml = p.proibido
          ? '<span style="color:#d00000;font-weight:700;">⛔ Irregular</span>'
          : '<span style="color:#e8a020;font-weight:600;">Não previsto</span>';
        var rowBg = p.proibido ? 'background:#fff3f3;' : 'background:#fffbf0;';
        h +=
          '<tr style="border-bottom:1px solid #eee;' + rowBg + '">' +
          '<td style="padding:5px 8px;font-style:italic;">' + (p.ponto || '—') + '</td>' +
          '<td style="padding:5px 8px;text-align:right;color:#d94040;font-weight:600;">' + _fmtMin(p.parada_min) + '</td>' +
          '<td style="padding:5px 8px;font-family:monospace;font-size:10px;">' + _formatDateTimeBr(p.entrada) + '</td>' +
          '<td style="padding:5px 8px;font-family:monospace;font-size:10px;">' + _formatDateTimeBr(p.saida) + '</td>' +
          '<td style="padding:5px 8px;text-align:center;">' + statusHtml + '</td>' +
          '</tr>';
      });
      h += '</tbody></table>';
    }

    // Pontos não visitados
    if (naoVisit.length > 0) {
      h +=
        '<h4 style="font-size:13px;margin:0 0 8px;color:#e8a020;">Pontos Não Visitados (' +
        naoVisit.length +
        ")</h4>";
      h += '<ul style="font-size:11px;margin:0 0 16px;padding-left:20px;">';
      naoVisit.forEach(function (p) {
        h +=
          '<li style="margin-bottom:3px;">' +
          (p.nome_ponto || p.id_ponto) +
          "</li>";
      });
      h += "</ul>";
    }

    // Eventos de velocidade
    if (eventos.length > 0) {
      h +=
        '<h4 style="font-size:13px;margin:0 0 8px;color:#555;">Eventos de Velocidade (' +
        eventos.length +
        ")</h4>";
      h += '<ul style="font-size:11px;margin:0 0 16px;padding-left:20px;">';
      eventos.forEach(function (ev) {
        var cor = ev.nivel === "critico" ? "#d94040" : "#8a6500";
        h +=
          '<li style="margin-bottom:3px;color:' +
          cor +
          '">' +
          (ev.descricao || ev.tipo) +
          ' · <em style="color:#888;">' +
          (ev.trecho || "") +
          "</em></li>";
      });
      h += "</ul>";
    }

    // Tabela completa de paradas (se não há excesso mas há paradas)
    if (excessos.length === 0 && paradas.length > 0) {
      h +=
        '<h4 style="font-size:13px;margin:0 0 8px;color:#333;">Paradas Registradas (' +
        paradas.length +
        ")</h4>";
      h +=
        '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px;">';
      h +=
        '<thead><tr style="background:#f5f5f5;"><th style="padding:6px 8px;text-align:left;">Ponto</th>' +
        '<th style="padding:6px 8px;text-align:right;">Duração</th>' +
        '<th style="padding:6px 8px;text-align:right;">Esperado</th></tr></thead>';
      h += "<tbody>";
      paradas.forEach(function (p) {
        h +=
          '<tr style="border-bottom:1px solid #eee;">' +
          '<td style="padding:5px 8px;">' +
          (p.ponto || "—") +
          "</td>" +
          '<td style="padding:5px 8px;text-align:right;">' +
          _fmtMin(p.parada_min) +
          "</td>" +
          '<td style="padding:5px 8px;text-align:right;">' +
          (p.sem_limite ? '—' : (p.esperado_min !== null ? _fmtMin(p.esperado_min) : '—')) +
          "</td>" +
          "</tr>";
      });
      h += "</tbody></table>";
    }

    // Sem ocorrências
    if (
      excessos.length === 0 &&
      paradasFora.length === 0 &&
      naoVisit.length === 0 &&
      eventos.length === 0
    ) {
      h +=
        '<p style="color:#22a96a;font-size:12px;font-weight:600;">✓ Viagem sem ocorrências operacionais registradas.</p>';
    }

    // Esquema da viagem (referência da rota planejada)
    var esquemaOrdenado = esquemaPontos.slice().sort(function(a, b) {
      return (a.ordem || 0) - (b.ordem || 0);
    });
    if (esquemaOrdenado.length > 0) {
      var temComercial = esquemaOrdenado.some(function(ep) { return ep.horario_comercial; });
      var temParada    = esquemaOrdenado.some(function(ep) { return ep.tempo_local; });
      var TH = 'background:#f0f2f8;padding:6px 10px;font-size:9px;font-weight:700;text-transform:uppercase;' +
               'letter-spacing:.05em;color:#5a6070;border:1px solid #cdd2e5;white-space:nowrap;';
      var TD = 'padding:7px 10px;border:1px solid #dde1ee;vertical-align:middle;';
      h +=
        '<div style="margin-top:28px;border-top:2px solid #f47920;padding-top:16px;">' +
        '<h4 style="font-size:13px;margin:0 0 10px;color:#1a1d23;font-weight:800;letter-spacing:0.02em;">' +
        'Esquema da Viagem — ' + linhaStr +
        (horarioEsquema ? ' &nbsp;·&nbsp; <span style="color:#f47920;">' + horarioEsquema + '</span>' : '') +
        '</h4>' +
        '<table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid #cdd2e5;">';
      h +=
        '<thead><tr>' +
        '<th style="' + TH + 'text-align:center;width:36px;">#</th>' +
        '<th style="' + TH + 'text-align:left;">Cidade</th>' +
        (temComercial ? '<th style="' + TH + 'text-align:center;">Horário</th>' : '') +
        (temParada    ? '<th style="' + TH + 'text-align:center;">Parada</th>'  : '') +
        '</tr></thead><tbody>';
      esquemaOrdenado.forEach(function(ep, idx) {
        var isFirst = idx === 0;
        var isLast  = idx === esquemaOrdenado.length - 1;
        var rowBg   = isFirst ? 'background:#f0fff8;'
                    : isLast  ? 'background:#fff8f0;'
                    : (!ep.horario_comercial && temComercial) ? 'background:#fff8f2;' : '';
        var nomeCel = '<strong>' + (ep.nome_ponto || ep.id_ponto || '—') + '</strong>' +
                      (isFirst
                        ? ' <span style="font-size:9px;background:#f47920;color:#fff;' +
                          'border-radius:3px;padding:1px 5px;margin-left:3px;">✈</span>'
                        : '');
        var horCel = ep.horario_comercial
          ? '<strong style="color:#1565c0;">' + ep.horario_comercial + '</strong>'
          : '<span style="color:#ccc;">—</span>';
        var paradaCel = (isFirst || isLast) ? '—'
                      : (ep.tempo_local ? ep.tempo_local : '00:05');
        h +=
          '<tr style="' + rowBg + '">' +
          '<td style="' + TD + 'text-align:center;color:#888;">' + (ep.ordem || idx + 1) + '</td>' +
          '<td style="' + TD + '">' + nomeCel + '</td>' +
          (temComercial ? '<td style="' + TD + 'text-align:center;font-family:monospace;">' + horCel    + '</td>' : '') +
          (temParada    ? '<td style="' + TD + 'text-align:center;">'                       + paradaCel + '</td>' : '') +
          '</tr>';
      });
      h += '</tbody></table></div>';
    }

    return h;
  }

  /**
   * Formata timestamp ISO "YYYY-MM-DD HH:MM:SS" para "DD/MM/AAAA HH:mm".
   * Se não houver hora, retorna apenas "DD/MM/AAAA".
   */
  function _formatDateTimeBr(ts) {
    if (!ts) return "—";
    var m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
    if (!m) return String(ts);
    var date = m[3] + "/" + m[2] + "/" + m[1];
    return m[4] ? date + " " + m[4] + ":" + m[5] : date;
  }

  /**
   * Computa km total, hora de início/fim e data a partir de um sub-array de enrichedTrip.
   */
  function _computeTrechoStats(trip) {
    if (!trip || trip.length === 0) return {};
    var first = trip[0];
    var last  = trip[trip.length - 1];
    var totalKm = 0;
    for (var i = 0; i < trip.length - 1; i++) {
      var a = trip[i], b = trip[i + 1];
      if (a.lat && a.lng && b.lat && b.lng) {
        var R = 6371;
        var dLat = (b.lat - a.lat) * Math.PI / 180;
        var dLon = (b.lng - a.lng) * Math.PI / 180;
        var s = Math.sin(dLat/2)*Math.sin(dLat/2) +
                Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*
                Math.sin(dLon/2)*Math.sin(dLon/2);
        totalKm += R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
      }
    }
    return {
      totalKm:    Math.round(totalKm * 100) / 100,
      dataInicio: _formatDateTimeBr(first.entrada).split(" ")[0],
      inicio:     _extractTime(first.entrada) || "—",
      fim:        _extractTime(last.saida || last.entrada) || "—"
    };
  }

  /**
   * Converte data no formato DD/MM/YYYY para YYYY-MM-DD.
   */
  function _parseDateBrToIso(dataBr) {
    if (!dataBr) return "";
    var parts = dataBr.split("/");
    if (parts.length !== 3) return "";
    return parts[2] + "-" + parts[1] + "-" + parts[0];
  }

  /**
   * Extrai HH:MM de um timestamp "YYYY-MM-DD HH:MM:SS".
   */
  function _extractTime(ts) {
    if (!ts) return null;
    var m = String(ts).match(/(\d{2}:\d{2})/);
    return m ? m[1] : null;
  }

  /**
   * Retorna data de hoje em formato YYYY-MM-DD.
   */
  function _todayIso() {
    return Utilities.formatDate(new Date(), "America/Sao_Paulo", "yyyy-MM-dd");
  }

  /**
   * Retorna data/hora atual em formato ISO.
   */
  function _nowIso() {
    return new Date().toISOString();
  }

  /**
   * Cria ocorrências DESCUMP_OP_PARADA_FORA para cada parada fora do esquema
   * detectada na viagem. Faz um único lookup de motorista e viagem (cacheado)
   * e POSTa uma ocorrência por parada irregular.
   *
   * @param {Object} params
   * @param {Array}  params.enrichedTrip
   * @param {Array}  params.esquemaPontos
   * @param {Object} params.motorista     — { matricula, nome, base }
   * @param {string} params.nomeLinha
   * @param {string} params.horario       — HH:MM (horário de partida)
   * @param {Object} params.summary       — { dataViagem: "DD/MM/YYYY", veiculo }
   * @returns {Array}  [{ ponto, status, id?, httpCode?, message? }]
   */
  function enviarParadasFora(params) {
    var props   = PropertiesService.getScriptProperties();
    var baseUrl = (props.getProperty("REPORT_API_URL") || "").replace(/\/$/, "");
    if (!baseUrl) throw new Error("REPORT_API_URL não configurada.");

    var enrichedTrip  = params.enrichedTrip  || [];
    var esquemaPontos = params.esquemaPontos  || [];
    var motorista     = params.motorista      || {};
    var nomeLinha     = params.nomeLinha      || "";
    var horario       = params.horario        || "";
    var summary       = params.summary        || {};

    // ── Detecta paradas fora do esquema ──────────────────────────
    var esquemaIdSet = {};
    esquemaPontos.forEach(function(ep) {
      if (ep.id_ponto) esquemaIdSet[String(ep.id_ponto).trim()] = true;
    });

    var lastIdx     = enrichedTrip.length - 1;
    var paradasFora = [];
    enrichedTrip.forEach(function(pt, idx) {
      if (idx === 0 || idx === lastIdx) return;
      if (!pt.parada_s || pt.parada_s <= 0) return;
      if (pt.codigo && esquemaIdSet[String(pt.codigo).trim()]) return;
      if (!pt.proibido42) return;
      paradasFora.push({ ponto: pt.ponto, codigo: pt.codigo || null, entrada: pt.entrada, saida: pt.saida });
    });

    if (paradasFora.length === 0) return [];

    // ── Upsert do motorista e lookup da viagem ───────────────────
    var driverId = null;
    var tripId   = null;
    var matchedLineName = nomeLinha;
    var matchedTripTime = horario;

    if (motorista.matricula || motorista.nome) {
      try {
        var mat  = motorista.matricula || '';
        var nome = motorista.nome      || '';
        var base = motorista.base      || null;
        var dr = UrlFetchApp.fetch(baseUrl + "/drivers/upsert", {
          method:      "post",
          contentType: "application/json",
          payload:     JSON.stringify({ code: mat || nome, name: nome || mat, base: base }),
          muteHttpExceptions: true,
        });
        if (dr.getResponseCode() === 200) {
          driverId = (JSON.parse(dr.getContentText()) || {}).id || null;
        }
      } catch (e) { /* segue sem driverId */ }
    }

    if (nomeLinha && horario) {
      try {
        var tr = UrlFetchApp.fetch(
          baseUrl + "/trips/lookup?lineName=" + encodeURIComponent(nomeLinha) +
                    "&departureTime=" + encodeURIComponent(horario),
          { method: "get", muteHttpExceptions: true }
        );
        if (tr.getResponseCode() === 200) {
          var tripData = JSON.parse(tr.getContentText()) || {};
          tripId = tripData.id || null;
          // Use the DB's official line name and direction
          if (tripData.lineName) {
            matchedLineName = tripData.lineName + (tripData.direction ? ' — ' + tripData.direction : '');
          }
          if (tripData.departureTime) matchedTripTime = tripData.departureTime;
        }
      } catch (e) { /* segue sem tripId */ }
    }

    // ── Dados comuns a todas as ocorrências ──────────────────────
    var dateStr       = _parseDateBrToIso(summary.dataViagem || "") || _todayIso();
    var vehicleNumber = String(summary.veiculo || "—").trim();
    var esquemaHtml   = _buildEsquemaHtml(esquemaPontos, matchedLineName, matchedTripTime);
    var hasMot        = !!(motorista.nome || motorista.matricula);

    var results = [];

    // ── Uma ocorrência por parada ─────────────────────────────────
    paradasFora.forEach(function(pf) {
      var startTime = _extractTime(pf.entrada) || "00:00";
      var endTime   = _extractTime(pf.saida)   || startTime;

      var occPayload = {
        typeCode:      "DESCUMP_OP_PARADA_FORA",
        eventDate:     dateStr,
        tripDate:      dateStr,
        startTime:     startTime,
        endTime:       endTime,
        vehicleNumber: vehicleNumber,
        lineLabel:     matchedLineName || null,
        tripId:        tripId         || undefined,
        tripTime:      matchedTripTime || null,
        place:         pf.ponto   || "—",
        placeCode:     pf.codigo  || undefined,
        relatoHtml:    esquemaHtml,
        showSectionTripulacao:     hasMot,
        showSectionViagem:         true,
        showSectionIdentificacao:  true,
        showSectionDados:          true,
        showSectionPassageiros:    false,
        devolutivaBeforeEvidences: false,
        drivers: hasMot ? [{
          position: 1,
          driverId:  driverId            || undefined,
          registry:  motorista.matricula || undefined,
          name:      motorista.nome      || undefined,
          baseCode:  motorista.base      || undefined,
        }] : [],
      };

      try {
        var resp = UrlFetchApp.fetch(baseUrl + "/occurrences", {
          method:      "post",
          contentType: "application/json",
          payload:     JSON.stringify(occPayload),
          muteHttpExceptions: true,
        });
        var code = resp.getResponseCode();
        var body;
        try { body = JSON.parse(resp.getContentText()); } catch (e) { body = {}; }

        if (code >= 200 && code < 300) {
          var occId = body.id || null;
          results.push({ ponto: pf.ponto, status: "ok", id: occId });
        } else {
          results.push({ ponto: pf.ponto, status: "error", httpCode: code, message: body.message || resp.getContentText() });
        }
      } catch (e) {
        results.push({ ponto: pf.ponto, status: "error", message: String(e) });
      }
    });

    return results;
  }

  return {
    gerarRelatorioMotorista: gerarRelatorioMotorista,
    gerarRelatorioTrecho: gerarRelatorioTrecho,
    gerarRelatorioCompleto: gerarRelatorioCompleto,
    enviarParaAPI: enviarParaAPI,
    enviarParadasFora: enviarParadasFora,
    buildEsquemaHtml: _buildEsquemaHtml,
  };
})();
