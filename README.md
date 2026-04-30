# Gestao de Viagens Operacionais

Aplicacao Google Apps Script para analise operacional de viagens, com upload de relatorios CSV, validacao de rotas por esquema, mapa interativo, alertas de velocidade/paradas e geracao de relatorios por motorista ou trecho.

## Visao Geral

O projeto roda como Web App do Google Apps Script e usa Google Sheets como base operacional para locais, esquemas, pontos de rota e motoristas.

Principais recursos:

- Upload e processamento de relatorios CSV/TXT de viagem.
- Cruzamento dos pontos do relatorio com a base de locais cadastrados.
- Analise de rota por esquema operacional.
- Mapa interativo com pontos, trechos e visualizacao da viagem.
- Alertas de velocidade, paradas longas e pontos nao visitados.
- Gestao de esquemas e pontos via interface web/sidebar.
- Geracao de relatorios por motorista, trecho ou viagem completa.
- Integracao opcional com API externa de ocorrencias e PDFs.

## Estrutura

- `Code.js`: ponto de entrada do Apps Script, rotas do Web App e funcoes expostas ao frontend.
- `AnalysisService.js`: processamento do CSV, enriquecimento dos pontos e calculo de alertas.
- `ComparisonService.js`: comparacao entre viagem realizada e esquema planejado.
- `EsquemasService.js`: leitura e cache dos esquemas e pontos no Google Sheets.
- `SheetsService.js`: acesso as abas de dados do Google Sheets.
- `ReportService.js`: montagem e envio de relatorios operacionais.
- `MapService.js`, `GeoUtils.js`, `TimeUtils.js`: utilitarios de mapa, distancia e tempo.
- `index.html`, `app.html`, `map.html`, `analysis.html`, `ui.html`, `style.html`: interface principal.
- `EsquemasManager.html`, `CadastroPonto.html`: telas de gestao de esquemas e cadastro de pontos.
- `appsscript.json`: manifest do Google Apps Script.

## Configuracao Local

1. Instale o `clasp`, caso ainda nao tenha:

```bash
npm install -g @google/clasp
```

2. Autentique sua conta Google:

```bash
clasp login
```

3. Copie o arquivo de exemplo e informe o ID do seu projeto Apps Script:

```bash
cp .clasp.example.json .clasp.json
```

4. Atualize o campo `scriptId` em `.clasp.json`.

5. Envie os arquivos para o Apps Script:

```bash
clasp push
```

## Script Properties

Configure estas propriedades no Google Apps Script quando aplicavel:

- `GOOGLE_MAPS_API_KEY`: chave da API do Google Maps, se o mapa com Google Maps estiver habilitado.
- `REPORT_API_URL`: URL base da API externa de ocorrencias.
- `REPORT_TYPE_CODE`: codigo do tipo de ocorrencia usado na API externa.
- `REPORTS_PDF_TTL`: tempo de validade da URL assinada do PDF, em segundos.

## Planilha Esperada

O projeto espera uma planilha Google Sheets com abas operacionais como:

- `LOCAIS`
- `ESQUEMAS`
- `ESQUEMA_PONTOS`
- `MOTORISTAS`

Os services aceitam algumas variacoes de nomes de cabecalho, mas a qualidade da analise depende de pontos com coordenadas, codigos consistentes e esquemas atualizados.

## Deploy

No Google Apps Script:

1. Abra o projeto.
2. Acesse `Implantar > Nova implantacao`.
3. Escolha `App da Web`.
4. Configure a execucao conforme o ambiente operacional.
5. Publique e use a URL gerada.

## Repositorio

Repositorio remoto:

```text
https://github.com/luc118i/gestao-viagens-operacionais.git
```
