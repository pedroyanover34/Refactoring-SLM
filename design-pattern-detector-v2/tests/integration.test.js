import test from 'node:test';
import assert from 'node:assert/strict';

const originalLog = console.log;
const originalError = console.error;

const withCapturedConsole = async (fn) => {
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));

  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return lines;
};

test('import of ragChroma should not start the CLI pipeline automatically', async () => {
  const output = await withCapturedConsole(async () => {
    await import('../src/ragChroma.js');
  });

  assert.ok(
    !output.some(line => line.includes('Iniciando pipeline') || line.includes('Leyendo y serializando subgrafos')),
    'Importing ragChroma should not trigger the CLI pipeline'
  );
});

test('MCP server exposes indexing and search tools', async () => {
  const { createRagMcpServer } = await import('../src/mcpServer.js');
  const server = createRagMcpServer();

  assert.deepEqual(Object.keys(server._registeredTools).sort(), [
    'index_portfolio',
    'search_portfolio_graphs'
  ]);
});

test('formats retrieved graphs with ordered branch data for the language model', async () => {
  const { formatGraphMatches } = await import('../src/mcpServer.js');
  const results = formatGraphMatches([
    {
      id: 'second',
      distance: 0.8,
      symbol: 'handleRequest',
      file: 'lib/request.js',
      raw_graph: {
        inputs: ['request'],
        branches: [{
          branch_id: 'else_branch',
          condition: 'default/else',
          data_flow: {
            reads: ['listener'],
            writes: ['response'],
            external_calls: ['listener.notify'],
            instantiations: ['Observer']
          }
        }]
      }
    },
    {
      id: 'first',
      distance: 0.2,
      symbol: 'dispatch',
      file: 'lib/events.js',
      raw_graph: { inputs: [], branches: [] }
    }
  ]);

  assert.deepEqual(results, [
    {
      id: 'first',
      distance: 0.2,
      symbol: 'dispatch',
      file: 'lib/events.js',
      inputs: [],
      branches: []
    },
    {
      id: 'second',
      distance: 0.8,
      symbol: 'handleRequest',
      file: 'lib/request.js',
      inputs: ['request'],
      branches: [{
        branch: 'else_branch',
        condition: 'default/else',
        reads: ['listener'],
        writes: ['response'],
        calls: ['listener.notify'],
        instantiations: ['Observer']
      }]
    }
  ]);
});
