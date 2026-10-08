import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { indexGraphsInChroma, querySimilarGraphs } from './ragChroma.js';

export function formatGraphMatches(matches) {
  return matches
    .slice()
    .sort((left, right) => (left.distance ?? Number.POSITIVE_INFINITY) - (right.distance ?? Number.POSITIVE_INFINITY))
    .map((match) => {
      const graph = match.raw_graph || {};

      return {
        id: match.id,
        distance: match.distance,
        symbol: match.symbol,
        file: match.file,
        inputs: graph.inputs || [],
        branches: (graph.branches || []).map((branch) => ({
          branch: branch.branch_id,
          condition: branch.condition,
          reads: branch.data_flow?.reads || [],
          writes: branch.data_flow?.writes || [],
          calls: branch.data_flow?.external_calls || [],
          instantiations: branch.data_flow?.instantiations || []
        }))
      };
    });
}

export function createRagMcpServer() {
  const server = new McpServer({
    name: 'design-pattern-detector-rag',
    version: '1.0.0'
  });

  server.registerTool(
    'index_portfolio',
    {
      title: 'Indexar portafolio',
      description: 'Analiza un directorio JavaScript, genera embeddings de sus grafos y los guarda en ChromaDB.',
      inputSchema: {
        targetPath: z.string().min(1).describe('Ruta absoluta o relativa del archivo o directorio JavaScript a indexar')
      }
    },
    async ({ targetPath }) => {
      const indexedNodes = await indexGraphsInChroma(targetPath);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ targetPath, indexedNodes })
        }]
      };
    }
  );

  server.registerTool(
    'search_portfolio_graphs',
    {
      title: 'Buscar grafos del portafolio',
      description: 'Busca funciones relacionadas con un patrón y devuelve resultados ordenados por similitud. Cada resultado contiene symbol, file, inputs y branches; cada branch contiene branch, condition, reads, writes, calls e instantiations.',
      inputSchema: {
        query: z.string().min(1).describe('Descripción del patrón o del bloque de código que se desea encontrar'),
        nResults: z.number().int().min(1).max(50).default(5).describe('Número máximo de resultados')
      }
    },
    async ({ query, nResults }) => {
      const matches = await querySimilarGraphs(query, nResults);
      const formattedResults = formatGraphMatches(matches);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ query, results: formattedResults })
        }]
      };
    }
  );

  return server;
}

export async function startRagMcpServer() {
  const server = createRagMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && process.argv[1].endsWith('/mcpServer.js')) {
  startRagMcpServer().catch((error) => {
    console.error('Error iniciando el servidor MCP RAG:', error);
    process.exitCode = 1;
  });
}