// ============================================================
//  TimeUtils.gs  —  Manipulação e cálculo de tempo
//  Responsabilidade: parse de duração, diff entre datetimes,
//  formatação legível para o relatório
// ============================================================

var TimeUtils = (() => {

  /**
   * Converte string "HH:MM:SS" para total de segundos.
   * Retorna 0 para valores inválidos ou "-".
   * @param {string} hhmmss
   * @returns {number} segundos
   */
  function parseDuration(hhmmss) {
    if (!hhmmss || hhmmss === '-' || hhmmss.trim() === '') return 0;
    const parts = hhmmss.trim().split(':');
    if (parts.length !== 3) return 0;
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const s = parseInt(parts[2], 10) || 0;
    return h * 3600 + m * 60 + s;
  }

  /**
   * Calcula diferença em segundos entre dois datetimes.
   * Formato aceito: "YYYY-MM-DD HH:MM:SS"
   * Retorna null se algum datetime for inválido.
   * @param {string} dt1Str  datetime inicial
   * @param {string} dt2Str  datetime final
   * @returns {number|null} diferença em segundos
   */
  function diffSeconds(dt1Str, dt2Str) {
    if (!dt1Str || !dt2Str) return null;
    const d1 = _parseDateTime(dt1Str);
    const d2 = _parseDateTime(dt2Str);
    if (!d1 || !d2) return null;
    return Math.round((d2 - d1) / 1000);
  }

  /**
   * Formata segundos em string legível: "1h 30min" ou "45min" ou "30s"
   * @param {number} seconds
   * @returns {string}
   */
  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0 && m > 0) return `${h}h ${m}min`;
    if (h > 0) return `${h}h`;
    if (m > 0 && s > 0) return `${m}min ${s}s`;
    if (m > 0) return `${m}min`;
    return `${s}s`;
  }

  /**
   * Formata datetime "YYYY-MM-DD HH:MM:SS" para "DD/MM HH:MM"
   * @param {string} dtStr
   * @returns {string}
   */
  function formatDatetime(dtStr) {
    if (!dtStr || dtStr.trim() === '') return '—';
    const d = _parseDateTime(dtStr);
    if (!d) return dtStr;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm} ${hh}:${min}`;
  }

  /**
   * Formata datetime para exibição completa: "12/04/2026 10:30"
   * @param {string} dtStr
   * @returns {string}
   */
  function formatDatetimeFull(dtStr) {
    if (!dtStr || dtStr.trim() === '') return '—';
    const d = _parseDateTime(dtStr);
    if (!d) return dtStr;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  }

  /**
   * Extrai apenas a data "DD/MM/YYYY" de um datetime string.
   * @param {string} dtStr
   * @returns {string}
   */
  function extractDate(dtStr) {
    if (!dtStr) return '—';
    const d = _parseDateTime(dtStr);
    if (!d) return dtStr;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  /**
   * Converte segundos em minutos (float, 1 casa decimal).
   * @param {number} seconds
   * @returns {number}
   */
  function toMinutes(seconds) {
    return Math.round((seconds / 60) * 10) / 10;
  }

  // ---- Privado ----

  function _parseDateTime(dtStr) {
    if (!dtStr) return null;
    // Suporta "YYYY-MM-DD HH:MM:SS" e "YYYY-MM-DDTHH:MM:SS"
    const clean = dtStr.trim().replace('T', ' ');
    const parts = clean.split(' ');
    if (parts.length < 2) return null;

    const dateParts = parts[0].split('-');
    const timeParts = parts[1].split(':');

    if (dateParts.length !== 3 || timeParts.length < 2) return null;

    return new Date(
      parseInt(dateParts[0], 10),
      parseInt(dateParts[1], 10) - 1,
      parseInt(dateParts[2], 10),
      parseInt(timeParts[0], 10),
      parseInt(timeParts[1], 10),
      parseInt(timeParts[2] || 0, 10)
    );
  }

  return {
    parseDuration,
    diffSeconds,
    formatDuration,
    formatDatetime,
    formatDatetimeFull,
    extractDate,
    toMinutes
  };
})();
