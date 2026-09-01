// ============================================================
//  AnalysisService.gs  —  Motor de análise operacional
//  Responsabilidade: parse do CSV, matching de locais,
//  enriquecimento dos pontos, cálculo de velocidades e alertas
// ============================================================

var AnalysisService = (() => {

  // ── Limites de velocidade (km/h) — ajuste aqui sem alterar lógica ──
  const VEL_BAIXA_MAX   = 70;   // abaixo disso → Velocidade Baixa (atenção)
  const VEL_IDEAL_MIN   = 80;   // faixa ideal começa aqui
  const VEL_IDEAL_MAX   = 90;   // faixa ideal termina aqui
  const VEL_EXCESSO_MIN = 90;   // acima disso → Excesso (atenção)
  const VEL_CRITICO_MIN = 100;  // acima disso → Excesso Crítico

  // ── Tolerâncias para evitar falsos positivos ──────────────────
  const DIST_MIN_ALERTA_KM = 3;   // segmento mínimo para gerar alerta de velocidade
  const TEMPO_MIN_ALERTA_S = 90;  // tempo mínimo (1,5 min) para calcular velocidade

  // ── Detecção de contexto urbano (auto-justifica velocidade baixa) ──
  // Trechos curtos com acesso a garagem/terminal ou velocidade cadastrada
  // baixa são reduções operacionais normais (trânsito, semáforos, acesso),
  // NÃO inconsistências. Só se aplica a VELOCIDADE_BAIXA.
  const DIST_URBANO_TERMINAL_KM = 15; // trecho ≤ isso perto de terminal → urbano
  const DIST_URBANO_KM          = 12; // trecho ≤ isso + via lenta → urbano
  const DIST_URBANO_FRACO_KM    = 8;  // trecho muito curto → revisar (sinal fraco)
  const VEL_CADASTRO_URBANO     = 60; // vel. máx. cadastrada do local ≤ isso → via lenta

  // ── Paradas ──────────────────────────────────────────────────
  const LIMITE_PARADA_MINIMA_S  = 5 * 60; // ignora micromanobras / cercas curtas
  const LIMITE_PARADA_LONGA_MIN = 30;     // minutos
  const LIMITE_PARADA_TERMINAL  = 60;     // minutos (garagem/rodoviária)

  // Tempo de parada esperado para pontos fora da aba TEMPO_PERMANENCIA.
  // Mesmo padrão usado no editor de esquemas (STOP_PADRAO_MIN = 30).
  const STOP_PADRAO_MIN = 30;

  // ============================================================
  //  PARSE DO CSV
  // ============================================================

  /**
   * Faz o parse do texto CSV do relatório de viagem.
   * Detecta separador automaticamente (TAB ou ponto-e-vírgula ou vírgula).
   * Cruza com a base de locais e retorna array enriquecido.
   *
   * @param {string} csvText  — conteúdo bruto do arquivo
   * @returns {Array<Object>} enrichedTrip[]
   */
  function processReport(csvText) {
    if (!csvText || csvText.trim() === '') {
      throw new Error('Conteúdo do relatório está vazio.');
    }

    const locais = SheetsService.getLocais();
    const locaisMap = _buildLocaisMap(locais);

    // Tempo de permanência por código de local (aba TEMPO_PERMANENCIA).
    // { codigo: minutos } — quem não está na aba usa STOP_PADRAO_MIN (30).
    const temposPerm = SheetsService.getTemposPermanencia();

    const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const nonEmpty = lines.filter(l => l.trim() !== '');

    if (nonEmpty.length < 2) {
      throw new Error('Relatório não contém dados suficientes.');
    }

    const sep = _detectSeparator(nonEmpty[0]);

    // Usa parser CSV completo que respeita campos entre aspas
    const headerCols = _parseCSVLine(nonEmpty[0], sep);
    const header = headerCols.map(h => _normalize(h));

    // Mapeamento dos cabeçalhos esperados (case-insensitive, sem acentos)
    const idxMap = _buildHeaderIndex(header);

    const enriched = [];
    for (let i = 1; i < nonEmpty.length; i++) {
      // Parser correto: trata aspas, vírgulas dentro de campos, etc.
      const cols = _parseCSVLine(nonEmpty[i], sep);
      if (cols.length < 3) continue;

      const get = (key) => {
        const idx = idxMap[key];
        return idx !== undefined ? String(cols[idx] || '').trim() : '';
      };

      const pontoBruto   = get('ponto_controle');
      const entrada      = get('entrada');
      const saida        = get('saida');
      const paradaStr    = get('parada');
      const intervaloStr = get('intervalo');
      const veiculo      = get('veiculo');
      const funcionario  = get('funcionario');

      if (!entrada && !saida) continue; // linha sem dados úteis

      const parada_s    = TimeUtils.parseDuration(paradaStr);
      const intervalo_s = TimeUtils.parseDuration(intervaloStr);

      // Matching com a base de locais
      const localMatch = _matchLocal(pontoBruto, locaisMap);

      // Tempo de parada esperado: aba TEMPO_PERMANENCIA (por código) → fallback 30min.
      const codigoLocal = localMatch ? String(localMatch.codigo) : null;
      const tempoEsperadoMin = (codigoLocal != null && temposPerm[codigoLocal] !== undefined)
        ? temposPerm[codigoLocal]
        : STOP_PADRAO_MIN;

      enriched.push({
        seq:          i,
        veiculo:      veiculo,
        ponto:        pontoBruto,
        entrada:      entrada,
        saida:        saida,
        parada_s:     parada_s,
        intervalo_s:  intervalo_s,
        funcionario:  funcionario,
        // dados do local (null se não encontrado)
        lat:          localMatch ? localMatch.lat          : null,
        lng:          localMatch ? localMatch.lng          : null,
        tipo:         localMatch ? localMatch.tipo         : 'Desconhecido',
        vel_max:      localMatch ? localMatch.vel          : 0,
        raio:         localMatch ? localMatch.raio         : 0,
        pedagio:      localMatch ? localMatch.pedagio      : false,
        rodoviaria:   localMatch ? localMatch.rodoviaria   : false,
        garagem:      localMatch ? localMatch.garagem      : false,
        codigo:       localMatch ? localMatch.codigo       : null,
        tempoEsperadoMin: tempoEsperadoMin,
        matched:      localMatch !== null
      });
    }

    if (enriched.length === 0) {
      throw new Error('Nenhum ponto válido encontrado no relatório.');
    }

    // O CSV vem ordenado por duração de parada (maior primeiro), não por hora.
    // Ordena cronologicamente por 'entrada' para que polyline e cálculos
    // de distância/velocidade reflitam a sequência real da viagem.
    enriched.sort((a, b) => {
      if (!a.entrada) return  1;
      if (!b.entrada) return -1;
      // Strings ISO "YYYY-MM-DD HH:MM:SS" ordenam lexicograficamente = cronologicamente
      return a.entrada < b.entrada ? -1 : a.entrada > b.entrada ? 1 : 0;
    });

    const cleaned = _compactTrip(enriched);

    // Reatribui seq após limpeza cronológica
    cleaned.forEach((p, i) => { p.seq = i + 1; });

    return cleaned;
  }

  // ============================================================
  //  ANÁLISE DE VIAGEM
  // ============================================================

  /**
   * Recebe o array enriquecido e retorna análise completa:
   * segmentos (distância + velocidade), alertas e resumo.
   *
   * @param {Array<Object>} enrichedTrip
   * @returns {{ segments: Array, alerts: Array, summary: Object }}
   */
  function analyzeTrip(enrichedTrip) {
    if (!enrichedTrip || enrichedTrip.length === 0) {
      return { segments: [], alerts: [], summary: {} };
    }

    const segments = [];
    const alerts   = [];

    // --- Calcula segmentos entre pontos consecutivos ---
    for (let i = 0; i < enrichedTrip.length - 1; i++) {
      const A = enrichedTrip[i];
      const B = enrichedTrip[i + 1];

      let distKm = null;
      let tempoMin = null;
      let velocidadeKmh = null;
      const segAlertas = [];

      // Distância (só calcula se ambos têm coordenadas)
      if (A.lat && A.lng && B.lat && B.lng) {
        distKm = GeoUtils.haversineKm(A.lat, A.lng, B.lat, B.lng);
      }

      // Tempo de deslocamento = saída de A até entrada em B
      if (A.saida && B.entrada) {
        const diffS = TimeUtils.diffSeconds(A.saida, B.entrada);
        if (diffS !== null && diffS > 0) {
          tempoMin = TimeUtils.toMinutes(diffS);
        }
      }

      // Velocidade
      if (distKm !== null && tempoMin !== null && tempoMin > 0) {
        velocidadeKmh = Math.round((distKm / (tempoMin / 60)) * 10) / 10;
      }

      // --- Alertas de velocidade por trecho ---
      // Só avalia se dados são confiáveis: dist e tempo acima das tolerâncias mínimas
      const tempoS = tempoMin !== null ? Math.round(tempoMin * 60) : 0;
      const segmentoValido = (
        velocidadeKmh !== null &&
        distKm !== null &&
        distKm >= DIST_MIN_ALERTA_KM &&
        tempoS >= TEMPO_MIN_ALERTA_S
      );

      if (segmentoValido) {
        const tempoLabel = Math.round(tempoMin) + ' min';
        const distLabel  = distKm.toFixed(1) + ' km';
        const velLabel   = velocidadeKmh + ' km/h';
        const trechoBase = `"${A.ponto}" → "${B.ponto}" (${distLabel} em ${tempoLabel}, vel. média ${velLabel})`;

        if (velocidadeKmh > VEL_CRITICO_MIN) {
          segAlertas.push({
            tipo:    'VELOCIDADE_EXCESSIVA',
            descricao: `Excesso crítico de velocidade no trecho ${trechoBase}. Faixa ideal: ${VEL_IDEAL_MIN}–${VEL_IDEAL_MAX} km/h.`,
            nivel:   'critico',
            trecho:  `${A.ponto} → ${B.ponto}`,
            distKm:  distKm,
            tempoMin: Math.round(tempoMin),
            velocidadeKmh: velocidadeKmh,
            classificacao: 'EXCESSO_CRITICO'
          });
        } else if (velocidadeKmh > VEL_EXCESSO_MIN) {
          segAlertas.push({
            tipo:    'VELOCIDADE_ALTA',
            descricao: `Excesso de velocidade no trecho ${trechoBase}. Faixa ideal: ${VEL_IDEAL_MIN}–${VEL_IDEAL_MAX} km/h.`,
            nivel:   'atencao',
            trecho:  `${A.ponto} → ${B.ponto}`,
            distKm:  distKm,
            tempoMin: Math.round(tempoMin),
            velocidadeKmh: velocidadeKmh,
            classificacao: 'EXCESSO'
          });
        } else if (velocidadeKmh < VEL_BAIXA_MAX) {
          segAlertas.push({
            tipo:    'VELOCIDADE_BAIXA',
            descricao: `Velocidade abaixo do ideal no trecho ${trechoBase}. Faixa ideal: ${VEL_IDEAL_MIN}–${VEL_IDEAL_MAX} km/h.`,
            nivel:   'atencao',
            trecho:  `${A.ponto} → ${B.ponto}`,
            distKm:  distKm,
            tempoMin: Math.round(tempoMin),
            velocidadeKmh: velocidadeKmh,
            classificacao: 'BAIXA'
          });
        }
        // VEL_BAIXA_MAX ≤ vel ≤ VEL_EXCESSO_MIN → faixa ideal, sem alerta

        // Classifica severidade + contexto + diagnóstico (auto-justifica urbano)
        segAlertas.forEach(function (a) { _classificarSegAlerta(a, A, B); });
      }

      segments.push({
        seq:          i + 1,
        de:           A.ponto,
        para:         B.ponto,
        de_seq:       A.seq,
        para_seq:     B.seq,
        distKm:       distKm,
        tempoMin:     tempoMin,
        velocidadeKmh: velocidadeKmh,
        // Extremos do trecho são parada válida (>= 5min ou rodoviária/garagem)?
        // Consumido pelo gráfico "Eventos de Velocidade por Trecho" e por
        // _extrairEventos / _buildTrechos para ignorar trechos cujo extremo
        // foi só passagem (< 5min), não parada real.
        deParadaValida:   _isParadaValida(A),
        paraParadaValida: _isParadaValida(B),
        alertas:      segAlertas
      });

      segAlertas.forEach(a => {
        // Preserva campos contextuais já preenchidos no alerta (trecho, distKm, etc.)
        alerts.push({ seq: i + 1, trecho: `${A.ponto} → ${B.ponto}`, ...a });
      });
    }

    // --- Alertas por ponto individual ---
    let totalExcessoMin = 0;
    let qtdParadasExcesso = 0;
    enrichedTrip.forEach((pt, idx) => {
      // Local não identificado
      if (!pt.matched) {
        alerts.push(_classificarPtAlerta({
          tipo: 'LOCAL_NAO_IDENTIFICADO',
          descricao: `Ponto "${pt.ponto}" não encontrado na base de locais`,
          nivel: 'info',
          severidade: 'revisar',
          seq: pt.seq,
          trecho: pt.ponto,
          diagnostico: `O ponto "${pt.ponto}" não foi encontrado na base de locais. Sem coordenadas, distância e velocidade do trecho não podem ser validadas — recomenda-se cadastrar o local.`
        }, pt));
      }

      // Parada em local proibido (tipo 42 — aceita "42", "Local Não Autorizado - 42", etc.)
      const _isTipo42 = (t) => { const s = String(t || '').trim(); if (/\b42\b/.test(s)) return true; return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').includes('nao autorizado'); };
      // carve-out Fix 4: qualquer parada em ponto proibido conta (não usa a regra dos 5min)
      if (pt.matched && _isTipo42(pt.tipo) && pt.parada_s > 0) {
        pt.proibido42 = true;
        alerts.push(_classificarPtAlerta({
          tipo: 'PARADA_PROIBIDA',
          descricao: `Parada de ${TimeUtils.formatDuration(pt.parada_s)} em local proibido: "${pt.ponto}"`,
          nivel: 'critico',
          severidade: 'critico',
          seq: pt.seq,
          trecho: pt.ponto,
          diagnostico: `Parada de ${TimeUtils.formatDuration(pt.parada_s)} registrada em local não autorizado ("${pt.ponto}"). Configura inconsistência operacional crítica que deve ser tratada como ocorrência.`
        }, pt));
      }

      // Parada longa — só avalia excesso sobre paradas válidas (>= 5min ou rodoviária/garagem)
      if (_isParadaValida(pt) && pt.parada_s > 0) {
        const paradaMin = TimeUtils.toMinutes(pt.parada_s);
        // Limite = aba TEMPO_PERMANENCIA (por código) → fallback 30min.
        const limiteMin = (pt.tempoEsperadoMin != null) ? pt.tempoEsperadoMin : STOP_PADRAO_MIN;
        const TOLERANCIA_MIN = 5;

        if (paradaMin > limiteMin + TOLERANCIA_MIN) {
          const excedente = Math.round(paradaMin - limiteMin);
          totalExcessoMin += excedente;
          qtdParadasExcesso += 1;
          alerts.push(_classificarPtAlerta({
            tipo: 'PARADA_LONGA',
            descricao: `Parada de ${TimeUtils.formatDuration(pt.parada_s)} em "${pt.ponto}" (limite: ${limiteMin}min)`,
            nivel: paradaMin > limiteMin * 2 ? 'critico' : 'atencao',
            severidade: paradaMin > limiteMin * 2 ? 'critico' : 'atencao',
            seq: pt.seq,
            trecho: pt.ponto,
            diagnostico: `Permanência de ${TimeUtils.formatDuration(pt.parada_s)} em "${pt.ponto}", ${excedente} min acima do limite de ${limiteMin} min. `
              + (paradaMin > limiteMin * 2
                  ? 'Excesso expressivo — forte indício de parada não prevista.'
                  : 'Excesso moderado — vale revisar o motivo da permanência.')
          }, pt));
        }
      }
    });

    // --- Resumo ---
    const totalKm = segments.reduce((acc, s) => acc + (s.distKm || 0), 0);
    const tempoTotal = segments.reduce((acc, s) => acc + (s.tempoMin || 0), 0);
    const veloMedia = tempoTotal > 0
      ? Math.round((totalKm / (tempoTotal / 60)) * 10) / 10
      : 0;

    // Ponto onde o veículo permaneceu por mais tempo (só paradas válidas)
    const ptMaiorParada = enrichedTrip.reduce(function(best, pt) {
      if (!_isParadaValida(pt)) return best;
      return (pt.parada_s || 0) > ((best && best.parada_s) || 0) ? pt : best;
    }, null);
    const maiorParada = (ptMaiorParada && ptMaiorParada.parada_s > 0)
      ? { ponto: ptMaiorParada.ponto, duracaoStr: TimeUtils.formatDuration(ptMaiorParada.parada_s) }
      : null;

    const primeiroMotorista = enrichedTrip.find(p => p.funcionario && p.funcionario !== 'Não Informado');
    const motorista = primeiroMotorista
      ? primeiroMotorista.funcionario
      : (enrichedTrip[0] ? enrichedTrip[0].funcionario : 'Não Informado');

    const summary = {
      veiculo:         enrichedTrip[0] ? enrichedTrip[0].veiculo : '—',
      motorista:       motorista || 'Não Informado',
      dataViagem:      enrichedTrip[0] ? TimeUtils.extractDate(enrichedTrip[0].entrada) : '—',
      dataFim:         enrichedTrip[enrichedTrip.length - 1]
                         ? TimeUtils.extractDate(enrichedTrip[enrichedTrip.length - 1].saida)
                         : '—',
      totalPontos:     enrichedTrip.length,
      totalKm:         Math.round(totalKm * 100) / 100,
      tempoTotalMin:   Math.round(tempoTotal),
      velocidadeMedia: veloMedia,
      maiorParada:     maiorParada,
      totalExcessoMin: totalExcessoMin,
      qtdParadasExcesso: qtdParadasExcesso,
      totalAlertas:    alerts.length,
      alertasCriticos: alerts.filter(a => a.severidade === 'critico' || a.nivel === 'critico').length,
      alertasJustificados: alerts.filter(a => a.autoJustificado || a.severidade === 'justificado').length,
      alertasPendentes:    alerts.filter(a => !(a.autoJustificado || a.severidade === 'justificado')).length,
      pontosNaoId:     enrichedTrip.filter(p => !p.matched).length
    };

    return { segments, alerts, summary };
  }

  // ============================================================
  //  CLASSIFICAÇÃO CONTEXTUAL DE ALERTAS
  // ============================================================

  /**
   * Detecta o contexto operacional de um trecho A→B para decidir se uma
   * velocidade baixa é justificável (via urbana / acesso a garagem /
   * saída-chegada de terminal) em vez de inconsistência.
   * @returns {{contexto:string, label:(string|null), categoria:(string|null)}}
   */
  function _detectarContexto(A, B, distKm) {
    const nomeA = String((A && A.ponto) || '').toUpperCase();
    const nomeB = String((B && B.ponto) || '').toUpperCase();
    const reTerminal = /TERMINAL|RODOVIARIA|RODOVIÁRIA/;

    const garagem  = (A && A.garagem) || (B && B.garagem) || /GARAGEM/.test(nomeA) || /GARAGEM/.test(nomeB);
    const terminal = (A && A.rodoviaria) || (B && B.rodoviaria) || reTerminal.test(nomeA) || reTerminal.test(nomeB);
    const velLenta = ((A && A.vel_max > 0 && A.vel_max <= VEL_CADASTRO_URBANO)) ||
                     ((B && B.vel_max > 0 && B.vel_max <= VEL_CADASTRO_URBANO));

    if (garagem) {
      return { contexto: 'garagem', label: 'Acesso à garagem', categoria: 'Acesso à garagem' };
    }
    if (terminal && distKm != null && distKm <= DIST_URBANO_TERMINAL_KM) {
      return { contexto: 'terminal', label: 'Saída/chegada de terminal', categoria: 'Condição operacional prevista' };
    }
    if (distKm != null && distKm <= DIST_URBANO_KM && (velLenta || terminal)) {
      return { contexto: 'urbano', label: 'Área urbana', categoria: 'Via urbana' };
    }
    if (distKm != null && distKm <= DIST_URBANO_FRACO_KM) {
      // Sinal fraco: trecho curto, mas sem flag urbano/terminal — só revisar.
      return { contexto: 'urbano_fraco', label: 'Trecho curto', categoria: null };
    }
    return { contexto: 'rodovia', label: null, categoria: null };
  }

  /**
   * Enriquece um alerta de segmento (velocidade) com severidade, contexto,
   * diagnóstico determinístico e — quando o contexto é justificável —
   * auto-justificativa. Muta e retorna o próprio alerta.
   */
  function _classificarSegAlerta(a, A, B) {
    a.velEsperadaMin = VEL_IDEAL_MIN;
    a.velEsperadaMax = VEL_IDEAL_MAX;
    a.alertKey = a.tipo + '|' + (a.trecho || ((A && A.ponto) + ' → ' + (B && B.ponto)));

    const ctx = _detectarContexto(A, B, a.distKm);
    a.contexto      = ctx.contexto;
    a.contextoLabel = ctx.label;

    if (a.tipo === 'VELOCIDADE_EXCESSIVA') {
      a.severidade = 'critico';
    } else if (a.tipo === 'VELOCIDADE_ALTA') {
      a.severidade = 'atencao';
    } else if (a.tipo === 'VELOCIDADE_BAIXA') {
      if (ctx.categoria) {
        // Contexto justificável → nasce Justificado (reversível pelo usuário).
        a.severidade     = 'justificado';
        a.autoJustificado = true;
        a.justificativa  = { categoria: ctx.categoria, motivo: ctx.label, observacao: '', auto: true };
      } else if (ctx.contexto === 'urbano_fraco') {
        a.severidade = 'revisar';
      } else {
        a.severidade = 'atencao';
      }
    } else {
      a.severidade = a.severidade || (a.nivel === 'critico' ? 'critico' : 'atencao');
    }

    a.diagnostico = _diagnosticoTexto(a);
    return a;
  }

  /**
   * Enriquece um alerta por-ponto (parada / local) com chave e diagnóstico.
   * Severidade já é passada pelo chamador. Muta e retorna o alerta.
   */
  function _classificarPtAlerta(a, pt) {
    a.alertKey = a.tipo + '|' + (a.trecho || (pt && pt.ponto) || '') + '|' + (a.seq != null ? a.seq : '');
    a.contexto = a.contexto || 'ponto';
    if (!a.severidade) a.severidade = a.nivel === 'critico' ? 'critico' : 'atencao';
    return a;
  }

  /**
   * Texto de diagnóstico em linguagem natural (determinístico), montado a
   * partir do tipo do alerta + contexto + números. Reutilizável no relatório.
   */
  function _diagnosticoTexto(a) {
    const vel = a.velocidadeKmh;
    const min = a.velEsperadaMin || VEL_IDEAL_MIN;
    const max = a.velEsperadaMax || VEL_IDEAL_MAX;

    switch (a.tipo) {
      case 'VELOCIDADE_BAIXA':
        if (a.autoJustificado) {
          return 'Velocidade média de ' + vel + ' km/h, inferior à faixa esperada (' + min + '–' + max + ' km/h). '
               + 'Entretanto, o trecho ocorre em ' + String(a.contextoLabel || 'via de fluxo reduzido').toLowerCase()
               + ', onde a redução é comportamento operacional normal (trânsito, semáforos, cruzamentos, acesso). '
               + 'Sem indício de inconsistência.';
        }
        if (a.severidade === 'revisar') {
          return 'Velocidade média de ' + vel + ' km/h abaixo do esperado (' + min + '–' + max + ' km/h) em trecho curto. '
               + 'Pode ser condição de via local — recomenda-se revisar antes de considerar inconsistência.';
        }
        return 'Velocidade média de ' + vel + ' km/h em trecho de rodovia de fluxo livre (esperado ' + min + '–' + max + ' km/h). '
             + 'Tempo excessivo para a distância percorrida — forte indício de inconsistência operacional.';
      case 'VELOCIDADE_ALTA':
        return 'Velocidade média de ' + vel + ' km/h acima da faixa segura (' + min + '–' + max + ' km/h). '
             + 'Risco operacional — requer atenção.';
      case 'VELOCIDADE_EXCESSIVA':
        return 'Excesso crítico: ' + vel + ' km/h, muito acima da faixa segura (' + min + '–' + max + ' km/h). '
             + 'Risco elevado que deve ser tratado como ocorrência.';
      default:
        return a.diagnostico || a.descricao || '';
    }
  }

  // ============================================================
  //  HELPERS PRIVADOS
  // ============================================================

  /**
   * Constrói mapa { chave_normalizada: localObj } para busca rápida.
   */
  function _buildLocaisMap(locais) {
    const map = {};
    locais.forEach(l => {
      const k1 = _normalize(l.descResumida);
      const k2 = _normalize(l.descricao);
      const k3 = _normalize(l.codigo);
      if (k1) map[k1] = l;
      if (k2 && !map[k2]) map[k2] = l;
      if (k3 && !map[k3]) map[k3] = l;
    });
    return map;
  }

  /**
   * Tenta encontrar o local pelo nome do ponto no relatório.
   * 1º: match exato normalizado
   * 2º: match parcial (ponto contém descResumida ou vice-versa)
   * Retorna o objeto local ou null.
   */
  function _matchLocal(pontoBruto, locaisMap) {
    if (!pontoBruto) return null;

    // Candidatos, em ordem de preferência:
    //  1) nome completo normalizado
    //  2) trecho antes da primeira "/" — o CSV costuma vir "PONTO / CIDADE - UF"
    //     e a parte após a "/" às vezes chega truncada (ex.: "... / SANTA CRUZ DE GOI...")
    const candidates = [_normalize(pontoBruto)];
    const slash = String(pontoBruto).indexOf('/');
    if (slash > 0) {
      const pre = _normalize(String(pontoBruto).slice(0, slash));
      if (pre && candidates.indexOf(pre) === -1) candidates.push(pre);
    }

    // Match exato de qualquer candidato
    for (let c = 0; c < candidates.length; c++) {
      if (candidates[c] && locaisMap[candidates[c]]) return locaisMap[candidates[c]];
    }

    // Match parcial — para cada candidato, escolhe a chave que casa por substring
    // (qualquer direção) com o MAIOR comprimento (não a 1ª da ordem de inserção,
    // que podia devolver um local não relacionado). Nome completo antes do pré-"/".
    const keys = Object.keys(locaisMap);
    for (let c = 0; c < candidates.length; c++) {
      const key = candidates[c];
      if (!key) continue;
      let best = null, bestLen = 0;
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (k.length > 4 && k.length > bestLen && (key.indexOf(k) !== -1 || k.indexOf(key) !== -1)) {
          best = locaisMap[k];
          bestLen = k.length;
        }
      }
      if (best) return best;
    }

    return null;
  }

  function _normalize(str) {
    if (!str) return '';
    return str.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
      .replace(/[\s.…]+$/g, '')  // pontuação/reticências finais: "... goi..." → "... goi"
      .replace(/\s+/g, ' ')
      .trim();
  }

  function _detectSeparator(line) {
    // Conta ocorrências fora de aspas para cada separador candidato
    const countOutsideQuotes = (str, ch) => {
      let count = 0;
      let inQ = false;
      for (let i = 0; i < str.length; i++) {
        if (str[i] === '"') inQ = !inQ;
        else if (str[i] === ch && !inQ) count++;
      }
      return count;
    };
    if (countOutsideQuotes(line, '\t') > 0) return '\t';
    if (countOutsideQuotes(line, ';')  > 0) return ';';
    return ',';
  }

  /**
   * Parser CSV completo que respeita campos entre aspas duplas.
   * Trata vírgulas dentro de campos, aspas escapadas ("") e
   * remove as aspas externas do valor.
   *
   * @param {string} line   — linha CSV bruta
   * @param {string} sep    — separador detectado (',' | ';' | '\t')
   * @returns {string[]}    — array de valores limpos (sem aspas externas)
   */
  function _parseCSVLine(line, sep) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          // Aspa escapada: "" → "
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === sep && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim()); // último campo
    return fields;
  }

  function _buildHeaderIndex(headerArr) {
    // Aliases já normalizados (sem acentos, lowercase)
    // O header também foi normalizado antes de chegar aqui
    const aliases = {
      'ponto_controle': ['ponto de controle', 'ponto controle', 'ponto', 'local'],
      'entrada':        ['entrada', 'data entrada', 'dt entrada'],
      'saida':          ['saida', 'data saida', 'dt saida'],
      'parada':         ['parada', 'tempo parada', 'duracao parada'],
      'intervalo':      ['intervalo', 'tempo intervalo'],
      'veiculo':        ['veiculo', 'frota', 'bus', 'onibus'],
      'funcionario':    ['funcionario', 'motorista', 'condutor', 'colaborador']
    };

    const idx = {};
    Object.entries(aliases).forEach(([key, variants]) => {
      variants.forEach(v => {
        const found = headerArr.indexOf(v);
        if (found !== -1 && idx[key] === undefined) {
          idx[key] = found;
        }
      });
    });

    // Fallback por posição para o relatório padrão NAT x SPO
    // Unid.Emp(0), Veículo(1), Ponto(2), Entrada(3), Saída(4), Parada(5), Intervalo(6), Funcionário(7)
    if (idx['veiculo']        === undefined) idx['veiculo']        = 1;
    if (idx['ponto_controle'] === undefined) idx['ponto_controle'] = 2;
    if (idx['entrada']        === undefined) idx['entrada']        = 3;
    if (idx['saida']          === undefined) idx['saida']          = 4;
    if (idx['parada']         === undefined) idx['parada']         = 5;
    if (idx['intervalo']      === undefined) idx['intervalo']      = 6;
    if (idx['funcionario']    === undefined) idx['funcionario']    = 7;

    return idx;
  }

  /**
   * Remove pontos muito curtos e consolida permanências consecutivas no mesmo local.
   * Isso evita rotas artificiais A -> A geradas por manobras dentro da mesma cerca.
   *
   * Regras:
   * 1. ignora paradas abaixo de 5 minutos
   * 2. se dois pontos consecutivos representam o mesmo local, soma a parada e mantém
   *    a janela total de entrada/saída
   */
  function _compactTrip(points) {
    const valid = (points || []).filter(pt => !!pt);
    if (valid.length === 0) return [];

    // 1) Compacta permanências consecutivas no MESMO local operacional.
    //    A compactação vem ANTES do filtro de paradas curtas — caso contrário
    //    re-entradas curtas do mesmo ponto (manobras / novas passagens pela
    //    cerca) seriam descartadas e truncariam a saída real do ponto.
    //    Ex.: rodoviária visitada às 16:23→16:30, 16:31, 16:32 e 17:41 → a saída
    //    correta do ponto é 17:41 (a última), não 16:30 (a primeira).
    const merged = [];
    valid.forEach(pt => {
      const prev = merged[merged.length - 1];
      if (prev && _isSameOperationalPoint(prev, pt)) {
        prev._compactado = true;
        prev.intervalo_s = Math.max(prev.intervalo_s || 0, pt.intervalo_s || 0);

        if (!prev.entrada || (pt.entrada && pt.entrada < prev.entrada)) {
          prev.entrada = pt.entrada;
        }
        if (!prev.saida || (pt.saida && pt.saida > prev.saida)) {
          prev.saida = pt.saida;
        }
        if ((!prev.funcionario || prev.funcionario === 'Não Informado') && pt.funcionario) {
          prev.funcionario = pt.funcionario;
        }
        if ((!prev.veiculo || prev.veiculo === '—') && pt.veiculo) {
          prev.veiculo = pt.veiculo;
        }
        return;
      }
      merged.push({ ...pt });
    });

    // 2) Para pontos compactados, a permanência (parada_s) passa a ser a JANELA
    //    real no local (primeira entrada → última saída). Pontos de visita única
    //    ficam inalterados (parada_s = saída − entrada já por definição).
    merged.forEach(pt => {
      if (pt._compactado && pt.entrada && pt.saida) {
        const janela = TimeUtils.diffSeconds(pt.entrada, pt.saida);
        if (janela !== null && janela >= 0) pt.parada_s = janela;
      }
      delete pt._compactado;
    });

    // 3) Remove paradas muito curtas (micro-manobras / cercas curtas) —
    //    exceto o ÚLTIMO ponto da viagem (diz a que horas ela realmente
    //    terminou), o último ponto NÃO-garagem (o destino comercial final
    //    do itinerário, que costuma ser seguido de uma parada na garagem)
    //    e qualquer ponto RODOVIÁRIA/GARAGEM cadastrado — esses são paradas
    //    de itinerário oficiais, não ruído de GPS, e devem aparecer mesmo
    //    quando a passagem foi rápida (ex.: rodoviária visitada em <5min).
    //    Sem essas exceções, um veículo que só passa rápido pelo destino
    //    final antes de seguir pra garagem, ou por uma rodoviária do
    //    roteiro, faz esse ponto sumir da viagem inteira e aparecer como
    //    "não visitado" — mesmo tendo sido realizado.
    const ultimoIdx = merged.length - 1;
    let ultimoNaoGaragemIdx = -1;
    for (let i = merged.length - 1; i >= 0; i--) {
      if (!merged[i].garagem) { ultimoNaoGaragemIdx = i; break; }
    }
    const cleaned = merged.filter((pt, idx) => {
      if (idx === ultimoIdx || idx === ultimoNaoGaragemIdx) return true;
      if (!pt.parada_s || pt.parada_s <= 0) return true;
      return _isParadaValida(pt); // >= 5min OU rodoviária/garagem
    });

    return cleaned.length ? cleaned : merged;
  }

  /**
   * Regra única de "parada válida" — permanência mínima de 5 min OU ponto de
   * itinerário oficial (rodoviária/garagem, que contam mesmo em passagem
   * rápida). Fonte da verdade no servidor; espelhada no cliente
   * (analysis.html / app.html). Usada por _compactTrip, geração de eventos de
   * velocidade por trecho, cálculo de paradas/excessos e inconsistências.
   * NÃO se aplica a PARADA_PROIBIDA (tipo 42): lá qualquer parada é violação.
   */
  function _isParadaValida(pt) {
    if (!pt) return false;
    return (Number(pt.parada_s) || 0) >= LIMITE_PARADA_MINIMA_S || !!pt.rodoviaria || !!pt.garagem;
  }

  function _isSameOperationalPoint(a, b) {
    if (!a || !b) return false;

    const keyA = _normalize(a.ponto);
    const keyB = _normalize(b.ponto);
    if (keyA && keyB && keyA === keyB) return true;

    if (a.matched && b.matched) {
      if (a.codigo && b.codigo && String(a.codigo) === String(b.codigo)) return true;

      if (
        a.lat != null && a.lng != null &&
        b.lat != null && b.lng != null &&
        Number(a.lat) === Number(b.lat) &&
        Number(a.lng) === Number(b.lng)
      ) {
        return true;
      }
    }

    return false;
  }

  return { processReport, analyzeTrip, isParadaValida: _isParadaValida, LIMITE_PARADA_MINIMA_S: LIMITE_PARADA_MINIMA_S };
})();
