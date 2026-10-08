# Herramienta de Detección de Patrones de Diseño (GoF)

Programa de análisis estático que identifica código **sin** patrón de diseño aplicado
donde convendría aplicar uno, usando una capa de reglas AST + recuperación semántica
(RAG) + razonamiento LLM. Nunca aplica cambios automáticamente: solo sugiere.

Ver `docs/` para la bitácora de investigación y la hoja de ruta completas.

## Enfoque

Rebanada vertical: todas las capas funcionando de punta a punta para **Observer**
(patrón inicial) antes de escalar a más patrones (Fase 6).

## Estado de fases

- [ ] Fase 0 — Setup del entorno
- [ ] Fase 1 — Capa 1: reglas AST (determinística, vía Serena/LSP)
- [ ] Fase 2 — Dataset mínimo (P-MARt, Observer)
- [ ] Fase 3 — Embeddings + RAG básico (Chroma)
- [ ] Fase 4 — Capa LLM (Motor A, sin fine-tuning)
- [ ] Fase 5 — Evaluación (metodología few-shot)
- [ ] Fase 6 — Escalar (más patrones, fine-tuning LoRA, MCP, grafos)

## Estructura

```
design-pattern-detector/
├── src/
│   ├── ast_layer/   # Fase 1 — reglas sobre AST (Serena)
│   ├── dataset/      # Fase 2 — carga y curación de P-MARt / casos propios
│   ├── rag/           # Fase 3 — embeddings + Chroma
│   ├── llm/            # Fase 4 — prompt, Motor A/B
│   └── eval/            # Fase 5 — evaluación few-shot + métricas de calidad
├── data/
│   ├── raw/          # ejemplos crudos (P-MARt, mutaciones, etc.)
│   ├── processed/     # ejemplos procesados/etiquetados
│   └── pmart/          # subset de P-MARt (Observer)
├── config/            # config de Serena, modelos, RAG
├── docs/                # bitácora + hoja de ruta
└── tests/
```

## Setup rápido

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Serena está configurado para este proyecto JavaScript en `.serena/project.yml`.
La configuración MCP para conectarlo con LM Studio se describe abajo.

## Servidor MCP para el RAG

El servidor MCP expone dos herramientas para que un modelo local pueda operar
el RAG:

- `index_portfolio`: analiza un archivo o directorio JavaScript, genera sus
	embeddings y los guarda en ChromaDB.
- `search_portfolio_graphs`: busca grafos por similitud semántica y devuelve sus
	metadatos y estructura.

La respuesta de `search_portfolio_graphs` está ordenada por `distance` ascendente
(el resultado más cercano aparece primero). Cada resultado contiene `symbol`,
`file`, `inputs` y `branches`. Cada rama contiene `branch`, `condition`, `reads`,
`writes`, `calls` e `instantiations`.

Inicia el servidor con:

```bash
npm run mcp:rag
```

Configuración de ejemplo para un cliente MCP:

```json
{
	"mcpServers": {
		"design-pattern-rag": {
			"command": "node",
			"args": ["/Users/pedro/Desktop/design-pattern-detector-v2/src/mcpServer.js"]
		}
	}
}
```

Antes de invocar las herramientas, deben estar ejecutándose ChromaDB y el
servidor de embeddings de LM Studio. La herramienta de indexación recibe
`targetPath`; la de búsqueda recibe `query` y opcionalmente `nResults`.

## Serena MCP en LM Studio

Serena ofrece navegación semántica del código (símbolos y referencias) como
servidor MCP. Este repositorio configura el language server `typescript` y
desactiva las herramientas de edición de Serena (`read_only: true`). Serena
ignora los archivos excluidos por `.gitignore`, como `node_modules/`.

En LM Studio, abre `Program > Install > Edit mcp.json` y agrega esta entrada
dentro de `mcpServers`:

```json
"serena": {
	"command": "uvx",
	"args": [
		"--from",
		"git+https://github.com/oraios/serena",
		"serena",
		"start-mcp-server",
		"--context=desktop-app",
		"--project",
		"/Users/pedro/Desktop/design-pattern-detector-v2"
	]
}
```

Esto requiere `uv` instalado y LM Studio 0.3.17 o posterior. Guarda el archivo,
recarga los servidores MCP en LM Studio y habilita Serena en el chat. El modelo
debe soportar llamadas a herramientas; Serena trabaja junto al RAG de este
proyecto, no reemplaza Chroma ni el servidor de embeddings.

Para que el modelo busque oportunidades de refactorización usando el patrón que
indiques, pega el contenido de
[`config/pattern-refactoring-system-prompt.md`](config/pattern-refactoring-system-prompt.md)
en el campo **System Prompt** de LM Studio. El prompt usa la herramienta
`search_portfolio_graphs` del servidor RAG.

LM Studio debe tener cargado un modelo compatible con embeddings. El modelo
conversacional Qwen no sirve para esta llamada; el RAG usa por defecto
`text-embedding-nomic-embed-text-v1.5`. Si usas otro modelo, configura su
identificador y, si hace falta, ajusta el tiempo máximo de espera:

```bash
export LM_STUDIO_EMBEDDING_MODEL="text-embedding-nomic-embed-text-v1.5"
export LM_STUDIO_EMBEDDING_TIMEOUT_MS=120000
export LM_STUDIO_EMBEDDING_RETRIES=2
export LM_STUDIO_RETRY_DELAY_MS=3000
npm run mcp:rag
```

Un error `400 No models loaded` en `/v1/embeddings` significa que LM Studio
recibió la solicitud, pero no tiene cargado el modelo de embeddings. Tener
cargado solamente `qwen2.5-coder-7b-instruct-mlx` no basta.



dataset raw: 

raw_refactoring_pairs/
├── pair_0001_Extract_Method/
│   ├── Before.java    # Código fuente completo tal como estaba ANTES
│   ├── After.java     # Código fuente completo tal como quedó DESPUÉS
│   └── info.json      # Tipo de refactorización y líneas exactas
├── pair_0002_Replace_Conditional_with_Polymorphism/
│   ├── Before.java
│   ├── After.java
│   └── info.json