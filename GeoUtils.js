// ============================================================
//  GeoUtils.gs  —  Cálculos geográficos (Haversine)
//  Responsabilidade: distância em km entre dois pontos lat/lng
// ============================================================

var GeoUtils = (() => {

  /**
   * Calcula a distância em km entre dois pontos geográficos
   * usando a fórmula de Haversine.
   * @param {number} lat1  Latitude ponto A (decimal)
   * @param {number} lon1  Longitude ponto A (decimal)
   * @param {number} lat2  Latitude ponto B (decimal)
   * @param {number} lon2  Longitude ponto B (decimal)
   * @returns {number} Distância em km (float, 2 casas decimais)
   */
  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // raio médio da Terra em km

    const toRad = (deg) => deg * (Math.PI / 180);

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = R * c;

    return Math.round(dist * 100) / 100;
  }

  /**
   * Calcula a distância total de uma rota (array de pontos).
   * @param {Array<{lat: number, lng: number}>} points
   * @returns {number} Distância total em km
   */
  function totalRouteKm(points) {
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (a.lat && a.lng && b.lat && b.lng) {
        total += haversineKm(a.lat, a.lng, b.lat, b.lng);
      }
    }
    return Math.round(total * 100) / 100;
  }

  // Centroides aproximados das 27 UFs (lat, lng). Usados para classificar a
  // macro-região de um ponto pela coordenada (UF do centroide mais próximo).
  const UF_CENTROIDES = {
    AC: [-9.0, -70.5],  AM: [-4.1, -64.6],  RR: [2.0, -61.4],   AP: [1.0, -52.0],
    PA: [-3.9, -52.5],  RO: [-10.9, -62.8], TO: [-10.2, -48.3],
    MA: [-5.0, -45.3],  PI: [-7.7, -42.7],  CE: [-5.1, -39.6],  RN: [-5.8, -36.6],
    PB: [-7.2, -36.7],  PE: [-8.4, -37.9],  AL: [-9.6, -36.7],  SE: [-10.6, -37.4],
    BA: [-12.5, -41.7],
    MG: [-18.5, -44.5], ES: [-19.5, -40.6], RJ: [-22.2, -42.7], SP: [-22.2, -48.7],
    PR: [-24.7, -51.7], SC: [-27.2, -50.5], RS: [-29.7, -53.3],
    MT: [-13.0, -55.9], MS: [-20.5, -54.5], GO: [-16.0, -49.6], DF: [-15.8, -47.9]
  };

  const UF_REGIAO = {
    AC: 'Norte', AM: 'Norte', RR: 'Norte', AP: 'Norte', PA: 'Norte', RO: 'Norte', TO: 'Norte',
    MA: 'Nordeste', PI: 'Nordeste', CE: 'Nordeste', RN: 'Nordeste', PB: 'Nordeste',
    PE: 'Nordeste', AL: 'Nordeste', SE: 'Nordeste', BA: 'Nordeste',
    MT: 'Centro-Oeste', MS: 'Centro-Oeste', GO: 'Centro-Oeste', DF: 'Centro-Oeste',
    MG: 'Sudeste', ES: 'Sudeste', RJ: 'Sudeste', SP: 'Sudeste',
    PR: 'Sul', SC: 'Sul', RS: 'Sul'
  };

  /**
   * Retorna a UF cujo centroide está mais próximo da coordenada dada.
   * @returns {string} sigla da UF, ou '' se a coordenada for inválida
   */
  function ufPorCoord(lat, lng) {
    const la = parseFloat(lat), lo = parseFloat(lng);
    if (!isFinite(la) || !isFinite(lo) || (la === 0 && lo === 0)) return '';
    let best = '', bestD = Infinity;
    for (const uf in UF_CENTROIDES) {
      const c = UF_CENTROIDES[uf];
      const d = haversineKm(la, lo, c[0], c[1]);
      if (d < bestD) { bestD = d; best = uf; }
    }
    return best;
  }

  /**
   * Classifica a macro-região (Norte/Nordeste/Centro-Oeste/Sudeste/Sul) de uma
   * coordenada, via UF mais próxima.
   * @returns {string} nome da região, ou '' se inválido
   */
  function regiaoPorCoord(lat, lng) {
    const uf = ufPorCoord(lat, lng);
    return uf ? UF_REGIAO[uf] : '';
  }

  return { haversineKm, totalRouteKm, ufPorCoord, regiaoPorCoord };
})();
