# DCP Analyzer (PDF)

Sistema para ler até 10 PDFs DCP, extrair Número do Acordo e Competências (01..13 por ano), e exibir o status na tela.

## 1) Rodar local
### API
cd api
npm install
npm start
# API em http://localhost:3000

### Frontend
cd frontend
# abra o index.html com Live Server (VSCode) ou similar

No frontend, ajuste:
window.DCP_API_URL = "http://localhost:3000"

## 2) Deploy no Render (API)
- Crie um Web Service Node no Render apontando para /api
- Build Command: npm install
- Start Command: npm start
- Pegue a URL final e coloque no frontend (window.DCP_API_URL)

## 3) Deploy no Netlify (Frontend)
- New site from Git
- Base directory: frontend
- Publish directory: frontend (ou "." se o netlify ler o folder)
- Ajuste window.DCP_API_URL no index.html para a URL do Render

## Observações
- Não há banco. A API processa e devolve JSON.
- Cancelamento: o navegador aborta o request, interrompendo o envio/espera do resultado.
# dcp-analyzer
