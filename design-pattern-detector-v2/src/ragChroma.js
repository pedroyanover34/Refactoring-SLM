import { ChromaClient } from 'chromadb';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processAndSerializeProject } from './serializeGraph.js';

const LM_STUDIO_EMBEDDING_MODEL =
  process.env.LM_STUDIO_EMBEDDING_MODEL ||
  process.env.LM_STUDIO_MODEL ||
  'text-embedding-nomic-embed-text-v1.5';
const LM_STUDIO_EMBEDDING_TIMEOUT_MS = Number(process.env.LM_STUDIO_EMBEDDING_TIMEOUT_MS || 120000);
const LM_STUDIO_EMBEDDING_RETRIES = Number(process.env.LM_STUDIO_EMBEDDING_RETRIES || 2);
const LM_STUDIO_RETRY_DELAY_MS = Number(process.env.LM_STUDIO_RETRY_DELAY_MS || 3000);

function isRetryableEmbeddingError(error) {
  const message = String(error?.message || error).toLowerCase();
  return error?.name === 'AbortError' ||
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('timed out') ||
    /\((408\vert{}429\vert{}500\vert{}502\vert{}503\vert{}504)\)/.test(message);
}

function isModelNotLoadedError(error) {
  return String(error?.message || error).toLowerCase().includes('no models loaded');
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export class LMStudioEmbeddingFunction {
  constructor(baseUrl = 'http://127.0.0.1:1234/v1', model = LM_STUDIO_EMBEDDING_MODEL) {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async generate(texts) {
    for (let attempt = 0; attempt <= LM_STUDIO_EMBEDDING_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LM_STUDIO_EMBEDDING_TIMEOUT_MS);

      try {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            input: texts,
            model: this.model
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Error en servidor LM Studio (${response.status}): ${text || response.statusText}`);
        }

        const data = await response.json();
        const payload = Array.isArray(data?.data) ? data.data : [];

        if (payload.length === 0) {
          throw new Error(`LM Studio no devolvió embeddings válidos: ${JSON.stringify(data).slice(0, 300)}`);
        }

        return payload.map((item) => {
          const vector = item?.embedding ?? item?.data?.embedding;
          if (!Array.isArray(vector)) {
            throw new Error(`Formato de embedding inválido recibido desde LM Studio: ${JSON.stringify(item).slice(0, 200)}`);
          }
          return vector;
        });
      } catch (error) {
        if (isModelNotLoadedError(error)) {
          throw new Error(
            `LM Studio recibió la petición, pero no tiene cargado un modelo de embeddings. ` +
            `Carga un modelo de embeddings en LM Studio y configura LM_STUDIO_EMBEDDING_MODEL con su identificador. ` +
            `Detalle original: ${error.message}`
          );
        }

        if (!isRetryableEmbeddingError(error) || attempt === LM_STUDIO_EMBEDDING_RETRIES) {
          console.error('❌ Error al conectar con LM Studio:', error.message);
          throw error;
        }

        console.error(`⚠️ LM Studio no respondió todavía; reintentando (${attempt + 1}/${LM_STUDIO_EMBEDDING_RETRIES})...`);
        await wait(LM_STUDIO_RETRY_DELAY_MS);
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  async generateForQueries(texts) {
    return this.generate(texts);
  }

  defaultSpace() {
    return 'cosine';
  }

  supportedSpaces() {
    return ['cosine'];
  }
}

const embeddingFunction = new LMStudioEmbeddingFunction();
const client = new ChromaClient();
const COLLECTION_NAME = 'code_dependency_graphs';
const MAX_COSINE_DISTANCE = 0.65;
const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

async function getOrCreateCompatibleCollection() {
  try {
    return await client.getOrCreateCollection({
      name: COLLECTION_NAME,
      embeddingFunction
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes('dimension') && !message.includes('embedding')) {
      throw error;
    }
    try {
      await client.deleteCollection({ name: COLLECTION_NAME });
    } catch {}
    return client.getOrCreateCollection({
      name: COLLECTION_NAME,
      embeddingFunction
    });
  }
}

export async function indexGraphsInChroma(targetPath) {
  console.error(`⏳ Leyendo y serializando subgrafos en '${targetPath}'...`);
  const nodes = processAndSerializeProject(targetPath);

  if (nodes.length === 0) {
    console.error('⚠️ No se encontraron subgrafos para indexar en esa ruta.');
    return 0;
  }

  console.error(`📦 Conectando a ChromaDB para purgar e indexar ${nodes.length} nodos...`);

  try {
    // PURGA FORZADA: Elimina los embeddings anteriores antes de reindexar
    try {
      await client.deleteCollection({ name: COLLECTION_NAME });
      console.error(`🧹 Colección anterior '${COLLECTION_NAME}' eliminada exitosamente.`);
    } catch (error) {
      // Ignorar si la colección no existía previamente
    }

    let collection = await getOrCreateCompatibleCollection();

    const ids = nodes.map(n => n.id);
    const documents = nodes.map(n => n.document_text);
    const metadatas = nodes.map(n => ({
      symbol: String(n.metadata.symbol),
      file: String(n.metadata.file),
      signature: String(n.metadata.signature),
      raw_graph: String(n.metadata.raw_graph)
    }));

    await collection.add({
      ids: ids,
      documents: documents,
      metadatas: metadatas
    });

    console.error(`✅ ${nodes.length} subgrafos indexados correctamente en ChromaDB.`);
    return nodes.length;
  } catch (error) {
    console.error('❌ Error interactuando con ChromaDB:', error.message);
    throw error;
  }
}

export async function querySimilarGraphs(queryText, nResults = 10) {
  try {
    let collection;
    try {
      collection = await client.getCollection({
        name: COLLECTION_NAME,
        embeddingFunction
      });
    } catch (error) {
      const message = String(error?.message || error);
      if (!message.includes('dimension') && !message.includes('embedding')) throw error;
      try { await client.deleteCollection({ name: COLLECTION_NAME }); } catch {}
      return [];
    }

    const results = await collection.query({
      queryTexts: [queryText],
      nResults: nResults
    });

    if (!results.metadatas || results.metadatas[0].length === 0) return [];

    return results.ids[0]
      .map((id, index) => {
        const meta = results.metadatas[0][index];
        return {
          id: id,
          distance: results.distances ? results.distances[0][index] : null,
          symbol: meta.symbol,
          file: meta.file,
          signature: meta.signature,
          raw_graph: JSON.parse(meta.raw_graph)
        };
      })
      .filter(result => result.distance !== null && result.distance <= MAX_COSINE_DISTANCE);
  } catch (error) {
    console.error('❌ Error al consultar ChromaDB:', error.message);
    return [];
  }
}

async function run() {
  const targetFolder = process.argv[2] || './src';
  console.log(`🚀 Iniciando pipeline RAG en: ${targetFolder}\n`);
  await indexGraphsInChroma(targetFolder);
}

if (isDirectExecution) {
  run();
}