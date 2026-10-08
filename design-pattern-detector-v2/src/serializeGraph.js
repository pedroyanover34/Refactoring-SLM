import fs from 'fs';
import path from 'path';
import { getAllValidJsFiles, buildFunctionGraph } from './patternFilters.js';

/**
 * Convierte el JSON del subgrafo en una cadena descriptiva determinista
 * optimizada para modelos de embeddings vectoriales.
 */
export function serializeGraphForEmbedding(candidate) {
  const { symbol, file, signature, graph } = candidate;
  const { inputs, control_flow_type, branches_count, branches } = graph;

  let text = `El bloque de código de la función '${symbol}' (ubicada en el archivo '${file}' con firma ${signature}) `;
  text += `implementa una estructura condicional del tipo ${control_flow_type} que bifurca el flujo en ${branches_count} ramas para cambiar el comportamiento del programa.\n\n`;
  
  text += `Detalle del comportamiento y flujo de datos según cada condición:\n`;

  branches.forEach((b, idx) => {
    const { reads, writes, external_calls, instantiations } = b.data_flow;
    text += `- Cuando la condición evaluada es (${b.condition}): `;
    
    const actions = [];
    if (reads.length > 0) {
        actions.push(`evalúa o lee el estado de las variables [${reads.join(', ')}]`);
    }
    if (writes.length > 0) {
        actions.push(`modifica, muta o actualiza el estado de las variables [${writes.join(', ')}]`);
    }
    if (external_calls.length > 0) {
        actions.push(`delega la lógica llamando a métodos externos [${external_calls.join(', ')}]`);
    }
    if (instantiations.length > 0) {
        actions.push(`instancia o crea nuevos objetos de las clases [${instantiations.join(', ')}]`);
    }
    
    if (actions.length === 0) {
      text += `no realiza acciones observables en el flujo de datos.`;
    } else {
      text += `el bloque ${actions.join('; y ')}.`;
    }
    text += `\n`;
  });

  return text.trim();
}

/**
 * Escanea un directorio o archivo, genera sus grafos y los serializa
 * devolviendo los documentos y sus metadatos asociados.
 */
export function processAndSerializeProject(targetPath) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`La ruta '${targetPath}' no existe en el disco.`);
  }

  let filesToAnalyze = [];
  const stats = fs.statSync(targetPath);

  if (stats.isDirectory()) {
    filesToAnalyze = getAllValidJsFiles(targetPath);
  } else if (stats.isFile()) {
    filesToAnalyze = [targetPath];
  }

  const serializedPayloads = [];

  for (const filePath of filesToAnalyze) {
    try {
      const sourceCode = fs.readFileSync(filePath, 'utf8');
      const relativePath = path.relative(targetPath, filePath) || path.basename(filePath);

      const { hasGraphs, graphs } = buildFunctionGraph(sourceCode, relativePath);

      if (hasGraphs && graphs.length > 0) {
        graphs.forEach((candidate, graphIndex) => {
          const serializedText = serializeGraphForEmbedding(candidate);

          serializedPayloads.push({
            id: `${relativePath}::${candidate.symbol}::${graphIndex}`,
            document_text: serializedText, // Texto plano listo para generar el embedding
            metadata: {
              symbol: candidate.symbol,
              file: relativePath,
              signature: candidate.signature,
              raw_graph: JSON.stringify(candidate.graph) // Estructura completa guardada en metadatos
            }
          });
        });
      }
    } catch (err) {
      console.error(`Error procesando el archivo ${filePath}:`, err.message);
    }
  }

  return serializedPayloads;
}
