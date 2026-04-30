// ============================================================
//  MapService.gs  —  Suporte a coordenadas e mapa
//  Responsabilidade: calcular bounding box para fitBounds,
//  preparar dados de rota para o frontend
// ============================================================

var MapService = (() => {

  /**
   * Calcula o bounding box (retângulo que engloba todos os pontos)
   * para uso no Google Maps fitBounds().
   *
   * @param {Array<{lat: number, lng: number}>} points
   * @returns {{ north: number, south: number, east: number, west: number } | null}
   */
  function getBoundingBox(points) {
    const valid = points.filter(p =>
      p && p.lat != null && p.lng != null &&
      !isNaN(p.lat) && !isNaN(p.lng) &&
      p.lat !== 0 && p.lng !== 0
    );

    if (valid.length === 0) return null;
    if (valid.length === 1) {
      // Retorna um box pequeno ao redor do ponto único
      const p = valid[0];
      return {
        north: p.lat + 0.05,
        south: p.lat - 0.05,
        east:  p.lng + 0.05,
        west:  p.lng - 0.05
      };
    }

    let north = -Infinity;
    let south =  Infinity;
    let east  = -Infinity;
    let west  =  Infinity;

    valid.forEach(p => {
      if (p.lat > north) north = p.lat;
      if (p.lat < south) south = p.lat;
      if (p.lng > east)  east  = p.lng;
      if (p.lng < west)  west  = p.lng;
    });

    // Adiciona 5% de padding
    const latPad = (north - south) * 0.05;
    const lngPad = (east  - west)  * 0.05;

    return {
      north: north + latPad,
      south: south - latPad,
      east:  east  + lngPad,
      west:  west  - lngPad
    };
  }

  /**
   * Extrai array de pontos lat/lng de um enrichedTrip,
   * filtrando apenas os que possuem coordenadas válidas.
   *
   * @param {Array<Object>} enrichedTrip
   * @returns {Array<{lat: number, lng: number, seq: number, ponto: string}>}
   */
  function extractRoutePoints(enrichedTrip) {
    return enrichedTrip
      .filter(p => p.lat && p.lng && !isNaN(p.lat) && !isNaN(p.lng))
      .map(p => ({ lat: p.lat, lng: p.lng, seq: p.seq, ponto: p.ponto }));
  }

  /**
   * Calcula o centro geográfico de um conjunto de pontos.
   * @param {Array<{lat: number, lng: number}>} points
   * @returns {{lat: number, lng: number}}
   */
  function getCenter(points) {
    const valid = points.filter(p => p && p.lat && p.lng);
    if (valid.length === 0) return { lat: -15.7801, lng: -47.9292 }; // Brasília (fallback)

    const lat = valid.reduce((sum, p) => sum + p.lat, 0) / valid.length;
    const lng = valid.reduce((sum, p) => sum + p.lng, 0) / valid.length;
    return { lat, lng };
  }

  return { getBoundingBox, extractRoutePoints, getCenter };
})();
