
## 3) Capa de análisis AST y filtrado de archivos

### [src/patternFilters.js](src/patternFilters.js)
Rol: núcleo de filtrado y extracción de grafos de funciones desde código JavaScript.

Qué hace:
- detecta si un archivo debe ignorarse (`shouldIgnoreFile`)
- recopila archivos JS válidos de un directorio (`getAllValidJsFiles`)
- parsea el AST con Babel
- detecta funciones y extrae información estructural relevante
- identifica ramas condicionales (`if/else`, `switch`) y construye un subgrafo de flujo de control

Qué aporta al proyecto:
- define qué archivos son analizables
- convierte el código en una representación estructural útil para luego serializarlo y buscarlo semánticamente

Relación con el resto:
- es la base de [src/serializeGraph.js](src/serializeGraph.js)
- sin este archivo no existiría la extracción de grafos ni su serialización posterior

## 4) Serialización de grafos para recuperación semántica

### [src/serializeGraph.js](src/serializeGraph.js)
Rol: puente entre el grafo estructural y el formato vectorizable para recuperación semántica.

Qué hace:
- recorre un directorio o archivo objetivo
- identifica archivos válidos
- genera grafos de funciones usando `buildFunctionGraph()`
- serializa cada grafo a texto descriptivo
- devuelve payloads listos para indexación

Funciones principales:
- `serializeGraphForEmbedding(candidate)`
- `processAndSerializeProject(targetPath)`

Qué aporta al proyecto:
- convierte el análisis AST en documentos de texto legibles para embeddings y recuperación por similitud

Relación con el resto:
- consume los grafos generados por [src/patternFilters.js](src/patternFilters.js)
- entrega la entrada a [src/ragChroma.js](src/ragChroma.js)

---

## 5) Capa de recuperación semántica (RAG)

### [src/ragChroma.js](src/ragChroma.js)
Rol: integración del pipeline de indexación y consulta en ChromaDB.

Qué hace:
- importa el flujo de serialización
- crea o recupera la colección en ChromaDB
- indexa los grafos serializados
- ejecuta consultas por similitud
- prepara el contexto semántico para uso posterior en el detector

Funciones principales:
- `indexGraphsInChroma(targetPath)`
- `querySimilarGraphs(queryText, nResults = 3)`

Qué aporta al proyecto:
- hace que los subgrafos generados se conviertan en datos consultables mediante recuperación semántica
- genera la capa RAG que recupera ejemplos o estructuras similares para análisis posterior

Relación con el resto:
- depende de [src/serializeGraph.js](src/serializeGraph.js)
- usa la salida del análisis AST para construir una base de conocimiento vectorial
