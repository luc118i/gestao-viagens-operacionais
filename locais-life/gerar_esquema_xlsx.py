"""
Gerador de xlsx para Esquemas de Viagem
Formato: idêntico ao padrão exportado pelo Sistema Gestão de Esquemas · KANDANGO

Uso:
    from gerar_esquema_xlsx import gerar_esquema_xlsx
    gerar_esquema_xlsx(dados, "saida.xlsx")

Estrutura de `dados` esperada:
    {
        "titulo":          "VALPARAÍSO DE GOIÁS (GO) → PALMAS (TO)",
        "horario_saida":   "19h15",
        "tipo_viagem":     "Viagem de Volta",   # ou "Viagem de Ida"
        "codigo":          "GOTO0053026",
        "distancia_total": "855,9 km",
        "tempo_movimento": "12h14",
        "tempo_paradas":   "3h30",
        "tempo_total":     "15h44",
        "tipo_via":        "BR",                # BR | Est | Mun | Urb
        "velocidade_media": 70,
        "fonte_distancia": "Cache de distâncias",
        "empresa":         "KANDANGO TRANSPORTE E TURISMO LTDA",
        "gerado_em":       "05/08/2026, 13:58",  # opcional, preenche com now()
        "pontos": [
            {
                "cidade":   "RODOVIARIA DE PALMAS",
                "chegada":  None,               # None para origem
                "parada":   None,
                "saida":    "19:15",
                "tempo_ate_aqui": None,
                "km_ate_aqui":    None,
                "dif":      "🟡 ≈",             # "🟢 +HH:MM" | "🔴 −HH:MM" | "🟡 ≈" | "—"
            },
            {
                "cidade":   "RODOVIARIA DE PORTO NACIONAL",
                "chegada":  "20:05",
                "parada":   "00:15",
                "saida":    "20:20",
                "tempo_ate_aqui": "00:51",
                "km_ate_aqui":    "59,5 km",
                "dif":      "🟢 +00:04",
            },
            # ... demais pontos ...
            {
                "cidade":   "RODOVIARIA DE VALPARAISO GO",
                "chegada":  "10:50",
                "parada":   None,               # None para destino
                "saida":    "10:50",
                "tempo_ate_aqui": "00:26",
                "km_ate_aqui":    "29,8 km",
                "dif":      "🔴 −00:24",
            },
        ]
    }
"""

from __future__ import annotations

import datetime
from pathlib import Path
from typing import Any

import openpyxl
from openpyxl.styles import (
    Alignment, Border, Font, PatternFill, Side
)
from openpyxl.utils import get_column_letter


# ─── Paleta de cores ────────────────────────────────────────────────────────
C_NAVY      = "FF1F4E79"   # azul escuro – cabeçalho, valores destaques
C_BLUE_HDR  = "FF5B95F9"   # azul médio – header da tabela
C_BLUE_EVEN = "FFE8F0FE"   # azul claríssimo – linhas pares
C_WHITE     = "FFFFFFFF"   # branco
C_GRAY      = "FF5A6070"   # cinza – rótulos e rodapé
C_TITLE_TXT = "FFFFFFFF"   # branco – texto do título
C_SUBTITLE  = "FFCFE0F5"   # azul claro – subtítulo
C_CODE      = "FFB9CEE8"   # azul pálido – linha de código


def _fill(hex_color: str) -> PatternFill:
    return PatternFill("solid", fgColor=hex_color)


def _font(
    name: str = "Inter",
    size: float = 10,
    bold: bool = False,
    color: str = "FF000000",
) -> Font:
    return Font(name=name, size=size, bold=bold, color=color)


def _align(horizontal: str = "left", vertical: str = "center", wrap: bool = False) -> Alignment:
    return Alignment(horizontal=horizontal, vertical=vertical, wrap_text=wrap)


def _thin_bottom(color: str = "FFD0D5DD") -> Border:
    side = Side(border_style="thin", color=color)
    return Border(bottom=side)


def _no_border() -> Border:
    return Border()


def gerar_esquema_xlsx(dados: dict[str, Any], output_path: str | Path) -> Path:
    """
    Gera o xlsx de esquema de viagem no padrão KANDANGO.

    Parameters
    ----------
    dados       : dict conforme documentação no topo deste módulo
    output_path : caminho de saída (.xlsx)

    Returns
    -------
    Path resolvido do arquivo gerado
    """
    output_path = Path(output_path)
    pontos: list[dict] = dados.get("pontos", [])

    # Data/hora de geração
    gerado_em = dados.get("gerado_em") or datetime.datetime.now().strftime("%d/%m/%Y, %H:%M")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Horário"

    # ── Larguras de coluna ──────────────────────────────────────────────────
    ws.column_dimensions["A"].width = 20.0
    ws.column_dimensions["B"].width = 40.14
    ws.column_dimensions["C"].width = 9.86
    ws.column_dimensions["D"].width = 8.57
    ws.column_dimensions["E"].width = 7.43
    ws.column_dimensions["F"].width = 14.71
    ws.column_dimensions["G"].width = 53.14
    ws.column_dimensions["H"].width = 1.29

    # ── Altura das linhas ───────────────────────────────────────────────────
    ws.row_dimensions[1].height = 9.0
    ws.row_dimensions[2].height = 16.5
    ws.row_dimensions[3].height = 16.5
    ws.row_dimensions[4].height = 16.5
    ws.row_dimensions[5].height = 16.5
    ws.row_dimensions[6].height = 9.0
    # linhas 8..n → 15.0 (aplicado depois)

    # ════════════════════════════════════════════════════════════════════════
    # BLOCO DE CABEÇALHO (linhas 2-5)
    # ════════════════════════════════════════════════════════════════════════

    # ── Linha 2: valores numéricos de distância e tempo em movimento ────────
    ws["F2"].value = dados.get("distancia_total", "")
    ws["F2"].font  = _font(size=15, bold=True, color=C_NAVY[2:])   # strip 'FF'
    ws["F2"].fill  = _fill(C_WHITE)

    ws["G2"].value = dados.get("tempo_movimento", "")
    ws["G2"].font  = _font(size=15, bold=True, color=C_NAVY[2:])
    ws["G2"].fill  = _fill(C_WHITE)

    # ── Linha 3: título rota + rótulos ──────────────────────────────────────
    ws["A3"].value     = dados.get("titulo", "")
    ws["A3"].font      = _font(size=16, bold=True, color="FFFFFF")
    ws["A3"].fill      = _fill(C_NAVY)
    ws["A3"].alignment = _align("center")
    ws.merge_cells("A3:E3")

    _fill_navy_cells(ws, row=3, cols=["F", "G", "H"])

    ws["F3"].value     = "DISTÂNCIA"
    ws["F3"].font      = _font(size=8, bold=True, color=C_GRAY[2:])
    ws["F3"].fill      = _fill(C_WHITE)

    ws["G3"].value     = "TEMPO EM MOVIMENTO"
    ws["G3"].font      = _font(size=8, bold=True, color=C_GRAY[2:])
    ws["G3"].fill      = _fill(C_WHITE)

    # ── Linha 4: horário + tipo de viagem + tempo de paradas e total ────────
    ws["A4"].value     = f"{dados.get('horario_saida','')} • {dados.get('tipo_viagem','')}"
    ws["A4"].font      = _font(size=11, color=C_SUBTITLE[2:])
    ws["A4"].fill      = _fill(C_NAVY)
    ws["A4"].alignment = _align("center")
    ws.merge_cells("A4:B4")

    _fill_navy_cells(ws, row=4, cols=["C", "D", "E"])

    ws["F4"].value     = dados.get("tempo_paradas", "")
    ws["F4"].font      = _font(size=15, bold=True, color=C_NAVY[2:])
    ws["F4"].fill      = _fill(C_WHITE)

    ws["G4"].value     = dados.get("tempo_total", "")
    ws["G4"].font      = _font(size=15, bold=True, color=C_NAVY[2:])
    ws["G4"].fill      = _fill(C_WHITE)

    # ── Linha 5: código + rótulos ───────────────────────────────────────────
    ws["A5"].value     = f"Código: {dados.get('codigo','')}"
    ws["A5"].font      = _font(size=9, color=C_CODE[2:])
    ws["A5"].fill      = _fill(C_NAVY)
    ws["A5"].alignment = _align("center")
    ws.merge_cells("A5:B5")

    _fill_navy_cells(ws, row=5, cols=["C", "D", "E"])

    ws["F5"].value     = "PARADAS"
    ws["F5"].font      = _font(size=8, bold=True, color=C_GRAY[2:])
    ws["F5"].fill      = _fill(C_WHITE)

    ws["G5"].value     = "TEMPO TOTAL"
    ws["G5"].font      = _font(size=8, bold=True, color=C_GRAY[2:])
    ws["G5"].fill      = _fill(C_WHITE)

    # ════════════════════════════════════════════════════════════════════════
    # HEADER DA TABELA (linha 8)
    # ════════════════════════════════════════════════════════════════════════
    ws.row_dimensions[8].height = 15.0

    headers = [
        ("B", "Cidade"),
        ("C", "Chegada"),
        ("D", "Parada"),
        ("E", "Saída"),
        ("F", "Tempo até aqui"),
        ("G", "Dif."),
    ]
    for col, label in headers:
        cell = ws[f"{col}8"]
        cell.value     = label
        cell.font      = _font(size=10, bold=(col == "B"))
        cell.fill      = _fill(C_BLUE_HDR)
        cell.alignment = _align("center" if col != "B" else "left")

    # ════════════════════════════════════════════════════════════════════════
    # LINHAS DE DADOS (a partir da linha 9)
    # ════════════════════════════════════════════════════════════════════════
    first_data_row = 9
    last_data_row  = first_data_row + len(pontos) - 1

    for i, ponto in enumerate(pontos):
        row = first_data_row + i
        ws.row_dimensions[row].height = 15.0

        # alternância de cor: ímpar = branco, par = azul clarinho
        fill_color = C_WHITE if (i % 2 == 0) else C_BLUE_EVEN

        # ── coluna B: cidade ────────────────────────────────────────────────
        ws[f"B{row}"].value     = ponto.get("cidade", "")
        ws[f"B{row}"].font      = _font(size=10, bold=True)
        ws[f"B{row}"].fill      = _fill(fill_color)
        ws[f"B{row}"].alignment = _align("left")

        # ── coluna C: chegada ───────────────────────────────────────────────
        chegada = ponto.get("chegada")
        if chegada:
            ws[f"C{row}"].value        = _parse_time(chegada)
            ws[f"C{row}"].number_format = "h:mm"
        else:
            ws[f"C{row}"].value = "—"
        ws[f"C{row}"].font      = _font(size=10)
        ws[f"C{row}"].fill      = _fill(fill_color)
        ws[f"C{row}"].alignment = _align("center")

        # ── coluna D: parada ────────────────────────────────────────────────
        parada = ponto.get("parada")
        if parada:
            ws[f"D{row}"].value        = _parse_time(parada)
            ws[f"D{row}"].number_format = "h:mm"
        else:
            ws[f"D{row}"].value = "—"
        ws[f"D{row}"].font      = _font(size=10)
        ws[f"D{row}"].fill      = _fill(fill_color)
        ws[f"D{row}"].alignment = _align("center")

        # ── coluna E: saída ─────────────────────────────────────────────────
        saida = ponto.get("saida")
        if saida:
            ws[f"E{row}"].value        = _parse_time(saida)
            ws[f"E{row}"].number_format = "h:mm"
        else:
            ws[f"E{row}"].value = "—"
        ws[f"E{row}"].font      = _font(size=10)
        ws[f"E{row}"].fill      = _fill(fill_color)
        ws[f"E{row}"].alignment = _align("center")

        # ── coluna F: tempo até aqui + km ───────────────────────────────────
        tempo = ponto.get("tempo_ate_aqui")
        km    = ponto.get("km_ate_aqui")
        if tempo and km:
            ws[f"F{row}"].value = f"{tempo} · {km}"
        elif tempo:
            ws[f"F{row}"].value = tempo
        else:
            ws[f"F{row}"].value = "—"
        ws[f"F{row}"].font      = _font(size=10)
        ws[f"F{row}"].fill      = _fill(fill_color)
        ws[f"F{row}"].alignment = _align("center")

        # ── coluna G: diferença ──────────────────────────────────────────────
        ws[f"G{row}"].value     = ponto.get("dif", "—") or "—"
        ws[f"G{row}"].font      = _font(size=10)
        ws[f"G{row}"].fill      = _fill(fill_color)
        ws[f"G{row}"].alignment = _align("center")

    # ── Merge coluna A nas linhas de dados ──────────────────────────────────
    if pontos:
        ws.merge_cells(f"A8:A{last_data_row}")

    # ════════════════════════════════════════════════════════════════════════
    # RODAPÉ (2 linhas após a última linha de dados + 1 de espaço)
    # ════════════════════════════════════════════════════════════════════════
    footer_space = last_data_row + 1
    footer_row1  = last_data_row + 2
    footer_row2  = last_data_row + 3

    ws.row_dimensions[footer_space].height = 15.0
    ws.row_dimensions[footer_row1].height  = 14.25
    ws.row_dimensions[footer_row2].height  = 14.25

    tipo_via  = dados.get("tipo_via", "BR")
    vel_media = dados.get("velocidade_media", 70)
    fonte     = dados.get("fonte_distancia", "Cache de distâncias")
    empresa   = dados.get("empresa", "")

    txt_rodape1 = (
        f"Gerado em: {gerado_em}   ·   "
        f"Tipo: {tipo_via}   ·   "
        f"Velocidade média: {vel_media} km/h   ·   "
        f"Fonte da distância: {fonte}"
    )
    txt_rodape2 = f"Sistema Gestão de Esquemas · {empresa}"

    ws[f"B{footer_row1}"].value     = txt_rodape1
    ws[f"B{footer_row1}"].font      = _font(size=9, color=C_GRAY[2:])
    ws[f"B{footer_row1}"].alignment = _align("left")
    ws.merge_cells(f"B{footer_row1}:G{footer_row1}")

    ws[f"B{footer_row2}"].value     = txt_rodape2
    ws[f"B{footer_row2}"].font      = _font(size=9, color=C_GRAY[2:])
    ws[f"B{footer_row2}"].alignment = _align("left")
    ws.merge_cells(f"B{footer_row2}:G{footer_row2}")

    # ════════════════════════════════════════════════════════════════════════
    # CONFIGURAÇÕES GERAIS DA PLANILHA
    # ════════════════════════════════════════════════════════════════════════
    ws.sheet_view.showGridLines = False   # sem linhas de grade
    ws.print_area = f"A1:H{footer_row2}"

    wb.save(str(output_path))
    return output_path.resolve()


# ── Helpers internos ─────────────────────────────────────────────────────────

def _fill_navy_cells(ws, row: int, cols: list[str]) -> None:
    """Preenche células com fundo azul-escuro sem conteúdo."""
    for col in cols:
        cell = ws[f"{col}{row}"]
        cell.fill = _fill(C_NAVY)


def _parse_time(value: str | None) -> Any:
    """
    Converte "HH:MM" ou "HH:MM:SS" em objeto datetime.time para o openpyxl
    armazenar como valor de tempo nativo (formato h:mm no Excel).
    Retorna o valor original se não conseguir parsear.
    """
    if not value:
        return None
    try:
        parts = value.strip().split(":")
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        s = int(parts[2]) if len(parts) > 2 else 0
        # Excel armazena tempo como fração de dia
        return datetime.time(h % 24, m, s)
    except Exception:
        return value


# ── Exemplo / demo ────────────────────────────────────────────────────────────

EXEMPLO_DADOS = {
    "titulo":          "VALPARAÍSO DE GOIÁS (GO) → PALMAS (TO)",
    "horario_saida":   "19h15",
    "tipo_viagem":     "Viagem de Volta",
    "codigo":          "GOTO0053026",
    "distancia_total": "855,9 km",
    "tempo_movimento": "12h14",
    "tempo_paradas":   "3h30",
    "tempo_total":     "15h44",
    "tipo_via":        "BR",
    "velocidade_media": 70,
    "fonte_distancia": "Cache de distâncias",
    "empresa":         "KANDANGO TRANSPORTE E TURISMO LTDA",
    "gerado_em":       "05/08/2026, 13:58",
    "pontos": [
        {
            "cidade":         "RODOVIARIA DE PALMAS",
            "chegada":        None,
            "parada":         None,
            "saida":          "19:15",
            "tempo_ate_aqui": None,
            "km_ate_aqui":    None,
            "dif":            "🟡 ≈",
        },
        {
            "cidade":         "RODOVIARIA DE PORTO NACIONAL",
            "chegada":        "20:05",
            "parada":         "00:15",
            "saida":          "20:20",
            "tempo_ate_aqui": "00:51",
            "km_ate_aqui":    "59,5 km",
            "dif":            "🟢 +00:04",
        },
        {
            "cidade":         "Terminal Rodoviário de Brejinho de Nazaré",
            "chegada":        "20:55",
            "parada":         "00:10",
            "saida":          "21:05",
            "tempo_ate_aqui": "00:36",
            "km_ate_aqui":    "42,0 km",
            "dif":            "🟢 +00:33",
        },
        {
            "cidade":         "RODOVIARIA DE ALIANÇA TO",
            "chegada":        "22:00",
            "parada":         "00:10",
            "saida":          "22:10",
            "tempo_ate_aqui": "00:53",
            "km_ate_aqui":    "61,8 km",
            "dif":            "🟢 +00:25",
        },
        {
            "cidade":         "CHURRASCARIA DO GAUCHO - ALIANÇA TO",
            "chegada":        "22:25",
            "parada":         "00:30",
            "saida":          "22:55",
            "tempo_ate_aqui": "00:13",
            "km_ate_aqui":    "15,0 km",
            "dif":            "—",
        },
        {
            "cidade":         "RODOVIARIA DE GURUPI",
            "chegada":        "23:35",
            "parada":         "00:20",
            "saida":          "23:55",
            "tempo_ate_aqui": "00:44",
            "km_ate_aqui":    "50,9 km",
            "dif":            "🔴 −00:47",
        },
        {
            "cidade":         "RODOVIARIA DE FIGUEIROPOLIS",
            "chegada":        "00:40",
            "parada":         "00:05",
            "saida":          "00:45",
            "tempo_ate_aqui": "00:43",
            "km_ate_aqui":    "50,6 km",
            "dif":            "🔴 −00:15",
        },
        {
            "cidade":         "Estação Rodoviária de Alvorada / Alvorada - TO",
            "chegada":        "01:20",
            "parada":         "00:10",
            "saida":          "01:30",
            "tempo_ate_aqui": "00:34",
            "km_ate_aqui":    "39,8 km",
            "dif":            "🔴 −00:14",
        },
        {
            "cidade":         "RODOVIARIA DE TALISMA",
            "chegada":        "02:00",
            "parada":         "00:10",
            "saida":          "02:10",
            "tempo_ate_aqui": "00:32",
            "km_ate_aqui":    "37,4 km",
            "dif":            "🔴 −00:21",
        },
        {
            "cidade":         "RESTAURANTE POSTO PRESIDENTE",
            "chegada":        "03:15",
            "parada":         "00:15",
            "saida":          "03:30",
            "tempo_ate_aqui": "01:05",
            "km_ate_aqui":    "76,1 km",
            "dif":            "—",
        },
        {
            "cidade":         "CAMPIONORTE - GO / POSTO PETROBRAS",
            "chegada":        "05:00",
            "parada":         "00:30",
            "saida":          "05:30",
            "tempo_ate_aqui": "01:29",
            "km_ate_aqui":    "103,8 km",
            "dif":            "—",
        },
        {
            "cidade":         "RODOVIARIA DE TAGUATINGA - BSB",
            "chegada":        "09:20",
            "parada":         "00:15",
            "saida":          "09:35",
            "tempo_ate_aqui": "03:51",
            "km_ate_aqui":    "269,2 km",
            "dif":            "🔴 −00:36",
        },
        {
            "cidade":         "RODOVIARIA DE BRASILIA - BSB",
            "chegada":        "09:55",
            "parada":         "00:30",
            "saida":          "10:25",
            "tempo_ate_aqui": "00:17",
            "km_ate_aqui":    "20,0 km",
            "dif":            "🔴 −00:28",
        },
        {
            "cidade":         "RODOVIARIA DE VALPARAISO GO",
            "chegada":        "10:50",
            "parada":         None,
            "saida":          "10:50",
            "tempo_ate_aqui": "00:26",
            "km_ate_aqui":    "29,8 km",
            "dif":            "🔴 −00:24",
        },
    ],
}


if __name__ == "__main__":
    import sys

    saida = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("esquema_gerado.xlsx")
    caminho = gerar_esquema_xlsx(EXEMPLO_DADOS, saida)
    print(f"Arquivo gerado: {caminho}")
