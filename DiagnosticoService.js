// ============================================================
//  DiagnosticoService.gs  —  Módulo "Análise Inteligente da Viagem"
//  Camada analítica sobre o relatório operacional. NÃO o substitui.
//
//  Arquitetura em camadas:
//    _buildContext(payload)  → camada de contexto (determinística/pura)
//    _buildPrompt(context)   → camada de prompt
//    _callAI(prompt)         → camada de consumo (Groq, com retry)
//    gerarDiagnostico(...)   → orquestração + merge narrativa/métricas
//
//  Princípio: TODOS os números vêm da camada determinística. A IA produz
//  apenas a narrativa (parecer). Isso garante confiabilidade dos indicadores.
// ============================================================

var DiagnosticoService = (() => {

  // Faixa de velocidade ideal (km/h) — alinhada ao AnalysisService.
  const VEL_IDEAL = 85;         // referência de cruzeiro para "tempo esperado"
  const VEL_LENTA_MAX = 70;     // abaixo disso o trecho é considerado lento
  const TOLERANCIA_MIN = 5;     // ignora ruído menor que isso ao classificar

  // ============================================================
  //  CAMADA DE CONTEXTO (determinística)
  // ============================================================

  /**
   * Constrói o objeto de fatos a partir dos dados operacionais já calculados.
   * @param {{enrichedTrip:Array, esquemaPontos:Array, summary:Object, segments:Array, nomeLinha:string, idEsquema:string}} payload
   * @returns {Object} context
   */
  function _buildContext(payload) {
    const trip     = payload.enrichedTrip || [];
    const esquema  = payload.esquemaPontos || [];
    const segments = payload.segments || [];
    const summary  = payload.summary || {};

    const comparacao = esquema.length > 0
      ? ComparisonService.compararRota(esquema, trip)
      : [];
    const naoVisitados = comparacao.length > 0
      ? ComparisonService.getPontosNaoVisitados(comparacao)
      : [];

    const timeline        = _buildTimeline(comparacao);
    const trechosCriticos = _buildTrechos(segments);
    const paradasCriticas = _buildParadas(trip);
    const inconsistencias = _buildInconsistencias(trip, esquema);

    const pontosIgnorados = naoVisitados.map(function (p) {
      return { local: p.nome_ponto || p.id_ponto, ordem: p.ordem };
    });

    // Totais de tempo a partir dos deltas da timeline (captura tanto direção
    // lenta quanto excesso de parada, de forma coerente com a evolução do atraso).
    let tempoPerdido = 0, tempoRecuperado = 0;
    timeline.forEach(function (t) {
      if (t.deltaMin > 0) tempoPerdido += t.deltaMin;
      else if (t.deltaMin < 0) tempoRecuperado += Math.abs(t.deltaMin);
    });

    const cards = _buildCards({
      timeline: timeline,
      trechos: trechosCriticos,
      paradas: paradasCriticas,
      inconsistencias: inconsistencias,
      pontosIgnorados: pontosIgnorados,
      summary: summary,
      tempoPerdido: tempoPerdido,
      tempoRecuperado: tempoRecuperado
    });

    return {
      meta: {
        nomeLinha: payload.nomeLinha || summary.nomeLinha || '—',
        veiculo:   summary.veiculo   || '—',
        motorista: summary.motorista || 'Não Informado',
        dataViagem: summary.dataViagem || '—',
        totalPontos: trip.length,
        // Escopo da análise: '' = viagem inteira; senão "Trecho: A → B" / "Motorista: X".
        escopo: payload.escopo || ''
      },
      cards: cards,
      timeline: timeline,
      trechosCriticos: trechosCriticos,
      paradasCriticas: paradasCriticas,
      pontosIgnorados: pontosIgnorados,
      inconsistencias: inconsistencias,
      indicadores: {
        velocidadeMedia: summary.velocidadeMedia || 0,
        totalKm:         summary.totalKm || 0,
        tempoTotalMin:   summary.tempoTotalMin || 0,
        tempoPerdidoMin:    Math.round(tempoPerdido),
        tempoRecuperadoMin: Math.round(tempoRecuperado),
        atrasoFinalMin:  timeline.length ? timeline[timeline.length - 1].atrasoAcumMin : null,
        eventosCriticos: summary.alertasCriticos || 0,
        paradasForaEsquema: inconsistencias.filter(function (i) { return i.tipo === 'PARADA_FORA'; }).length,
        pontosIgnorados: pontosIgnorados.length
      }
    };
  }

  /**
   * Linha do tempo do atraso: para cada ponto do esquema visitado e com
   * horário comercial, mede o atraso acumulado (real vs comercial) e o
   * delta em relação ao ponto anterior.
   */
  function _buildTimeline(comparacao) {
    const visitadosComHorario = comparacao.filter(function (c) {
      return c.visitado && c.ponto_realizado && c.horario_comercial;
    });

    const items = [];
    let prevAtraso = null;
    visitadosComHorario.forEach(function (c) {
      const realHHMM = _hhmm(c.ponto_realizado.entrada);
      const atraso = _diffMin(realHHMM, c.horario_comercial);
      if (atraso === null) return;

      const delta = prevAtraso === null ? 0 : (atraso - prevAtraso);
      let tendencia = 'estavel';
      if (delta > TOLERANCIA_MIN) tendencia = 'perdeu';
      else if (delta < -TOLERANCIA_MIN) tendencia = 'recuperou';

      items.push({
        local: c.nome_ponto || c.id_ponto,
        horarioComercial: c.horario_comercial,
        horarioReal: realHHMM,
        atrasoAcumMin: atraso,
        deltaMin: delta,
        tendencia: tendencia
      });
      prevAtraso = atraso;
    });
    return items;
  }

  /**
   * Trechos críticos: para cada segmento com dados válidos, compara o tempo
   * realizado com o tempo esperado na velocidade ideal.
   */
  function _buildTrechos(segments) {
    const rows = [];
    segments.forEach(function (s) {
      if (s.distKm == null || s.tempoMin == null || s.tempoMin <= 0 || s.distKm <= 0) return;
      const vel = s.velocidadeKmh != null ? s.velocidadeKmh : Math.round((s.distKm / (s.tempoMin / 60)) * 10) / 10;
      const tempoEsperado = (s.distKm / VEL_IDEAL) * 60;
      const tempoPerdido = s.tempoMin - tempoEsperado; // >0 perdeu, <0 adiantou
      rows.push({
        trecho: s.de + ' → ' + s.para,
        velMedia: vel,
        velIdeal: VEL_IDEAL,
        tempoEsperadoMin: Math.round(tempoEsperado),
        tempoRealizadoMin: Math.round(s.tempoMin),
        tempoPerdidoMin: Math.round(tempoPerdido),
        impacto: _fmtDelta(tempoPerdido),
        criticidade: _criticidade(Math.max(0, tempoPerdido), vel < VEL_LENTA_MAX)
      });
    });
    // Mais impactantes primeiro (mais tempo perdido)
    rows.sort(function (a, b) { return b.tempoPerdidoMin - a.tempoPerdidoMin; });
    return rows;
  }

  /**
   * Paradas críticas: pontos com excesso de permanência (real > esperado).
   * Ignora garagem e extremos (primeiro/último ponto), coerente com o relatório.
   */
  function _buildParadas(trip) {
    const rows = [];
    trip.forEach(function (pt, idx) {
      if (!pt.parada_s || pt.parada_s <= 0) return;
      // Ajuste manual do usuário: ponto de apoio (parada autorizada) ou ignorado.
      // Mesma regra do relatório operacional (ReportService._calcularParadas).
      if (pt.apoioManual || pt.ignorarManual) return;
      if (pt.garagem) return;
      if (idx === 0 || idx === trip.length - 1) return; // extremos
      const paradaMin = pt.parada_s / 60;
      const esperado = (pt.tempoEsperadoMin != null) ? pt.tempoEsperadoMin : 30;
      const excesso = paradaMin - esperado;
      if (excesso <= TOLERANCIA_MIN) return;
      rows.push({
        local: pt.ponto,
        previstoMin: Math.round(esperado),
        realizadoMin: Math.round(paradaMin),
        excessoMin: Math.round(excesso),
        impacto: _fmtDelta(excesso),
        criticidade: _criticidade(excesso, false)
      });
    });
    rows.sort(function (a, b) { return b.excessoMin - a.excessoMin; });
    return rows;
  }

  /**
   * Inconsistências: paradas fora do esquema, locais proibidos (tipo 42) e
   * locais não identificados na base.
   */
  function _buildInconsistencias(trip, esquema) {
    const esqIds = {};
    esquema.forEach(function (ep) {
      if (ep.id_ponto) esqIds[String(ep.id_ponto).trim()] = true;
    });
    const temEsquema = esquema.length > 0;
    const out = [];

    trip.forEach(function (pt) {
      // Ajuste manual do usuário (apoio/ignorado): ponto já tratado — não gera
      // inconsistência (mesma lógica das paradas proibidas no ReportService).
      if (pt.apoioManual || pt.ignorarManual) return;

      // Local proibido (tipo 42)
      if (pt.matched && /\b42\b/.test(String(pt.tipo || '')) && pt.parada_s > 0) {
        out.push({
          tipo: 'PARADA_PROIBIDA',
          titulo: 'Parada em local proibido',
          descricao: 'Parada de ' + _fmtDur(pt.parada_s) + ' em "' + pt.ponto + '" (tipo 42 — não autorizado).'
        });
      }
      // Local não identificado na base
      if (!pt.matched) {
        out.push({
          tipo: 'LOCAL_NAO_IDENTIFICADO',
          titulo: 'Ponto não identificado',
          descricao: 'O ponto "' + pt.ponto + '" não foi encontrado na base de locais.'
        });
      }
      // Parada fora do esquema (identificado, com parada, mas ausente do esquema)
      if (temEsquema && pt.matched && pt.codigo && pt.parada_s > 0 &&
          !esqIds[String(pt.codigo).trim()]) {
        out.push({
          tipo: 'PARADA_FORA',
          titulo: 'Parada fora do esquema',
          descricao: 'Parada de ' + _fmtDur(pt.parada_s) + ' em "' + pt.ponto + '", que não consta no esquema planejado.'
        });
      }
    });
    return out;
  }

  /** Monta os KPIs dos cards a partir dos fatos já calculados. */
  function _buildCards(f) {
    const timeline = f.timeline, trechos = f.trechos, paradas = f.paradas;

    // Maior responsável pelo atraso: o MAIOR CONTRIBUINTE REAL de tempo perdido —
    // a parada com maior excesso OU o trecho onde mais se perdeu tempo dirigindo.
    //
    // NÃO usar o delta da timeline: como muitos pontos não têm horário comercial
    // (ou não foram visitados), a variação do atraso acumulado entre dois
    // checkpoints acumula toda a defasagem de um trecho longo num único ponto de
    // chegada — mesmo que ele não tenha parado em excesso. Isso confunde o
    // RESULTADO (coluna DIF = defasagem vs. horário) com a CAUSA do atraso.
    let maiorAtraso = null;
    const topParada = paradas.length ? paradas[0] : null;                    // ordenado por excesso desc
    const topTrecho = (trechos.length && trechos[0].tempoPerdidoMin > 0) ? trechos[0] : null;
    const excParada = topParada ? topParada.excessoMin : 0;
    const perdTrecho = topTrecho ? topTrecho.tempoPerdidoMin : 0;
    if (excParada > 0 && excParada >= perdTrecho) {
      maiorAtraso = { local: 'Parada em ' + topParada.local, valorMin: excParada, tipo: 'parada' };
    } else if (perdTrecho > 0) {
      maiorAtraso = { local: 'Trecho ' + topTrecho.trecho, valorMin: perdTrecho, tipo: 'trecho' };
    }

    // Maior recuperação: leg com delta mais negativo.
    let maiorRecup = null;
    timeline.forEach(function (t) {
      if (t.deltaMin < 0 && (!maiorRecup || t.deltaMin < maiorRecup.valorMin)) {
        maiorRecup = { local: t.local, valorMin: Math.abs(t.deltaMin) };
      }
    });

    const maiorParada = paradas.length ? { local: paradas[0].local, valorMin: paradas[0].excessoMin } : null;

    // Trecho mais lento (menor velocidade média entre os válidos).
    let trechoLento = null;
    trechos.forEach(function (tr) {
      if (!trechoLento || tr.velMedia < trechoLento.velMedia) trechoLento = tr;
    });

    return {
      maiorResponsavelAtraso: maiorAtraso,
      maiorParada: maiorParada,
      maiorRecuperacao: maiorRecup,
      trechoMaisLento: trechoLento ? { trecho: trechoLento.trecho, vel: trechoLento.velMedia } : null,
      velocidadeMedia: f.summary.velocidadeMedia || 0,
      tempoPerdidoMin: Math.round(f.tempoPerdido),
      tempoRecuperadoMin: Math.round(f.tempoRecuperado),
      eventosCriticos: f.summary.alertasCriticos || 0,
      paradasForaEsquema: f.inconsistencias.filter(function (i) { return i.tipo === 'PARADA_FORA'; }).length,
      pontosIgnorados: f.pontosIgnorados.length
    };
  }

  // ============================================================
  //  CAMADA DE PROMPT
  // ============================================================

  /**
   * Monta o prompt para a IA. A IA recebe apenas os fatos já resumidos e
   * responde SOMENTE com a narrativa (JSON estrito).
   * @param {Object} ctx
   * @returns {{system:string, user:string}}
   */
  function _buildPrompt(ctx) {
    const system =
      'Você é um gerente de operações de uma empresa de transporte rodoviário interestadual no Brasil. ' +
      'Recebe os dados JÁ APURADOS de uma viagem (números confiáveis) e deve escrever um parecer técnico, ' +
      'objetivo e profissional, no tom de um relatório gerencial corporativo. ' +
      'REGRAS: (1) NÃO invente números nem locais — use apenas os fatos fornecidos. ' +
      '(2) NÃO repita listas de tabelas; interprete e priorize. ' +
      '(3) Português formal, direto, sem emojis. ' +
      '(4) Responda EXCLUSIVAMENTE com um JSON válido no formato: ' +
      '{"resumoExecutivo":"string (2-3 frases)","diagnosticoGeral":"string","causasPrincipais":' +
      '[{"titulo":"string","descricao":"string","impacto":"alto|medio|baixo"}],' +
      '"recuperacaoOperacional":"string","parecerFinal":"string"}. ' +
      'Sem texto fora do JSON.';

    const user = _resumoTextual(ctx);
    return { system: system, user: user };
  }

  /** Resumo textual compacto dos fatos para a IA (evita estourar tokens). */
  function _resumoTextual(ctx) {
    const L = [];
    L.push('LINHA: ' + ctx.meta.nomeLinha + ' | Veículo: ' + ctx.meta.veiculo +
           ' | Motorista: ' + ctx.meta.motorista + ' | Data: ' + ctx.meta.dataViagem);
    const ind = ctx.indicadores;
    L.push('INDICADORES: vel. média ' + ind.velocidadeMedia + ' km/h; ' + ind.totalKm + ' km; ' +
           'tempo total ' + _fmtMin(ind.tempoTotalMin) + '; tempo perdido ' + _fmtMin(ind.tempoPerdidoMin) +
           '; tempo recuperado ' + _fmtMin(ind.tempoRecuperadoMin) +
           '; atraso final ' + (ind.atrasoFinalMin != null ? _fmtDelta(ind.atrasoFinalMin) : 'n/d') +
           '; eventos críticos ' + ind.eventosCriticos +
           '; paradas fora do esquema ' + ind.paradasForaEsquema +
           '; pontos não visitados ' + ind.pontosIgnorados + '.');

    if (ctx.timeline.length) {
      L.push('EVOLUÇÃO DO ATRASO (local: atraso acumulado / variação):');
      ctx.timeline.forEach(function (t) {
        L.push('  - ' + t.local + ': ' + _fmtDelta(t.atrasoAcumMin) +
               ' (' + (t.deltaMin >= 0 ? '+' : '') + Math.round(t.deltaMin) + ' min, ' + t.tendencia + ')');
      });
    }
    if (ctx.trechosCriticos.length) {
      L.push('TRECHOS MAIS IMPACTANTES:');
      ctx.trechosCriticos.slice(0, 6).forEach(function (tr) {
        L.push('  - ' + tr.trecho + ': ' + tr.velMedia + ' km/h, perdeu ' + _fmtDelta(tr.tempoPerdidoMin) +
               ' (' + tr.criticidade + ')');
      });
    }
    if (ctx.paradasCriticas.length) {
      L.push('PARADAS COM EXCESSO:');
      ctx.paradasCriticas.slice(0, 6).forEach(function (p) {
        L.push('  - ' + p.local + ': previsto ' + p.previstoMin + ' min, realizado ' + p.realizadoMin +
               ' min (excesso ' + _fmtDelta(p.excessoMin) + ', ' + p.criticidade + ')');
      });
    }
    if (ctx.inconsistencias.length) {
      L.push('INCONSISTÊNCIAS:');
      ctx.inconsistencias.slice(0, 8).forEach(function (i) {
        L.push('  - ' + i.titulo + ': ' + i.descricao);
      });
    }
    if (ctx.pontosIgnorados.length) {
      L.push('PONTOS NÃO VISITADOS: ' + ctx.pontosIgnorados.map(function (p) { return p.local; }).join(', ') + '.');
    }
    return L.join('\n');
  }

  // ============================================================
  //  CAMADA DE CONSUMO (Groq) — com retry automático
  // ============================================================

  /**
   * Chama a Groq exigindo JSON. Faz até 3 tentativas com backoff em falhas
   * transitórias (429/5xx). Reusa _groqErroAmigavel_ (Code.gs) para mensagens.
   * @param {{system:string, user:string}} prompt
   * @returns {{ok:true, narrativa:Object, modelo:string}|{ok:false, erro:string}}
   */
  function _callAI(prompt) {
    const props = PropertiesService.getScriptProperties();
    const key = props.getProperty('GROQ_API_KEY');
    if (!key) return { ok: false, erro: 'Chave GROQ_API_KEY não configurada nas Script Properties.' };
    const model = props.getProperty('GROQ_MODEL') || 'llama-3.3-70b-versatile';

    const payload = {
      model: model,
      temperature: 0.3,
      max_tokens: 1400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user',   content: prompt.user }
      ]
    };

    const MAX_TENTATIVAS = 3;
    let ultimoErro = 'Falha desconhecida ao consultar a IA.';

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      let res;
      try {
        res = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'post', contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + key },
          payload: JSON.stringify(payload), muteHttpExceptions: true
        });
      } catch (e) {
        ultimoErro = 'Falha de conexão com a IA: ' + (e.message || e);
        Logger.log('[Diagnostico] tentativa ' + tentativa + ' erro de rede: ' + ultimoErro);
        Utilities.sleep(600 * tentativa);
        continue;
      }

      const code = res.getResponseCode();
      const body = res.getContentText();

      if (code === 200) {
        try {
          const data = JSON.parse(body);
          const texto = data.choices[0].message.content;
          const narrativa = JSON.parse(texto);
          return { ok: true, narrativa: narrativa, modelo: model };
        } catch (e) {
          ultimoErro = 'A IA retornou uma resposta em formato inesperado.';
          Logger.log('[Diagnostico] parse falhou (tentativa ' + tentativa + '): ' + (e.message || e));
          Utilities.sleep(500 * tentativa);
          continue;
        }
      }

      // Erros transitórios → retry; demais → aborta com mensagem amigável.
      ultimoErro = _groqErroAmigavel_(code, body, false);
      Logger.log('[Diagnostico] HTTP ' + code + ' (tentativa ' + tentativa + '): ' + ultimoErro);
      if (code === 429 || code >= 500) {
        Utilities.sleep(800 * tentativa);
        continue;
      }
      return { ok: false, erro: ultimoErro };
    }
    return { ok: false, erro: ultimoErro };
  }

  // ============================================================
  //  ORQUESTRAÇÃO
  // ============================================================

  /**
   * Gera o diagnóstico completo (métricas determinísticas + narrativa da IA).
   * @param {Object} payload
   * @returns {Object} diagnóstico completo
   * @throws {Error} se a IA falhar (mensagem amigável)
   */
  function gerarDiagnostico(payload) {
    const ctx = _buildContext(payload);
    const prompt = _buildPrompt(ctx);
    const ia = _callAI(prompt);

    if (!ia.ok) {
      throw new Error(ia.erro);
    }

    const n = ia.narrativa || {};
    return {
      versao: 4,
      geradoEm: new Date().toISOString(),
      modelo: ia.modelo,
      meta: ctx.meta,
      cards: ctx.cards,
      timeline: ctx.timeline,
      trechosCriticos: ctx.trechosCriticos,
      paradasCriticas: ctx.paradasCriticas,
      pontosIgnorados: ctx.pontosIgnorados,
      inconsistencias: ctx.inconsistencias,
      indicadores: ctx.indicadores,
      narrativa: {
        resumoExecutivo:        String(n.resumoExecutivo || '').trim(),
        diagnosticoGeral:       String(n.diagnosticoGeral || '').trim(),
        causasPrincipais:       Array.isArray(n.causasPrincipais) ? n.causasPrincipais : [],
        recuperacaoOperacional: String(n.recuperacaoOperacional || '').trim(),
        parecerFinal:           String(n.parecerFinal || '').trim()
      }
    };
  }

  // ============================================================
  //  HELPERS
  // ============================================================

  /** Extrai "HH:MM" de "YYYY-MM-DD HH:MM:SS" (ou string já em HH:MM). */
  function _hhmm(s) {
    const m = String(s || '').match(/(\d{1,2}):(\d{2})/);
    if (!m) return '';
    return ('0' + m[1]).slice(-2) + ':' + m[2];
  }

  /**
   * Diferença assinada em minutos entre "HH:MM" reais e programados.
   * Positivo = atrasado; negativo = adiantado. Trata virada de meia-noite.
   * (Mesma lógica de ReportService._diffMin.)
   */
  function _diffMin(realHHMM, schedHHMM) {
    if (!realHHMM || !schedHHMM) return null;
    const r = String(realHHMM).match(/(\d{1,2}):(\d{2})/);
    const s = String(schedHHMM).match(/(\d{1,2}):(\d{2})/);
    if (!r || !s) return null;
    const rMin = parseInt(r[1], 10) * 60 + parseInt(r[2], 10);
    const sMin = parseInt(s[1], 10) * 60 + parseInt(s[2], 10);
    let d = ((rMin - sMin) % 1440 + 1440) % 1440;
    if (d > 720) d -= 1440;
    return d;
  }

  /** Classifica criticidade por minutos perdidos (ou trecho lento). */
  function _criticidade(min, lento) {
    const v = Math.abs(min);
    if (v >= 30 || (lento && v >= 15)) return 'critica';
    if (v >= 15) return 'alta';
    if (v >= 5)  return 'media';
    return 'baixa';
  }

  /** "+18 min" / "−12 min" / "no horário". */
  function _fmtDelta(min) {
    if (min == null) return '—';
    const abs = Math.abs(Math.round(min));
    if (abs === 0) return 'no horário';
    const sign = min > 0 ? '+' : '−';
    if (abs < 60) return sign + abs + ' min';
    const hh = Math.floor(abs / 60), mm = abs % 60;
    return sign + hh + 'h' + (mm > 0 ? ('0' + mm).slice(-2) : '');
  }

  /** "1h47" / "32 min" a partir de minutos. */
  function _fmtMin(min) {
    const total = Math.round(Number(min) || 0);
    if (total < 60) return total + ' min';
    const hh = Math.floor(total / 60), mm = total % 60;
    return hh + 'h' + (mm > 0 ? ('0' + mm).slice(-2) : '');
  }

  /** "1h05" / "12min" a partir de segundos. */
  function _fmtDur(seg) {
    const total = Math.round((Number(seg) || 0) / 60);
    if (total < 60) return total + 'min';
    const hh = Math.floor(total / 60), mm = total % 60;
    return hh + 'h' + ('0' + mm).slice(-2);
  }

  // ============================================================
  //  DIVERGÊNCIA HORÁRIO COMERCIAL × PROPOSTA (fase de planejamento)
  //  Diferente do diagnóstico acima (que analisa uma viagem JÁ REALIZADA),
  //  esta função explica, ainda no editor de esquemas, por que o horário
  //  comercial informado diverge da proposta calculada pelo sistema
  //  (distância real + velocidade configurada por trecho). Reusa _callAI.
  // ============================================================

  /**
   * @param {{nomeLinha:string, indicadores:Object, trechos:Array}} payload
   *   trechos: [{ de, para, distKm, tvCalcMin, calcVel, comVel, legDelta, diffA, diffB, irreal }]
   *   diffA/diffB = defasagem ACUMULADA (comercial − calculado) já ao chegar em
   *   cada ponto; legDelta = quanto ESTE trecho por si só ganhou/perdeu de margem.
   * @returns {{ok:true, narrativa:Object, modelo:string}|{ok:false, erro:string}}
   */
  function explicarDivergenciaComercial(payload) {
    const prompt = _buildPromptDivergencia(payload || {});
    return _callAI(prompt);
  }

  function _buildPromptDivergencia(payload) {
    const system =
      'Você é um analista de planejamento operacional de uma empresa de transporte rodoviário interestadual no Brasil. ' +
      'O esquema ainda está em PLANEJAMENTO (não rodou) — você recebe a comparação entre o horário comercial informado ' +
      '(prazo que a empresa quer cumprir) e a proposta de horário calculada pelo sistema (baseada na distância real de ' +
      'cada trecho e na velocidade média configurada). Cada trecho traz DOIS números de defasagem: a "defasagem acumulada" ' +
      '(quanto o horário já está desalinhado ao chegar em cada ponto, somando todos os trechos anteriores) e a "variação ' +
      'de margem no trecho" (o quanto ESSE trecho específico, isoladamente, ganhou ou perdeu). ' +
      'Sua função é explicar, trecho a trecho, POR QUE existe divergência — distinguindo quando o problema nasce ' +
      'NAQUELE trecho (variação de margem grande) de quando ele é apenas herdado de trechos anteriores (defasagem ' +
      'acumulada grande mas variação de margem pequena) — e sugerir o que ajustar: a velocidade/tempo configurado no ' +
      'sistema, o tempo de parada, ou o próprio horário comercial. ' +
      'REGRAS: (1) NÃO invente números nem locais — use somente os fornecidos. (2) Seja específico por trecho, não genérico. ' +
      '(3) Se a defasagem acumulada for grande mas a variação de margem do trecho for pequena, deixe claro que a causa ' +
      'raiz está em trecho(s) anterior(es), não neste. (4) Português formal, direto, sem emojis. ' +
      '(5) Responda EXCLUSIVAMENTE com um JSON válido no formato: ' +
      '{"resumoExecutivo":"string (2-3 frases)","causasPrincipais":[{"trecho":"string","titulo":"string",' +
      '"descricao":"string","sugestao":"string","impacto":"alto|medio|baixo"}],"parecerFinal":"string"}. ' +
      'Sem texto fora do JSON.';

    const L = [];
    L.push('LINHA: ' + (payload.nomeLinha || '—'));
    const ind = payload.indicadores || {};
    L.push('RESUMO: ' + (ind.totalKm || 0) + ' km totais; nossa proposta soma ' + _fmtMin(ind.tempoCalcMin || 0) +
           (ind.diffFinalMin != null ? '; diferença acumulada no fim (comercial − calculado): ' + _fmtDelta(ind.diffFinalMin) : '') + '.');

    L.push('TRECHOS COM DIVERGÊNCIA (ordenados por impacto):');
    (payload.trechos || []).forEach(function (t) {
      L.push('  - ' + t.de + ' → ' + t.para + ': ' + t.distKm + ' km; nossa proposta ' +
             (t.calcVel != null ? Math.round(t.calcVel) + ' km/h' : 'n/d') + ' (' + _fmtMin(t.tvCalcMin || 0) + ')' +
             '; horário comercial exigiria ' + (t.comVel != null ? Math.round(t.comVel) + ' km/h' : 'n/d') +
             '; defasagem acumulada ao chegar: ' + _fmtDelta(t.diffB) +
             '; variação de margem NESTE trecho: ' + _fmtDelta(t.legDelta) +
             (t.irreal ? ' — velocidade exigida é FISICAMENTE IRREAL para um ônibus' : '') + '.');
    });
    return { system: system, user: L.join('\n') };
  }

  return { gerarDiagnostico: gerarDiagnostico, explicarDivergenciaComercial: explicarDivergenciaComercial };

})();
