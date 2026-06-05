// ============================================================
//  ComparisonService.gs  —  Comparação planejado vs realizado
//  Responsabilidade: cruzar pontos do esquema com pontos realizados,
//  identificar não visitados e extrair trechos específicos
// ============================================================

var ComparisonService = (() => {

  // ============================================================
  //  FUNÇÕES PÚBLICAS
  // ============================================================

  /**
   * Compara os pontos do esquema (planejado) com a viagem realizada.
   * Matching por id_ponto === ponto.codigo nos pontos realizados.
   *
   * @param {Array<{id_esquema, ordem, id_ponto, nome_ponto}>} esquemaPontos
   * @param {Array<Object>} enrichedTrip  — array de pontos realizados (com campo .codigo)
   * @returns {Array<{
   *   id_esquema:       string,
   *   ordem:            number,
   *   id_ponto:         string,
   *   nome_ponto:       string,
   *   visitado:         boolean,
   *   ponto_realizado:  Object|null,
   *   status:           string
   * }>}
   */
  function compararRota(esquemaPontos, enrichedTrip) {
    if (!esquemaPontos || !esquemaPontos.length) return [];
    if (!enrichedTrip  || !enrichedTrip.length)  {
      // Todos não visitados
      return esquemaPontos.map(function(ep) {
        return {
          id_esquema:        ep.id_esquema,
          ordem:             ep.ordem,
          id_ponto:          ep.id_ponto,
          nome_ponto:        ep.nome_ponto,
          horario_comercial: ep.horario_comercial || '',
          tempo_local:       ep.tempo_local || '',
          visitado:          false,
          ponto_realizado:   null,
          status:            'Não visitado'
        };
      });
    }

    // Constrói mapa id_ponto → ponto_realizado (só pontos com match e codigo)
    var realizadosMap = {};
    enrichedTrip.forEach(function(pt) {
      if (pt.matched && pt.codigo) {
        var chave = String(pt.codigo).trim();
        if (!realizadosMap[chave]) {
          realizadosMap[chave] = pt;
        }
      }
    });

    return esquemaPontos.map(function(ep) {
      var chave = String(ep.id_ponto).trim();
      var pontoRealizado = realizadosMap[chave] || null;
      var visitado = pontoRealizado !== null;
      return {
        id_esquema:        ep.id_esquema,
        ordem:             ep.ordem,
        id_ponto:          ep.id_ponto,
        nome_ponto:        ep.nome_ponto,
        horario_comercial: ep.horario_comercial || '',
        tempo_local:       ep.tempo_local || '',
        visitado:          visitado,
        ponto_realizado:   pontoRealizado,
        status:            visitado ? 'Realizado' : 'Não visitado'
      };
    });
  }

  /**
   * Retorna apenas os pontos não visitados de uma comparação.
   * @param {Array<Object>} comparacao  — resultado de compararRota()
   * @returns {Array<Object>}
   */
  function getPontosNaoVisitados(comparacao) {
    if (!comparacao || !comparacao.length) return [];
    return comparacao.filter(function(c) { return !c.visitado; });
  }

  /**
   * Extrai um sub-conjunto do enrichedTrip correspondendo ao trecho
   * entre os pontos idPontoA e idPontoB conforme definido no esquema.
   *
   * Busca no enrichedTrip os pontos realizados cujo .codigo corresponde
   * a algum id_ponto do esquema que esteja entre a posição de A e B
   * (inclusive).
   *
   * @param {Array<Object>} enrichedTrip
   * @param {Array<Object>} esquemaPontos  — pontos do esquema (ordenados por ordem)
   * @param {string}        idPontoA       — id_ponto do início do trecho
   * @param {string}        idPontoB       — id_ponto do fim do trecho
   * @returns {Array<Object>}  sub-array de enrichedTrip filtrado
   */
  function extrairTrecho(enrichedTrip, esquemaPontos, idPontoA, idPontoB) {
    if (!enrichedTrip || !esquemaPontos || !idPontoA || !idPontoB) {
      return enrichedTrip || [];
    }

    var idA = String(idPontoA).trim();
    var idB = String(idPontoB).trim();

    // Localiza ordens de A e B no esquema por id_ponto OU nome_ponto
    // (o ponto_inicio/ponto_fim do vínculo pode ser id_ponto ou nome)
    var ordemA = null;
    var ordemB = null;
    esquemaPontos.forEach(function(ep) {
      var epId   = String(ep.id_ponto   || '').trim();
      var epNome = String(ep.nome_ponto || '').trim();
      if (epId === idA || epNome === idA) ordemA = ep.ordem;
      if (epId === idB || epNome === idB) ordemB = ep.ordem;
    });

    if (ordemA === null || ordemB === null) {
      return enrichedTrip;
    }

    var minOrdem = Math.min(ordemA, ordemB);
    var maxOrdem = Math.max(ordemA, ordemB);

    // Monta conjunto de id_ponto E nome_ponto do esquema dentro do intervalo
    var pontosNoTrecho = {};
    esquemaPontos.forEach(function(ep) {
      if (ep.ordem >= minOrdem && ep.ordem <= maxOrdem) {
        if (ep.id_ponto)   pontosNoTrecho[String(ep.id_ponto).trim()]   = true;
        if (ep.nome_ponto) pontosNoTrecho[String(ep.nome_ponto).trim()] = true;
      }
    });

    // Inclui pontos realizados que estejam no trecho:
    // - por codigo (pontos identificados / matched)
    // - por nome do ponto (pontos não identificados mas nominalmente no esquema)
    var trechoFiltrado = enrichedTrip.filter(function(pt) {
      if (pt.matched && pt.codigo && pontosNoTrecho[String(pt.codigo).trim()]) return true;
      if (pt.ponto   && pontosNoTrecho[String(pt.ponto).trim()])               return true;
      return false;
    });

    if (trechoFiltrado.length === 0) return enrichedTrip;

    return trechoFiltrado;
  }

  return {
    compararRota:          compararRota,
    getPontosNaoVisitados: getPontosNaoVisitados,
    extrairTrecho:         extrairTrecho
  };

})();
