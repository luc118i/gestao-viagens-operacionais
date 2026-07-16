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
    var eventos = _extrairEventos(segments, trechoTrip, params.justificativas);

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
    var eventos = _extrairEventos(segments, trechoTrip, params.justificativas);

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
      // Motoristas responsáveis pelo trecho (calculados no cliente a partir dos vínculos)
      motoristasTrecho: params.motoristasTrecho || [],
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

    // Resolve a linha oficial na API por código+horário+sentido (corrige nome
    // da linha). Fallback: mantém params.nomeLinha se a API não encontrar.
    params = params || {};
    var _trip = _resolveTrip(baseUrl, {
      codLinha:  params.codLinha  || '',
      nomeLinha: params.nomeLinha || '',
      horario:   params.horario   || '',
      sentido:   params.sentido   || '',
    });
    params._resolvedLineLabel = _trip.lineLabel;
    params._resolvedTripId    = _trip.tripId;
    params._resolvedTripTime  = _trip.tripTime;

    // ── Passo 1: monta o payload de ocorrência ──────────────────────
    var occPayload = _buildOccurrencePayload(payload, params);

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

    // ── Passo 1.5: anexa imagens/evidências (não-fatal) ─────────────
    var evidencias = (params && params.evidencias) || [];
    if (evidencias.length > 0) {
      try {
        _uploadEvidencias(baseUrl, occurrenceId, evidencias);
      } catch (e) {
        // Falha no upload não impede a geração do PDF (apenas sai sem imagens)
        Logger.log("Falha ao anexar evidências: " + e);
      }
    }

    // ── Passo 2: gera o arquivo (PDF ou DOCX) ───────────────────────
    var ttl = props.getProperty("REPORTS_PDF_TTL") || "3600";
    // Formato: 'pdf' (padrão) ou 'docx' — define o endpoint da API de relatórios.
    var formato = String((params && params.formato) || "pdf").toLowerCase();
    if (formato !== "docx") formato = "pdf";

    var fileResp = UrlFetchApp.fetch(
      baseUrl +
        "/reports/occurrences/" +
        occurrenceId +
        "/" + formato + "?ttl=" +
        ttl,
      { method: "get", muteHttpExceptions: true },
    );

    var fileCode = fileResp.getResponseCode();
    if (fileCode < 200 || fileCode > 299) {
      // Ocorrência criada mas geração do arquivo falhou — retorna ID sem URL.
      // Inclui um trecho da resposta para diagnóstico (404 = endpoint ausente na
      // API; 500 = erro de geração).
      var apiMsg = "";
      try {
        var errBody = fileResp.getContentText();
        var errJson = JSON.parse(errBody);
        apiMsg = (errJson && errJson.error && errJson.error.message) || "";
        if (!apiMsg && errBody) apiMsg = String(errBody).slice(0, 160);
      } catch (e2) {}
      var dica = fileCode === 404
        ? " (endpoint /" + formato + " indisponível — a API de relatórios precisa ser atualizada)"
        : "";
      return {
        status: createCode,
        body: {
          id: occurrenceId,
          warning: formato.toUpperCase() + " falhou (HTTP " + fileCode + ")" +
                   (apiMsg ? ": " + apiMsg : "") + dica,
        },
      };
    }

    var fileParsed = {};
    try {
      fileParsed = JSON.parse(fileResp.getContentText());
    } catch (e) {}

    // A API retorna a URL sob data.pdf ou data.docx conforme o formato.
    var d = fileParsed.data || {};
    var signed = (d.pdf && d.pdf.signedUrl) || (d.docx && d.docx.signedUrl) ||
                 (d.file && d.file.signedUrl) || null;

    return {
      status: 200,
      body: {
        id: occurrenceId,
        url: signed,
        formato: formato,
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
      if (pt.ignorarManual) return; // ignorado: fora do relatório
      if (!pt.parada_s || pt.parada_s <= 0) return;
      var isApoio = !!pt.apoioManual;
      var tipoKey = String(pt.tipo || '').trim();
      var paradaMin = Math.round((pt.parada_s / 60) * 10) / 10;

      var nome = String(pt.ponto || '').toUpperCase();
      // Ponto de apoio tem teto FIXO de 30min; demais usam o esperado por tipo.
      var esperadoMin = isApoio ? 30
        : (/RODOVI[AÁ]RIA|RODOVIARIA/.test(nome) ? 15
          : /GARAGEM/.test(nome) ? 20
          : TEMPO_ESPERADO_PADRAO); // 40 min para qualquer outro
      var semLimite = false;

      // Excesso = parada − esperado (valor REAL). apoio: registra qualquer
      // excesso acima de 30min; normal: gate de 5min de tolerância.
      var overage = Math.round((paradaMin - esperadoMin) * 10) / 10;
      var excessoMin = (semLimite || esperadoMin === null) ? 0
        : (isApoio ? Math.max(0, overage) : (overage > 5 ? overage : 0));

      // apoio dentro do teto → parada legítima, não entra no relatório
      if (isApoio && excessoMin <= 0) return;

      paradas.push({
        ponto: pt.ponto,
        codigo: pt.codigo || null,
        entrada: pt.entrada,
        saida: pt.saida,
        parada_min: paradaMin,
        esperado_min: esperadoMin,
        excesso_min: excessoMin,
        sem_limite: semLimite,
        tipo: tipoKey,
        isApoio: isApoio,
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
   * Cada evento é anotado com `justificado` (auto-justificado por contexto
   * urbano OU justificativa manual salva) para que o relatório filtre os
   * falsos positivos e leve os justificados para a seção de auditoria.
   * @param {Object} [justificativas]  mapa { alertKey: {status, categoria, motivo} }
   */
  function _extrairEventos(segments, trechoTrip, justificativas) {
    if (!segments || !segments.length) return [];
    justificativas = justificativas || {};

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
        var manual = a.alertKey ? justificativas[a.alertKey] : null;
        var reaberto = manual && manual.status === "reaberto";
        var justificado = false, justCategoria = "", justMotivo = "";
        if (manual && !reaberto) {
          justificado = true; justCategoria = manual.categoria || ""; justMotivo = manual.motivo || "";
        } else if (a.autoJustificado && !reaberto) {
          justificado = true;
          justCategoria = (a.justificativa && a.justificativa.categoria) || a.contextoLabel || "";
          justMotivo = (a.justificativa && a.justificativa.motivo) || "";
        }
        eventos.push({
          tipo: a.tipo,
          nivel: a.nivel,
          severidade: a.severidade || a.nivel,
          descricao: a.descricao,
          trecho: seg.de + " → " + seg.para,
          justificado: justificado,
          justCategoria: justCategoria,
          justMotivo: justMotivo,
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
    var eventos = _extrairEventos(segments, enrichedTrip, params.justificativas);

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
   * Faz upload de imagens (base64) para POST /occurrences/:id/evidences.
   * Monta o corpo multipart/form-data manualmente (UrlFetchApp não suporta
   * múltiplos campos com o mesmo nome "files" via objeto payload).
   *
   * @param {string} baseUrl
   * @param {string} occurrenceId
   * @param {Array}  evidencias  — [{ nome, mime, base64, legenda }]
   * @returns {number} HTTP status
   */
  function _uploadEvidencias(baseUrl, occurrenceId, evidencias) {
    var boundary = "----GASBoundary" + Date.now();
    var parts = []; // array de Byte[]
    function pushStr(s) { parts.push(Utilities.newBlob(s).getBytes()); }

    var validas = evidencias.filter(function (ev) { return ev && ev.base64; });
    if (validas.length === 0) return 0;

    validas.forEach(function (ev) {
      var nome = ev.nome || "evidencia.jpg";
      var mime = ev.mime || "image/jpeg";
      pushStr(
        "--" + boundary + "\r\n" +
        'Content-Disposition: form-data; name="files"; filename="' + nome + '"\r\n' +
        "Content-Type: " + mime + "\r\n\r\n"
      );
      parts.push(Utilities.base64Decode(ev.base64));
      pushStr("\r\n");
    });

    // Campo metadata: legenda por imagem, na mesma ordem dos arquivos
    var metadata = validas.map(function (ev) {
      return { caption: ev.legenda || null };
    });
    pushStr(
      "--" + boundary + "\r\n" +
      'Content-Disposition: form-data; name="metadata"\r\n\r\n' +
      JSON.stringify(metadata) + "\r\n"
    );
    pushStr("--" + boundary + "--\r\n");

    // Concatena todos os Byte[] em um único corpo
    var body = [];
    parts.forEach(function (p) { body = body.concat(p); });

    var resp = UrlFetchApp.fetch(baseUrl + "/occurrences/" + occurrenceId + "/evidences", {
      method: "post",
      contentType: "multipart/form-data; boundary=" + boundary,
      payload: body,
      muteHttpExceptions: true,
    });
    return resp.getResponseCode();
  }

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

    // Diagnóstico Inteligente (Análise Inteligente da Viagem) — anexado ao PDF
    // quando disponível em params (gerado/recuperado do cache no gerarRelatorio).
    if (params.diagnostico) {
      relatoHtml += _buildDiagnosticoHtml(params.diagnostico);
    }

    // Título do relatório
    var titulo = _buildReportTitle(payload, params);

    return {
      typeCode: typeCode,
      // Analista responsável pela apuração — ocorrências geradas por este
      // sistema vão para "LUCAS" (configurável via Script Property).
      analisadoPor: props.getProperty("REPORT_ANALISADO_POR") || "LUCAS",
      eventDate: tripDate || today,
      tripDate: tripDate || today,
      startTime: startTime || "00:00",
      endTime: endTime || "23:59",
      vehicleNumber: String(
        summary.veiculo || firstPt.veiculo || "" || "—",
      ).trim(),
      lineLabel: params._resolvedLineLabel || params.nomeLinha || "",
      tripId: params._resolvedTripId || undefined,
      tripTime: params._resolvedTripTime || params.horario || startTime || null,
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
        // Relatório por motorista: um único condutor no cabeçalho.
        var m = payload.motorista || {};
        if (m.nome || m.matricula) {
          return [{ position: 1, name: m.nome || '', registry: m.matricula || '', baseCode: m.base || '' }];
        }
        // Relatório por trecho: os responsáveis (com sub-trecho) são renderizados
        // no bloco "Responsáveis pelo Trecho" dentro do relato — não duplicar aqui.
        return [];
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
          if (pt.apoioManual || pt.ignorarManual) return; // ajuste manual: não gera ocorrência
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

    var TH = 'background:#f0f2f8;padding:6px 8px;font-size:9px;font-weight:700;text-transform:uppercase;' +
             'letter-spacing:.05em;color:#5a6070;border:1px solid #cdd2e5;white-space:nowrap;';
    var TD = 'padding:6px 8px;border:1px solid #dde1ee;vertical-align:middle;';

    var temComercial = esquemaOrdenado.some(function(ep) { return ep.horario_comercial; });

    var h = '<div style="border-top:2px solid #f47920;padding-top:16px;">' +
            '<h4 style="font-size:13px;margin:0 0 10px;color:#1a1d23;font-weight:800;letter-spacing:0.02em;">' +
            'Esquema da Viagem — ' + (nomeLinha || '—') +
            (horarioEsquema ? ' &nbsp;·&nbsp; <span style="color:#f47920;">' + horarioEsquema + '</span>' : '') +
            '</h4>' +
            '<table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid #cdd2e5;">' +
            '<thead><tr>' +
            '<th style="' + TH + 'text-align:center;width:30px;">#</th>' +
            '<th style="' + TH + 'text-align:left;">Local</th>' +
            (temComercial ? '<th style="' + TH + 'text-align:center;">Hor. Comercial</th>' : '') +
            '</tr></thead><tbody>';

    esquemaOrdenado.forEach(function(ep, idx) {
      var isFirst = idx === 0;
      var isLast  = idx === esquemaOrdenado.length - 1;
      var rowBg   = isFirst ? 'background:#f0fff8;'
                  : isLast  ? 'background:#fff8f0;'
                  : '';

      var nomeCel = '<strong>' + (ep.nome_ponto || ep.id_ponto || '—') + '</strong>';
      var horCel  = ep.horario_comercial
        ? '<strong style="color:#1565c0;font-family:monospace;">' + ep.horario_comercial + '</strong>'
        : '<span style="color:#ccc;">—</span>';

      h += '<tr style="' + rowBg + '">' +
           '<td style="' + TD + 'text-align:center;color:#888;">' + (ep.ordem || idx + 1) + '</td>' +
           '<td style="' + TD + '">' + nomeCel + '</td>' +
           (temComercial ? '<td style="' + TD + 'text-align:center;">' + horCel + '</td>' : '') +
           '</tr>';
    });

    h += '</tbody></table></div>';
    return h;
  }

  // ============================================================
  //  DIAGNÓSTICO INTELIGENTE (PDF) — HTML com estilos inline
  //  Renderiza o objeto gerado por DiagnosticoService para o relatório PDF.
  // ============================================================

  /**
   * Monta o bloco "Diagnóstico Inteligente" para o PDF.
   * @param {Object} d  — diagnóstico (DiagnosticoService.gerarDiagnostico)
   * @returns {string} HTML com estilos inline
   */
  function _buildDiagnosticoHtml(d) {
    if (!d) return '';
    var n = d.narrativa || {};
    var c = d.cards || {};
    var ind = d.indicadores || {};
    var meta = d.meta || {};

    var esc = function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };
    var nl = function (s) { return esc(s).replace(/\n/g, '<br>'); };
    var fmtMin = function (min) {
      var t = Math.round(Number(min) || 0);
      if (t < 60) return t + ' min';
      return Math.floor(t / 60) + 'h' + (t % 60 > 0 ? ('0' + (t % 60)).slice(-2) : '');
    };
    var fmtDelta = function (min) {
      if (min == null) return '—';
      var a = Math.abs(Math.round(min));
      if (a === 0) return 'no horário';
      var s = min > 0 ? '+' : '−';
      if (a < 60) return s + a + ' min';
      return s + Math.floor(a / 60) + 'h' + (a % 60 > 0 ? ('0' + (a % 60)).slice(-2) : '');
    };
    var toneColor = function (t) { return t === 'perdeu' ? '#d94040' : (t === 'recuperou' ? '#22a96a' : '#5a6070'); };
    var critColor = function (nivel) {
      var k = String(nivel || '').toLowerCase();
      return k === 'critica' ? '#d94040' : k === 'alta' ? '#e8a020' : k === 'media' ? '#3b82f6' : '#8a919e';
    };
    var critLabel = function (nivel) {
      var k = String(nivel || '').toLowerCase();
      return { critica: 'Crítica', alta: 'Alta', media: 'Média', baixa: 'Baixa' }[k] || 'Baixa';
    };
    var impLabel = function (imp) {
      var k = String(imp || 'medio').toLowerCase();
      return { alto: 'Impacto alto', medio: 'Impacto médio', baixo: 'Impacto baixo' }[k] || 'Impacto médio';
    };

    var TH = 'background:#f0f2f8;padding:6px 8px;font-size:9px;font-weight:700;text-transform:uppercase;' +
             'letter-spacing:.05em;color:#5a6070;border:1px solid #cdd2e5;white-space:nowrap;';
    var TD = 'padding:6px 8px;border:1px solid #dde1ee;vertical-align:middle;font-size:11px;color:#1a1d23;';

    // Cabeçalho da seção (nova página no PDF)
    var h = '<div style="page-break-before:always;border-top:2px solid #f47920;padding-top:16px;margin-top:20px;">';
    h += '<h4 style="font-size:14px;margin:0 0 2px;color:#1a1d23;font-weight:800;letter-spacing:0.02em;">' +
         'Diagnóstico Inteligente ' +
         '<span style="font-size:9px;font-weight:700;color:#f47920;border:1px solid #f4792055;border-radius:10px;padding:1px 7px;vertical-align:middle;">IA</span>' +
         '</h4>';
    h += '<div style="font-size:10px;color:#9aa0ad;margin-bottom:' + (meta.escopo ? '6px' : '14px') + ';">' +
         esc(meta.nomeLinha || '—') + ' &nbsp;·&nbsp; Veículo ' + esc(meta.veiculo || '—') +
         ' &nbsp;·&nbsp; ' + esc(meta.dataViagem || '—') + '</div>';
    if (meta.escopo) {
      h += '<div style="display:inline-block;font-size:9px;font-weight:700;color:#f47920;' +
           'background:rgba(244,121,32,0.1);border:1px solid rgba(244,121,32,0.25);' +
           'border-radius:12px;padding:2px 9px;margin-bottom:14px;">' + esc(meta.escopo) + '</div>';
    }

    // Título de sub-bloco reutilizável
    var subTitle = function (t) {
      return '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;' +
             'color:#5a6070;margin:16px 0 8px;padding-bottom:5px;border-bottom:1px solid #e2e5ea;">' + esc(t) + '</div>';
    };

    // 1. Resumo Executivo
    if (n.resumoExecutivo) {
      h += subTitle('Resumo Executivo');
      h += '<p style="font-size:12.5px;line-height:1.55;color:#1a1d23;margin:0;font-weight:500;">' +
           nl(n.resumoExecutivo) + '</p>';
    }

    // 2. Indicadores (cards em tabela 5×2)
    h += subTitle('Indicadores');
    var cards = [
      ['Onde mais se perdeu tempo', c.maiorResponsavelAtraso ? fmtDelta(c.maiorResponsavelAtraso.valorMin) : '—', c.maiorResponsavelAtraso ? c.maiorResponsavelAtraso.local : 'Sem atraso relevante', '#d94040', c.pontosComAtraso],
      ['Maior parada (excesso)', c.maiorParada ? fmtDelta(c.maiorParada.valorMin) : '—', c.maiorParada ? c.maiorParada.local : 'Dentro do previsto', '#d94040'],
      ['Maior recuperação', c.maiorRecuperacao ? ('−' + Math.round(c.maiorRecuperacao.valorMin) + ' min') : '—', c.maiorRecuperacao ? c.maiorRecuperacao.local : 'Sem recuperação', '#22a96a'],
      ['Trecho mais lento', c.trechoMaisLento ? (c.trechoMaisLento.vel + ' km/h') : '—', c.trechoMaisLento ? c.trechoMaisLento.trecho : '—', '#3b82f6'],
      ['Velocidade média', (c.velocidadeMedia || 0) + ' km/h', 'Média da viagem', '#3b82f6'],
      ['Tempo perdido', fmtMin(c.tempoPerdidoMin || 0), 'Acumulado na rota', '#d94040'],
      ['Tempo recuperado', fmtMin(c.tempoRecuperadoMin || 0), 'Acumulado na rota', '#22a96a'],
      ['Eventos críticos', String(c.eventosCriticos || 0), 'Nível crítico', '#3b82f6'],
      ['Paradas fora do esquema', String(c.paradasForaEsquema || 0), 'Não previstas', '#3b82f6'],
      ['Pontos ignorados', String(c.pontosIgnorados || 0), 'Não visitados', '#3b82f6']
    ];
    // Tom de fundo claro derivado da cor de acento — sobrevive no Word (cell shading).
    // Substitui o antigo border-left colorido + border-spacing, que o Word ignora.
    var tintFor = function (col) {
      return ({
        '#d94040': { bg: '#fdf2f2', bd: '#f0c9c9' },   // vermelho
        '#22a96a': { bg: '#eefaf4', bd: '#bfe8d4' },   // verde
        '#3b82f6': { bg: '#eef4ff', bd: '#cbddfb' }    // azul
      })[col] || { bg: '#f7f8fb', bd: '#e2e5ea' };
    };
    h += '<table style="width:100%;border-collapse:collapse;">';
    for (var r = 0; r < cards.length; r += 5) {
      h += '<tr>';
      for (var i = r; i < r + 5 && i < cards.length; i++) {
        var cd = cards[i];
        var tn = tintFor(cd[3]);
        h += '<td style="width:20%;background:' + tn.bg + ';border:1px solid ' + tn.bd + ';' +
             'padding:7px 9px;vertical-align:top;">' +
             '<div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:#8a8f99;line-height:1.2;">' + esc(cd[0]) + '</div>' +
             '<div style="font-size:15px;font-weight:800;color:' + cd[3] + ';margin:2px 0 1px;">' + esc(cd[1]) + '</div>' +
             '<div style="font-size:8.5px;color:#9aa0ad;line-height:1.2;">' + esc(cd[2]) + '</div>' +
             (cd[4] ? '<div style="font-size:8px;font-weight:700;color:' + cd[3] + ';margin-top:3px;">' + cd[4] + ' ponto' + (cd[4] === 1 ? '' : 's') + ' com atraso</div>' : '') +
             '</td>';
      }
      // Completa a última linha para não deixar células faltando (bordas irregulares no Word).
      for (var k = (cards.length - r); k < 5 && r + 5 > cards.length; k++)
        h += '<td style="width:20%;border:1px solid #eceef3;"></td>';
      h += '</tr>';
    }
    h += '</table>';

    // 3. Diagnóstico Geral
    if (n.diagnosticoGeral) {
      h += subTitle('Diagnóstico Geral');
      h += '<p style="font-size:11.5px;line-height:1.6;color:#5a6070;margin:0;">' + nl(n.diagnosticoGeral) + '</p>';
    }

    // 4. Linha do Tempo do Atraso
    if (d.timeline && d.timeline.length) {
      h += subTitle('Linha do Tempo do Atraso');
      h += '<table style="width:100%;border-collapse:collapse;border:1px solid #cdd2e5;">' +
           '<thead><tr>' +
           '<th style="' + TH + 'text-align:left;">Local</th>' +
           '<th style="' + TH + 'text-align:center;">Real</th>' +
           '<th style="' + TH + 'text-align:center;">Programado</th>' +
           '<th style="' + TH + 'text-align:center;">Variação</th>' +
           '<th style="' + TH + 'text-align:left;">Tendência</th>' +
           '</tr></thead><tbody>';
      d.timeline.forEach(function (t) {
        var col = toneColor(t.tendencia);
        var tend = t.tendencia === 'perdeu' ? 'Perdeu tempo' : (t.tendencia === 'recuperou' ? 'Recuperou tempo' : 'Sem alteração');
        h += '<tr>' +
             '<td style="' + TD + '"><strong>' + esc(t.local) + '</strong></td>' +
             '<td style="' + TD + 'text-align:center;font-family:monospace;">' + esc(t.horarioReal) + '</td>' +
             '<td style="' + TD + 'text-align:center;font-family:monospace;color:#1565c0;">' + esc(t.horarioComercial) + '</td>' +
             '<td style="' + TD + 'text-align:center;color:' + col + ';font-weight:700;">' + esc(fmtDelta(t.atrasoAcumMin)) + '</td>' +
             '<td style="' + TD + 'color:' + col + ';">' + tend + '</td>' +
             '</tr>';
      });
      h += '</tbody></table>';
    }

    // 5. Principais Causas
    if (n.causasPrincipais && n.causasPrincipais.length) {
      h += subTitle('Principais Causas');
      n.causasPrincipais.forEach(function (ca) {
        var col = critColor(String(ca.impacto).toLowerCase() === 'alto' ? 'critica' : (String(ca.impacto).toLowerCase() === 'baixo' ? 'baixa' : 'media'));
        // Título à esquerda + selo à direita numa mini-tabela (o Word ignora flex).
        h += '<div style="border:1px solid #e2e5ea;border-radius:6px;padding:9px 11px;margin-bottom:7px;">' +
             '<table style="width:100%;border-collapse:collapse;"><tr>' +
             '<td style="border:0;padding:0;vertical-align:middle;"><strong style="font-size:11.5px;color:#1a1d23;">' + esc(ca.titulo || '') + '</strong></td>' +
             '<td style="border:0;padding:0;text-align:right;vertical-align:middle;white-space:nowrap;">' +
             '<span style="font-size:9px;font-weight:700;color:' + col + ';border:1px solid ' + col + '44;border-radius:10px;padding:1px 7px;">' + esc(impLabel(ca.impacto)) + '</span>' +
             '</td>' +
             '</tr></table>' +
             '<div style="font-size:11px;line-height:1.5;color:#5a6070;margin-top:4px;">' + esc(ca.descricao || '') + '</div>' +
             '</div>';
      });
    }

    // 6. Trechos Críticos
    if (d.trechosCriticos && d.trechosCriticos.length) {
      h += subTitle('Trechos Críticos');
      h += '<table style="width:100%;border-collapse:collapse;border:1px solid #cdd2e5;">' +
           '<thead><tr>' +
           '<th style="' + TH + 'text-align:left;">Trecho</th>' +
           '<th style="' + TH + 'text-align:center;">Vel. média</th>' +
           '<th style="' + TH + 'text-align:center;">Vel. ideal</th>' +
           '<th style="' + TH + 'text-align:center;">T. esperado</th>' +
           '<th style="' + TH + 'text-align:center;">T. realizado</th>' +
           '<th style="' + TH + 'text-align:center;">Impacto</th>' +
           '<th style="' + TH + 'text-align:center;">Criticidade</th>' +
           '</tr></thead><tbody>';
      d.trechosCriticos.forEach(function (tr) {
        var col = critColor(tr.criticidade);
        var impCol = tr.tempoPerdidoMin > 0 ? '#d94040' : (tr.tempoPerdidoMin < 0 ? '#22a96a' : '#5a6070');
        h += '<tr>' +
             '<td style="' + TD + '">' + esc(tr.trecho) + '</td>' +
             '<td style="' + TD + 'text-align:center;">' + tr.velMedia + ' km/h</td>' +
             '<td style="' + TD + 'text-align:center;color:#9aa0ad;">' + tr.velIdeal + ' km/h</td>' +
             '<td style="' + TD + 'text-align:center;">' + fmtMin(tr.tempoEsperadoMin) + '</td>' +
             '<td style="' + TD + 'text-align:center;">' + fmtMin(tr.tempoRealizadoMin) + '</td>' +
             '<td style="' + TD + 'text-align:center;color:' + impCol + ';font-weight:700;">' + esc(tr.impacto) + '</td>' +
             '<td style="' + TD + 'text-align:center;"><span style="color:' + col + ';font-weight:700;">' + critLabel(tr.criticidade) + '</span></td>' +
             '</tr>';
      });
      h += '</tbody></table>';
    }

    // 7. Paradas Críticas
    if (d.paradasCriticas && d.paradasCriticas.length) {
      h += subTitle('Paradas Críticas');
      h += '<table style="width:100%;border-collapse:collapse;border:1px solid #cdd2e5;">' +
           '<thead><tr>' +
           '<th style="' + TH + 'text-align:left;">Local</th>' +
           '<th style="' + TH + 'text-align:center;">Previsto</th>' +
           '<th style="' + TH + 'text-align:center;">Realizado</th>' +
           '<th style="' + TH + 'text-align:center;">Excesso</th>' +
           '<th style="' + TH + 'text-align:center;">Criticidade</th>' +
           '</tr></thead><tbody>';
      d.paradasCriticas.forEach(function (p) {
        var col = critColor(p.criticidade);
        h += '<tr>' +
             '<td style="' + TD + '">' + esc(p.local) + '</td>' +
             '<td style="' + TD + 'text-align:center;">' + fmtMin(p.previstoMin) + '</td>' +
             '<td style="' + TD + 'text-align:center;">' + fmtMin(p.realizadoMin) + '</td>' +
             '<td style="' + TD + 'text-align:center;color:#d94040;font-weight:700;">' + esc(p.impacto) + '</td>' +
             '<td style="' + TD + 'text-align:center;"><span style="color:' + col + ';font-weight:700;">' + critLabel(p.criticidade) + '</span></td>' +
             '</tr>';
      });
      h += '</tbody></table>';
    }

    // 8. Recuperação Operacional
    if (n.recuperacaoOperacional) {
      h += subTitle('Recuperação Operacional');
      h += '<p style="font-size:11.5px;line-height:1.6;color:#5a6070;margin:0;">' + nl(n.recuperacaoOperacional) + '</p>';
    }

    // 9. Inconsistências
    if (d.inconsistencias && d.inconsistencias.length) {
      h += '<div style="background:#fdf3f3;border:1px solid #d9404044;border-radius:8px;padding:11px 14px;margin-top:16px;">' +
           '<div style="font-size:11px;font-weight:800;color:#d94040;margin-bottom:7px;">Inconsistências detectadas (' + d.inconsistencias.length + ')</div>';
      d.inconsistencias.forEach(function (it) {
        h += '<div style="margin-bottom:5px;font-size:11px;line-height:1.45;color:#5a6070;">' +
             '<span style="font-weight:700;color:#d94040;">' + esc(it.titulo || 'Inconsistência') + ':</span> ' +
             esc(it.descricao || '') + '</div>';
      });
      h += '</div>';
    }

    // 10. Parecer Técnico
    if (n.parecerFinal) {
      h += '<div style="background:#fff8f2;border:1px solid #f4792033;border-radius:10px;padding:14px 16px;margin-top:16px;">' +
           '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#f47920;margin-bottom:8px;">Parecer Técnico</div>' +
           '<div style="font-size:12.5px;line-height:1.65;color:#1a1d23;">' + nl(n.parecerFinal) + '</div>' +
           '</div>';
    }

    h += '</div>';
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
   * Diferença assinada em minutos entre dois horários "HH:MM".
   * Positivo = real depois do comercial (atraso); negativo = adiantado.
   * Normaliza para o intervalo (-720, +720] para tratar virada de meia-noite.
   * Retorna null se algum horário estiver ausente.
   */
  function _diffMin(realHHMM, schedHHMM) {
    if (!realHHMM || !schedHHMM) return null;
    var r = String(realHHMM).match(/(\d{1,2}):(\d{2})/);
    var s = String(schedHHMM).match(/(\d{1,2}):(\d{2})/);
    if (!r || !s) return null;
    var rMin = parseInt(r[1], 10) * 60 + parseInt(r[2], 10);
    var sMin = parseInt(s[1], 10) * 60 + parseInt(s[2], 10);
    var d = ((rMin - sMin) % 1440 + 1440) % 1440; // 0..1439
    if (d > 720) d -= 1440;                        // -719..720
    return d;
  }

  /**
   * Formata uma diferença assinada de minutos como "+33min" / "+1h47" / "no horário".
   */
  function _fmtDiff(min) {
    if (min == null) return '—';
    var abs = Math.abs(Math.round(min));
    if (abs === 0) return 'no horário';
    var sign = min > 0 ? '+' : '−'; // − (minus)
    if (abs < 60) return sign + abs + 'min';
    var hh = Math.floor(abs / 60);
    var mm = abs % 60;
    return sign + hh + 'h' + (mm > 0 ? ('0' + mm).slice(-2) : '');
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

    // Tempo esperado por ponto — prioridade: tempo_local do esquema (legado)
    // > TEMPO_PERMANENCIA (aba, { codigo: minutos }) > fallback por tipo.
    var esqTLMap = {};
    var tempoPerm = params.temposPermanencia || {};
    // Horário comercial por ponto (do esquema operacional) — usado para medir atraso
    var esqComercialMap = {};
    _esqOrd.forEach(function(ep) {
      var idPonto = ep.id_ponto ? String(ep.id_ponto).trim() : '';
      if (!idPonto) return;
      // tempo_local salvo (pode ainda existir em esquemas antigos) — prioridade máxima
      if (ep.tempo_local) {
        var parts = String(ep.tempo_local).trim().split(':');
        var tl = parts.length === 2
          ? (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0)
          : parseFloat(ep.tempo_local) || 0;
        if (tl > 0) { esqTLMap[idPonto] = tl; }
      }
      // TEMPO_PERMANENCIA: usa se ainda não foi definido pelo tempo_local
      if (esqTLMap[idPonto] === undefined && tempoPerm[idPonto] !== undefined) {
        esqTLMap[idPonto] = tempoPerm[idPonto];
      }
      if (ep.horario_comercial) {
        esqComercialMap[idPonto] = String(ep.horario_comercial).trim();
      }
    });

    // Pontos que aparecem na viagem mas NÃO estão no esquema (fora de rota)
    // também recebem o tempo da aba, se cadastrado.
    // A busca abaixo cobre esse caso ao usar esqTLMap com fallback direto a tempoPerm.

    var tripForMap = payload.tripForMap || [];
    var tripLastIdx = tripForMap.length - 1;
    var paradasFora = [];
    tripForMap.forEach(function(pt, idx) {
      if (idx === 0 || idx === tripLastIdx) return;
      if (pt.apoioManual || pt.ignorarManual) return; // ajuste manual: não é parada fora
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

    // Tripulação — um bloco por motorista: "matrícula · nome · base" e, abaixo, o
    // sub-trecho sob responsabilidade dele. Envolvido em marcador para o template
    // ANALISE_OP extrair e renderizar como seção "TRIPULANTE" logo após DADOS DA
    // VIAGEM (mesma posição/estilo do cabeçalho). Sem o marcador (API antiga),
    // os blocos apenas aparecem aqui no relato como fallback.
    var motoristasTrecho = payload.motoristasTrecho || [];
    if (payload.tipo === 'TRECHO' && motoristasTrecho.length > 0) {
      var crew = '';
      motoristasTrecho.forEach(function(v) {
        var mat  = v.matricula
          ? '<span style="color:#c25a00;font-weight:800;">' + _esc(v.matricula) + '</span>' +
            '<span style="color:#c9ccd4;">&nbsp;&#8226;&nbsp;</span>'
          : '';
        var nome = '<span style="font-weight:700;">' + _esc(v.nome || '—') + '</span>';
        var base = v.base
          ? '<span style="color:#8a8f99;font-weight:600;">&nbsp;&#8226;&nbsp;' + _esc(v.base) + '</span>'
          : '';
        var subTrecho = _esc(v.inicioNome || v.ponto_inicio || '—') +
                        ' <span style="color:#f47920;font-weight:700;">&#8594;</span> ' +
                        _esc(v.fimNome || v.ponto_fim || '—');
        // Fundo laranja claro no lugar do acento border-left (o Word não renderiza
        // borda lateral colorida, mas preserva o sombreamento via shim do docx.render).
        // NÃO usar tom que comece com "#fff" — o shim o trata como branco e ignora.
        crew += '<div style="border:1px solid #f2d3ba;border-left:3px solid #f47920;border-radius:6px;' +
                        'padding:9px 12px;margin-bottom:8px;background:#ffe9d6;">' +
               '<div style="font-size:12px;line-height:1.4;">' + mat + nome + base + '</div>' +
               '<div style="font-size:11px;color:#5a6070;margin-top:4px;">' +
                 '<span style="text-transform:uppercase;font-size:9px;font-weight:700;letter-spacing:.05em;' +
                        'color:#8a8f99;">Trecho</span>&nbsp;&nbsp;' + subTrecho +
               '</div>' +
             '</div>';
      });
      h += '<!--TRIPULANTE:START-->' + crew + '<!--TRIPULANTE:END-->';
    }

    // Tabela de registro do trecho — chegada / tempo no local / saída (MOTORISTA e TRECHO)
    if (payload.tipo !== 'COMPLETO' && tripForMap.length > 0) {
      var pontosRegistro = tripForMap.filter(function(pt) {
        if (pt.ignorarManual) return false; // ajuste manual: removido do relatório
        return pt.matched || (pt.parada_s && pt.parada_s > 0);
      });
      if (pontosRegistro.length > 0) {
        var THR = 'background:#f0f2f8;padding:6px 10px;font-size:9px;font-weight:700;text-transform:uppercase;' +
                  'letter-spacing:.05em;color:#5a6070;border:1px solid #cdd2e5;white-space:nowrap;text-align:center;';
        var TDR = 'padding:7px 10px;border:1px solid #dde1ee;vertical-align:middle;font-size:11px;';
        // Mostra colunas Comercial/Dif. somente quando o esquema tem horário comercial em algum ponto do trecho
        var _temComercialReg = pontosRegistro.some(function(pt) {
          var c = String(pt.codigo || '').trim();
          return c && esqComercialMap[c];
        });
        h += '<div style="margin-bottom:20px;">' +
             '<h4 style="font-size:13px;margin:0 0 10px;color:#1a1d23;font-weight:800;letter-spacing:0.02em;">' +
             'Registro do Trecho</h4>' +
             '<table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid #cdd2e5;">' +
             '<thead><tr>' +
             '<th style="' + THR + 'width:32px;">#</th>' +
             '<th style="' + THR + 'text-align:left;">Ponto</th>' +
             '<th style="' + THR + '">Chegada</th>' +
             (_temComercialReg ? '<th style="' + THR + '">Comercial</th>' : '') +
             (_temComercialReg ? '<th style="' + THR + '">Dif.</th>'      : '') +
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
          var isApoio = !!pt.apoioManual; // ajuste manual: ponto de apoio legítimo
          // Ponto fora do esquema: tem parada, não é garagem e não consta no esquema (apoio nunca é "fora")
          var isForaEsquema = !isApoio && !isGaragem && paradaMin > 0 && !(codigo && esquemaIdSet[codigo]);
          var esperadoMin = esqTLMap[codigo] != null    ? esqTLMap[codigo]
            : (codigo && tempoPerm[codigo] != null)     ? tempoPerm[codigo]
            : /RODOVI[AÁ]RIA|RODOVIARIA/.test(nome)    ? 30
            : isGaragem                                 ? 20
            : TEMPO_ESPERADO_PADRAO;
          // apoio: parada legítima, mas com teto de 30min — acima disso registra excesso.
          var excessoMin = (isExtremo || isGaragem) ? 0
            : isApoio ? Math.max(0, Math.round((paradaMin - 30) * 10) / 10)
            : Math.max(0, Math.round((paradaMin - esperadoMin) * 10) / 10);
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
          // Comercial (do esquema) × hora real → diferença assinada.
          // No 1º ponto (origem) compara com a SAÍDA (partida); nos demais, com a chegada.
          var comercial   = codigo ? (esqComercialMap[codigo] || null) : null;
          var horaCmp     = isFirst ? saida : chegada;
          var difMin      = (horaCmp && horaCmp !== '—' && comercial) ? _diffMin(horaCmp, comercial) : null;
          var comercialCel = comercial
            ? '<span style="color:#1565c0;">' + comercial + '</span>'
            : '<span style="color:#bbb;">—</span>';
          var difCor  = difMin == null ? '#bbb' : difMin > 0 ? '#d94040' : difMin < 0 ? '#22a96a' : '#888';
          var difCel  = '<span style="color:' + difCor + ';font-weight:' + (difMin ? '700' : '400') + ';">' + _fmtDiff(difMin) + '</span>';
          h += '<tr style="' + rowBg + '">' +
               '<td style="' + TDR + 'text-align:center;color:#888;">' + (pt.seq || (idx + 1)) + '</td>' +
               '<td style="' + TDR + '">' + nomeCel + '</td>' +
               '<td style="' + TDR + 'text-align:center;font-family:monospace;">' + chegada + '</td>' +
               (_temComercialReg ? '<td style="' + TDR + 'text-align:center;font-family:monospace;">' + comercialCel + '</td>' : '') +
               (_temComercialReg ? '<td style="' + TDR + 'text-align:center;">' + difCel + '</td>' : '') +
               '<td style="' + TDR + 'text-align:center;">' + paradaHtml + '</td>' +
               '<td style="' + TDR + 'text-align:center;font-family:monospace;">' + saida + '</td>' +
               '</tr>';
        });
        h += '</tbody></table></div>';
      }
    }

    // Paradas com excesso e paradas fora do esquema já aparecem, de forma mais
    // completa, nas tabelas "Paradas Críticas"/"Trechos Críticos" do Diagnóstico
    // Inteligente — não duplicar aqui.

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

    // Eventos de velocidade — considera apenas os NÃO justificados para a
    // checagem de "sem ocorrências" abaixo (contexto urbano/garagem ou
    // justificativa manual não são pendências).
    var eventosPendentes = eventos.filter(function (ev) { return !ev.justificado; });

    // Gráfico de velocidade por trecho (mesmo gráfico exibido na aplicação),
    // com a tabela de referência "trecho → velocidade" logo abaixo para deixar
    // claro qual barra corresponde a qual trecho.
    var pontosNoTrechoRelato = {};
    tripForMap.forEach(function (pt) { if (pt.ponto) pontosNoTrechoRelato[pt.ponto] = true; });
    var trechoSegmentsVel = (params.segments || []).filter(function (s) {
      return s.velocidadeKmh != null && (pontosNoTrechoRelato[s.de] || pontosNoTrechoRelato[s.para]);
    });
    if (trechoSegmentsVel.length > 0) {
      h += _buildVelocidadeChartHtml(trechoSegmentsVel);
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

    // Sem ocorrências (considera apenas pendências reais — justificados não contam)
    if (
      excessos.length === 0 &&
      paradasFora.length === 0 &&
      naoVisit.length === 0 &&
      eventosPendentes.length === 0
    ) {
      h +=
        '<p style="color:#22a96a;font-size:12px;font-weight:600;display:flex;align-items:center;gap:4px;"><svg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\' viewBox=\'0 0 24 24\' width=\'13\' height=\'13\'><polyline points=\'20 6 9 17 4 12\'/></svg> Viagem sem ocorrências operacionais registradas.</p>';
    }

    return h;
  }

  /**
   * Monta o gráfico de barras de velocidade por trecho — mesmo visual do
   * gráfico exibido na aplicação (analysis.html/renderVelocidadeChart), em
   * SVG estático (sem tooltip, já que o PDF não é interativo). Uma tabela de
   * referência abaixo do gráfico identifica cada barra pelo trecho (De → Para).
   */
  function _buildVelocidadeChartHtml(segments) {
    var IDEAL_MIN = 80, IDEAL_MAX = 90;
    var colorFor = function (v) {
      if (v < 70) return '#e8a020';   // abaixo do ideal
      if (v <= 90) return '#22a96a';  // aceitável
      if (v <= 100) return '#f47920'; // excesso
      return '#d94040';              // crítico
    };

    var maxVel = segments.reduce(function (m, s) { return Math.max(m, s.velocidadeKmh); }, 0);
    var maxY = Math.max(100, Math.ceil(maxVel / 20) * 20);

    var leftPad = 34, rightPad = 10, topPad = 16, bottomPad = 24, plotH = 160;
    var maxChartWidth = 660;
    var gap = 8;
    var barW = Math.max(10, Math.min(30, Math.floor((maxChartWidth - leftPad - rightPad - (segments.length - 1) * gap) / segments.length)));
    var innerW = segments.length * barW + (segments.length - 1) * gap;
    var W = leftPad + innerW + rightPad;
    var H = topPad + plotH + bottomPad;

    var y = function (v) { return topPad + plotH * (1 - v / maxY); };

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">';

    // Faixa ideal destacada (80–90 km/h)
    svg += '<rect x="' + leftPad + '" y="' + y(IDEAL_MAX) + '" width="' + innerW +
           '" height="' + (y(IDEAL_MIN) - y(IDEAL_MAX)) + '" fill="rgba(34,169,106,0.10)"/>';

    // Linhas de grade + rótulos do eixo Y
    for (var g = 0; g <= maxY; g += 20) {
      var gy = y(g);
      svg += '<line x1="' + leftPad + '" y1="' + gy + '" x2="' + (leftPad + innerW) + '" y2="' + gy + '" stroke="#dde1ee" stroke-width="1"/>';
      svg += '<text x="' + (leftPad - 6) + '" y="' + (gy + 3) + '" text-anchor="end" font-size="8" fill="#8a8f99">' + g + '</text>';
    }

    // Barras
    segments.forEach(function (s, i) {
      var v = s.velocidadeKmh;
      var bx = leftPad + i * (barW + gap);
      var by = y(v);
      var bh = Math.max(0, (topPad + plotH) - by);
      var lx = bx + barW / 2;
      svg += '<rect x="' + bx + '" y="' + by + '" width="' + barW + '" height="' + bh + '" rx="2" fill="' + colorFor(v) + '"/>';
      svg += '<text x="' + lx + '" y="' + (by - 4) + '" text-anchor="middle" font-size="8" fill="#5a6070">' + Math.round(v) + '</text>';
      svg += '<text x="' + lx + '" y="' + (topPad + plotH + 14) + '" text-anchor="middle" font-size="8" fill="#8a8f99">' + (i + 1) + '</text>';
    });

    svg += '</svg>';

    var h = '<div style="margin-bottom:16px;">';
    h += '<h4 style="font-size:13px;margin:0 0 8px;color:#1a1d23;font-weight:700;">Eventos de Velocidade — Gráfico por Trecho (' + segments.length + ')</h4>';
    h += '<div style="font-size:9px;color:#5a6070;margin-bottom:8px;">' +
         '<span style="color:#e8a020;">■</span> Abaixo do ideal (&lt;70) &nbsp; ' +
         '<span style="color:#22a96a;">■</span> Aceitável (70–90) &nbsp; ' +
         '<span style="color:#f47920;">■</span> Excesso (90–100) &nbsp; ' +
         '<span style="color:#d94040;">■</span> Crítico (&gt;100) &nbsp; ' +
         '<span style="background:rgba(34,169,106,0.10);border:1px solid #cdd2e5;padding:0 4px;">&nbsp;</span> Faixa ideal (80–90)' +
         '</div>';
    h += svg;

    // Tabela de referência: qual barra (#) corresponde a qual trecho
    var TH = 'background:#f0f2f8;padding:5px 8px;font-size:9px;font-weight:700;text-transform:uppercase;' +
             'letter-spacing:.05em;color:#5a6070;border:1px solid #cdd2e5;white-space:nowrap;';
    var TD = 'padding:5px 8px;border:1px solid #dde1ee;vertical-align:middle;font-size:10px;';
    h += '<table style="width:100%;border-collapse:collapse;margin-top:8px;border:1px solid #cdd2e5;">' +
         '<thead><tr>' +
         '<th style="' + TH + 'text-align:center;width:28px;">#</th>' +
         '<th style="' + TH + 'text-align:left;">Trecho (De → Para)</th>' +
         '<th style="' + TH + 'text-align:center;">Vel. média</th>' +
         '</tr></thead><tbody>';
    segments.forEach(function (s, i) {
      h += '<tr>' +
           '<td style="' + TD + 'text-align:center;color:#888;">' + (i + 1) + '</td>' +
           '<td style="' + TD + '">' + (s.de || '—') + ' &#8594; ' + (s.para || '—') + '</td>' +
           '<td style="' + TD + 'text-align:center;font-weight:700;color:' + colorFor(s.velocidadeKmh) + ';">' + s.velocidadeKmh + ' km/h</td>' +
           '</tr>';
    });
    h += '</tbody></table></div>';

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
   * Escapa caracteres HTML para inserção segura em templates de relatório.
   */
  function _esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
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
      if (pt.apoioManual || pt.ignorarManual) return; // ajuste manual: não gera ocorrência
      if (!pt.parada_s || pt.parada_s <= 0) return;
      if (pt.codigo && esquemaIdSet[String(pt.codigo).trim()]) return;
      if (!pt.proibido42) return;
      paradasFora.push({ ponto: pt.ponto, codigo: pt.codigo || null, entrada: pt.entrada, saida: pt.saida });
    });

    if (paradasFora.length === 0) return [];

    // ── Upsert do motorista + resolução da viagem (código+horário+sentido) ──
    var ctx = _lookupDriverAndTrip(baseUrl, motorista, {
      codLinha:  params.codLinha || '',
      nomeLinha: nomeLinha,
      horario:   horario,
      sentido:   params.sentido  || '',
    });
    var driverId        = ctx.driverId;
    var tripId          = ctx.tripId;
    var matchedLineName = ctx.matchedLineName;
    var matchedTripTime = ctx.matchedTripTime;

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
        analisadoPor:  props.getProperty("REPORT_ANALISADO_POR") || "LUCAS",
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

  // ============================================================
  //  EXCESSO DE PERMANÊNCIA  (occurrences typeCode EXCESSO_PERMANENCIA)
  // ============================================================

  /**
   * Resolve a viagem na API por CÓDIGO + horário (+ sentido), com fallback por
   * nome. Retorna a linha OFICIAL da base — corrige "nome da linha errado".
   * opts: { codLinha, nomeLinha, horario, sentido }
   * @returns {{tripId:(string|null), lineLabel:string, tripTime:string}}
   */
  function _resolveTrip(baseUrl, opts) {
    opts = opts || {};
    var horario = opts.horario || '';
    var out = { tripId: null, lineLabel: opts.nomeLinha || '', tripTime: horario };
    if (!horario || !(opts.codLinha || opts.nomeLinha)) return out;
    try {
      var q = baseUrl + "/trips/lookup?departureTime=" + encodeURIComponent(horario);
      if (opts.codLinha)  q += "&lineCode="  + encodeURIComponent(opts.codLinha);
      if (opts.nomeLinha) q += "&lineName="  + encodeURIComponent(opts.nomeLinha);
      if (opts.sentido)   q += "&direction=" + encodeURIComponent(opts.sentido);
      var tr = UrlFetchApp.fetch(q, { method: "get", muteHttpExceptions: true });
      if (tr.getResponseCode() === 200) {
        var td = JSON.parse(tr.getContentText()) || {};
        out.tripId = td.id || null;
        // lineLabel = NOME PURO da linha (sem o sentido). O sentido é derivado
        // da viagem via tripId no editor/relatório — não deve poluir o nome.
        if (td.lineName) out.lineLabel = td.lineName;
        if (td.departureTime) out.tripTime = td.departureTime;
      }
    } catch (e) { /* segue com o fallback (nomeLinha) */ }
    return out;
  }

  /**
   * Upsert do motorista + resolução da viagem (via _resolveTrip). Compartilhado.
   * opts: { codLinha, nomeLinha, horario, sentido }
   */
  function _lookupDriverAndTrip(baseUrl, motorista, opts) {
    opts = opts || {};
    var out = { driverId: null, tripId: null, matchedLineName: opts.nomeLinha || '', matchedTripTime: opts.horario || '' };
    if (motorista && (motorista.matricula || motorista.nome)) {
      try {
        var mat = motorista.matricula || '', nome = motorista.nome || '';
        var dr = UrlFetchApp.fetch(baseUrl + "/drivers/upsert", {
          method: "post", contentType: "application/json",
          payload: JSON.stringify({ code: mat || nome, name: nome || mat, base: motorista.base || null }),
          muteHttpExceptions: true,
        });
        if (dr.getResponseCode() === 200) out.driverId = (JSON.parse(dr.getContentText()) || {}).id || null;
      } catch (e) { /* segue sem driverId */ }
    }
    var trip = _resolveTrip(baseUrl, opts);
    out.tripId          = trip.tripId;
    out.matchedLineName = trip.lineLabel;
    out.matchedTripTime = trip.tripTime;
    return out;
  }

  /** POST /occurrences → { status, id?, httpCode?, message? } */
  function _postOccurrence(baseUrl, occPayload) {
    try {
      var resp = UrlFetchApp.fetch(baseUrl + "/occurrences", {
        method: "post", contentType: "application/json",
        payload: JSON.stringify(occPayload), muteHttpExceptions: true,
      });
      var code = resp.getResponseCode(), body;
      try { body = JSON.parse(resp.getContentText()); } catch (e) { body = {}; }
      if (code >= 200 && code < 300) return { status: "ok", id: body.id || null };
      return { status: "error", httpCode: code, message: body.message || resp.getContentText() };
    } catch (e) {
      return { status: "error", message: String(e) };
    }
  }

  /**
   * Cria ocorrência(s) EXCESSO_PERMANENCIA para paradas com permanência acima
   * do previsto. Espelha enviarParadasFora, mas seleciona por seqAlvo (botão por
   * card) e usa o typeCode de excesso de permanência. Respeita apoio/ignorar.
   *
   * @param {Object} params  { enrichedTrip, esquemaPontos, motorista, nomeLinha, horario, summary, seqAlvo }
   * @returns {Array} [{ ponto, status, id?, httpCode?, message? }]
   */
  function enviarExcessoPermanencia(params) {
    var props   = PropertiesService.getScriptProperties();
    var baseUrl = (props.getProperty("REPORT_API_URL") || "").replace(/\/$/, "");
    if (!baseUrl) throw new Error("REPORT_API_URL não configurada.");

    var enrichedTrip  = params.enrichedTrip  || [];
    var esquemaPontos = params.esquemaPontos || [];
    var motorista     = params.motorista     || {};
    var summary       = params.summary       || {};
    var seqAlvo       = params.seqAlvo != null ? Number(params.seqAlvo) : null;

    // Seleciona os pontos com permanência excedida (um, quando via botão por card)
    var alvos = [];
    enrichedTrip.forEach(function (pt) {
      if (seqAlvo != null && Number(pt.seq) !== seqAlvo) return;
      if (pt.apoioManual || pt.ignorarManual) return;      // ajuste manual: isento
      if (!pt.parada_s || pt.parada_s <= 0) return;
      alvos.push({ ponto: pt.ponto, codigo: pt.codigo || null, entrada: pt.entrada, saida: pt.saida });
    });
    if (alvos.length === 0) return [];

    var ctx           = _lookupDriverAndTrip(baseUrl, motorista, {
      codLinha:  params.codLinha  || '',
      nomeLinha: params.nomeLinha || '',
      horario:   params.horario   || '',
      sentido:   params.sentido   || '',
    });
    var dateStr       = _parseDateBrToIso(summary.dataViagem || "") || _todayIso();
    var vehicleNumber = String(summary.veiculo || "—").trim();
    var esquemaHtml   = _buildEsquemaHtml(esquemaPontos, ctx.matchedLineName, ctx.matchedTripTime);
    var hasMot        = !!(motorista.nome || motorista.matricula);
    var analisadoPor  = props.getProperty("REPORT_ANALISADO_POR") || "LUCAS";

    var results = [];
    alvos.forEach(function (pf) {
      var startTime = _extractTime(pf.entrada) || "00:00";
      var endTime   = _extractTime(pf.saida)   || startTime;

      var occPayload = {
        typeCode:      "EXCESSO_PERMANENCIA",
        analisadoPor:  analisadoPor,
        eventDate:     dateStr,
        tripDate:      dateStr,
        startTime:     startTime,
        endTime:       endTime,
        vehicleNumber: vehicleNumber,
        lineLabel:     ctx.matchedLineName || null,
        tripId:        ctx.tripId          || undefined,
        tripTime:      ctx.matchedTripTime || null,
        place:         pf.ponto  || "—",
        placeCode:     pf.codigo || undefined,
        relatoHtml:    esquemaHtml,
        showSectionTripulacao:     hasMot,
        showSectionViagem:         true,
        showSectionIdentificacao:  true,
        showSectionDados:          true,
        showSectionPassageiros:    false,
        devolutivaBeforeEvidences: false,
        drivers: hasMot ? [{
          position: 1,
          driverId:  ctx.driverId        || undefined,
          registry:  motorista.matricula || undefined,
          name:      motorista.nome      || undefined,
          baseCode:  motorista.base      || undefined,
        }] : [],
      };

      var r = _postOccurrence(baseUrl, occPayload);
      results.push({ ponto: pf.ponto, status: r.status, id: r.id, httpCode: r.httpCode, message: r.message });
    });

    return results;
  }

  return {
    gerarRelatorioMotorista: gerarRelatorioMotorista,
    gerarRelatorioTrecho: gerarRelatorioTrecho,
    gerarRelatorioCompleto: gerarRelatorioCompleto,
    enviarParaAPI: enviarParaAPI,
    enviarParadasFora: enviarParadasFora,
    enviarExcessoPermanencia: enviarExcessoPermanencia,
    buildEsquemaHtml: _buildEsquemaHtml,
  };
})();
