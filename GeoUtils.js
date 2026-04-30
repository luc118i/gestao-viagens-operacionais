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

  return { haversineKm, totalRouteKm };
})();
