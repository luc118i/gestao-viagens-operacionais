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

  // ── Paradas ──────────────────────────────────────────────────
  const LIMITE_PARADA_MINIMA_S  = 5 * 60; // ignora micromanobras / cercas curtas
  const LIMITE_PARADA_LONGA_MIN = 30;     // minutos
  const LIMITE_PARADA_TERMINAL  = 60;     // minutos (garagem/rodoviária)

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
        alertas:      segAlertas
      });

      segAlertas.forEach(a => {
        // Preserva campos contextuais já preenchidos no alerta (trecho, distKm, etc.)
        alerts.push({ seq: i + 1, trecho: `${A.ponto} → ${B.ponto}`, ...a });
      });
    }

    // --- Alertas por ponto individual ---
    enrichedTrip.forEach((pt, idx) => {
      // Local não identificado
      if (!pt.matched) {
        alerts.push({
          tipo: 'LOCAL_NAO_IDENTIFICADO',
          descricao: `Ponto "${pt.ponto}" não encontrado na base de locais`,
          nivel: 'info',
          seq: pt.seq,
          trecho: pt.ponto
        });
      }

      // Parada em local proibido (tipo 42)
      if (pt.matched && String(pt.tipo || '').trim() === '42' && pt.parada_s > 0) {
        alerts.push({
          tipo: 'PARADA_PROIBIDA',
          descricao: `Parada de ${TimeUtils.formatDuration(pt.parada_s)} em local proibido: "${pt.ponto}"`,
          nivel: 'critico',
          seq: pt.seq,
          trecho: pt.ponto
        });
      }

      // Parada longa
      if (pt.parada_s > 0) {
        const paradaMin = TimeUtils.toMinutes(pt.parada_s);
        const nomePt = String(pt.ponto || '').toUpperCase();
        const limiteMin = /RODOVI[AÁ]RIA|RODOVIARIA/.test(nomePt) ? 15
          : /GARAGEM/.test(nomePt) ? 20
          : 40; // padrão: controles e outros pontos operacionais
        const TOLERANCIA_MIN = 5;

        if (paradaMin > limiteMin + TOLERANCIA_MIN) {
          alerts.push({
            tipo: 'PARADA_LONGA',
            descricao: `Parada de ${TimeUtils.formatDuration(pt.parada_s)} em "${pt.ponto}" (limite: ${limiteMin}min)`,
            nivel: paradaMin > limiteMin * 2 ? 'critico' : 'atencao',
            seq: pt.seq,
            trecho: pt.ponto
          });
        }
      }
    });

    // --- Resumo ---
    const totalKm = segments.reduce((acc, s) => acc + (s.distKm || 0), 0);
    const tempoTotal = segments.reduce((acc, s) => acc + (s.tempoMin || 0), 0);
    const veloMedia = tempoTotal > 0
      ? Math.round((totalKm / (tempoTotal / 60)) * 10) / 10
      : 0;

    // Ponto onde o veículo permaneceu por mais tempo
    const ptMaiorParada = enrichedTrip.reduce(function(best, pt) {
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
      totalAlertas:    alerts.length,
      alertasCriticos: alerts.filter(a => a.nivel === 'critico').length,
      pontosNaoId:     enrichedTrip.filter(p => !p.matched).length
    };

    return { segments, alerts, summary };
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
    const key = _normalize(pontoBruto);

    // Match exato
    if (locaisMap[key]) return locaisMap[key];

    // Match parcial — procura no mapa por chave que está contida no ponto
    const keys = Object.keys(locaisMap);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.length > 4 && (key.includes(k) || k.includes(key))) {
        return locaisMap[k];
      }
    }

    return null;
  }

  function _normalize(str) {
    if (!str) return '';
    return str.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
      .replace(/\s+/g, ' ');
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
    const filtered = points.filter(pt => {
      if (!pt) return false;
      if (!pt.parada_s || pt.parada_s <= 0) return true;
      return pt.parada_s >= LIMITE_PARADA_MINIMA_S;
    });

    if (filtered.length <= 1) return filtered;

    const compacted = [];

    filtered.forEach(pt => {
      const prev = compacted[compacted.length - 1];
      if (!prev) {
        compacted.push({ ...pt });
        return;
      }

      if (_isSameOperationalPoint(prev, pt)) {
        prev.parada_s = (prev.parada_s || 0) + (pt.parada_s || 0);
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

      compacted.push({ ...pt });
    });

    return compacted;
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

  return { processReport, analyzeTrip };
})();
