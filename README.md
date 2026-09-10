<div align="center">

# 🚌 Gestao de Viagens Operacionais

**Analise operacional de viagens sobre Google Apps Script + Google Sheets**

Upload de relatorios CSV, validacao de rotas por esquema, mapa interativo,
alertas de velocidade/paradas e geracao de relatorios por motorista ou trecho.

<br>

![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-V8-4285F4?logo=google&logoColor=white)
![clasp](https://img.shields.io/badge/clasp-3.x-333333?logo=google&logoColor=white)
![Frontend](https://img.shields.io/badge/Frontend-HTML%20%2B%20Leaflet-orange)
![Status](https://img.shields.io/badge/status-em%20produ%C3%A7%C3%A3o-success)

</div>

---

## 📋 Visao Geral

O projeto roda como **Web App do Google Apps Script** e usa **Google Sheets** como
base operacional para locais, esquemas, pontos de rota e motoristas.

| | Recurso |
|---|---|
| 📥 | Upload e processamento de relatorios CSV/TXT de viagem |
| 🔗 | Cruzamento dos pontos do relatorio com a base de locais cadastrados |
| 🧭 | Analise de rota por esquema operacional |
| 🗺️ | Mapa interativo com pontos, trechos e visualizacao da viagem |
| ⚠️ | Alertas de velocidade, paradas longas e pontos nao visitados |
| 🛠️ | Gestao de esquemas e pontos via interface web/sidebar |
| 📄 | Geracao de relatorios por motorista, trecho ou viagem completa |
| ☁️ | Copia automatica do relatorio gerado (PDF/DOCX) para uma pasta do Google Drive |
| 🔌 | Integracao opcional com API externa de ocorrencias e PDFs |

---

## 🗂️ Estrutura

<table>
<tr><th>Arquivo</th><th>Responsabilidade</th></tr>
<tr><td><code>Code.js</code></td><td>Ponto de entrada do Apps Script, rotas do Web App e funcoes expostas ao frontend</td></tr>
<tr><td><code>AnalysisService.js</code></td><td>Processamento do CSV, enriquecimento dos pontos e calculo de alertas</td></tr>
<tr><td><code>ComparisonService.js</code></td><td>Comparacao entre viagem realizada e esquema planejado</td></tr>
<tr><td><code>EsquemasService.js</code></td><td>Leitura e cache dos esquemas e pontos no Google Sheets</td></tr>
<tr><td><code>SheetsService.js</code></td><td>Acesso as abas de dados do Google Sheets</td></tr>
<tr><td><code>ReportService.js</code></td><td>Montagem e envio de relatorios operacionais + copia no Drive</td></tr>
<tr><td><code>MapService.js</code>, <code>GeoUtils.js</code>, <code>TimeUtils.js</code></td><td>Utilitarios de mapa, distancia e tempo</td></tr>
<tr><td><code>index.html</code>, <code>app.html</code>, <code>map.html</code>, <code>analysis.html</code>, <code>ui.html</code>, <code>style.html</code></td><td>Interface principal</td></tr>
<tr><td><code>EsquemasManager.html</code>, <code>CadastroPonto.html</code></td><td>Telas de gestao de esquemas e cadastro de pontos</td></tr>
<tr><td><code>appsscript.json</code></td><td>Manifest do Google Apps Script</td></tr>
</table>

---

## ⚙️ Configuracao Local

```bash
# 1. Instale o clasp
npm install -g @google/clasp

# 2. Autentique sua conta Google
clasp login

# 3. Copie o arquivo de exemplo
cp .clasp.example.json .clasp.json

# 4. Atualize o campo "scriptId" em .clasp.json

# 5. Envie os arquivos para o Apps Script
clasp push
```

---

## 🔑 Script Properties

Configure no Google Apps Script quando aplicavel:

| Propriedade | Descricao |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Chave da API do Google Maps, se o mapa com Google Maps estiver habilitado |
| `REPORT_API_URL` | URL base da API externa de ocorrencias |
| `REPORT_TYPE_CODE` | Codigo do tipo de ocorrencia usado na API externa |
| `REPORTS_PDF_TTL` | Tempo de validade da URL assinada do PDF, em segundos |
| `REPORTS_DRIVE_FOLDER_ID` | ID da pasta do Drive onde o relatorio e salvo. Se vazia, o script cria/reutiliza a pasta `Relatorios Operacionais` na raiz e grava o ID aqui no primeiro uso |

> [!NOTE]
> A copia para o Drive usa o escopo `https://www.googleapis.com/auth/drive` (em `appsscript.json`).
> Ao atualizar a partir de uma versao antiga, a conta que faz o deploy precisa **reautorizar o script uma vez**.
> Falha ao salvar no Drive **nao interrompe** a geracao: o relatorio continua acessivel pela URL assinada da API enquanto ela durar.

---

## 📊 Planilha Esperada

<details>
<summary>Abas operacionais e requisitos de qualidade</summary>

<br>

O projeto espera uma planilha Google Sheets com abas operacionais como:

- `LOCAIS`
- `ESQUEMAS`
- `ESQUEMA_PONTOS`
- `MOTORISTAS`

Os services aceitam algumas variacoes de nomes de cabecalho, mas a qualidade da
analise depende de pontos com coordenadas, codigos consistentes e esquemas
atualizados.

</details>

---

## 🚀 Deploy

<details>
<summary>Publicando o Web App</summary>

<br>

No Google Apps Script:

1. Abra o projeto.
2. Acesse `Implantar > Nova implantacao`.
3. Escolha `App da Web`.
4. Configure a execucao conforme o ambiente operacional.
5. Publique e use a URL gerada.

Via `clasp`, para redeployar mantendo o mesmo ID de implantacao:

```bash
clasp push -f
clasp deploy --deploymentId <ID> --description "resumo da mudanca"
```

</details>

---

<div align="center">

### 📦 Repositorio

[github.com/luc118i/gestao-viagens-operacionais](https://github.com/luc118i/gestao-viagens-operacionais)

</div>
