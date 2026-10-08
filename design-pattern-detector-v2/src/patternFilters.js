import * as parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import path from 'path';
import fs from 'fs';

const traverse = traverseModule.default || traverseModule;

// Centralizamos las carpetas a ignorar. 
// SE QUITARON: 'lib', 'build', 'public', 'static', 'examples' para no perder código de negocio.
const IGNORED_DIRECTORIES = [
  'node_modules', '.git', '.github', 'dist', 
  'coverage', 'vendor', '.next', 'out', 'test', 'tests', 
  'spec', 'specs', 'fixtures', 'assets', 'docs', 'tmp', 'e2e'
];

// Lista de librerías comunes de frontend/utilidad que ensucian el RAG
const IGNORED_LIBRARIES = [
  'three.js', 'orbitcontrols.js', 'jquery.js', 'bootstrap.js', 
  'react.js', 'vue.js', 'angular.js', 'd3.js', 'chart.js', 
  'lodash.js', 'moment.js', 'rxjs.js'
];

export function shouldIgnoreFile(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();

  if (IGNORED_DIRECTORIES.some(dir => normalizedPath.includes(`/${dir}/`))) return true;
  if (IGNORED_LIBRARIES.includes(fileName)) return true;

  const isTestFile = 
    fileName.includes('.test.') || fileName.includes('.spec.') ||
    fileName.endsWith('_test.js') || fileName.endsWith('_spec.js') ||
    fileName.includes('.mock.') || normalizedPath.includes('/tests/') ||
    normalizedPath.includes('/__tests__/') || normalizedPath.includes('/spec/');

  if (isTestFile) return true;

  const isIgnoredFileType = 
    fileName.endsWith('.min.js') || fileName.endsWith('.bundle.js') ||
    fileName.endsWith('.config.js') || fileName.startsWith('.');

  if (isIgnoredFileType) return true;

  return !fileName.endsWith('.js') && !fileName.endsWith('.mjs') && !fileName.endsWith('.cjs');
}

export function getAllValidJsFiles(dirPath, arrayOfFiles = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      const dirName = file.toLowerCase();
      if (!IGNORED_DIRECTORIES.includes(dirName)) {
        getAllValidJsFiles(fullPath, arrayOfFiles);
      }
    } else {
      if (!shouldIgnoreFile(fullPath)) arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

function parseAST(code) {
  try {
    return parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'objectRestSpread', 'optionalChaining', 'asyncGenerators']
    });
  } catch (error) {
    return null;
  }
}

function getFunctionName(pathNode) {
  if (pathNode.node.key?.name) return pathNode.node.key.name;
  if (pathNode.node.id?.name) return pathNode.node.id.name;
  if (pathNode.parentPath?.isAssignmentExpression()) {
    return pathNode.parentPath.node.left.property?.name || pathNode.parentPath.get('left').toString();
  }
  if (pathNode.parentPath?.isVariableDeclarator()) {
    return pathNode.parentPath.node.id?.name;
  }
  return null;
}

function extractBranchDataFlow(pathNode) {
  const reads = new Set();
  const writes = new Set();
  const externalCalls = new Set();
  const instantiations = new Set();

  pathNode.traverse({
    Identifier(idPath) {
      if (idPath.parentPath.isMemberExpression({ property: idPath.node }) && !idPath.parentPath.node.computed) {
        return;
      }
      if (idPath.isReferencedIdentifier()) {
        reads.add(idPath.node.name);
      }
    },
    AssignmentExpression(aPath) {
      if (aPath.node.left.type === 'Identifier') {
        writes.add(aPath.node.left.name);
      }
    },
    VariableDeclarator(vPath) {
      if (vPath.node.id.type === 'Identifier') {
        writes.add(vPath.node.id.name);
      }
    },
    NewExpression(nPath) {
      instantiations.add(nPath.get('callee').toString());
    },
    CallExpression(cPath) {
      const calleeStr = cPath.get('callee').toString();
      if (!calleeStr.startsWith('new ')) {
        externalCalls.add(calleeStr);
      }
    }
  });

  return {
    reads: Array.from(reads),
    writes: Array.from(writes),
    external_calls: Array.from(externalCalls),
    instantiations: Array.from(instantiations)
  };
}

export function buildFunctionGraph(code, filePath = '') {
  if (filePath && shouldIgnoreFile(filePath)) return { hasGraphs: false, graphs: [] };

  const ast = parseAST(code);
  if (!ast) return { hasGraphs: false, graphs: [] };

  const graphs = [];

  traverse(ast, {
    Function(pathNode) {
      const funcName = getFunctionName(pathNode);
      if (!funcName || funcName === 'constructor') return;

      const params = pathNode.node.params.map(p => p.name || p.type);
      const branchesGraph = [];
      let hasControlBranches = false;

      pathNode.traverse({
        Function(nestedPath) { nestedPath.skip(); },

        SwitchStatement(sPath) {
          if (sPath.node.cases.length >= 2) {
            hasControlBranches = true;
            const discriminant = sPath.get('discriminant').toString();

            sPath.node.cases.forEach((cNode, idx) => {
              const caseLabel = cNode.test ? sPath.get(`cases.${idx}.test`).toString() : 'default';
              const branchData = extractBranchDataFlow(sPath.get(`cases.${idx}`));

              branchesGraph.push({
                branch_id: `case_${caseLabel}`,
                condition: `${discriminant} === ${caseLabel}`,
                data_flow: branchData
              });
            });
          }
        },

        IfStatement(iPath) {
          if (!iPath.parentPath.isIfStatement() && iPath.node.alternate) {
            hasControlBranches = true;
            let currentIf = iPath;

            while (currentIf && currentIf.isIfStatement()) {
              const testCond = currentIf.get('test').toString();
              const consequentData = extractBranchDataFlow(currentIf.get('consequent'));

              branchesGraph.push({
                branch_id: `if_branch_${branchesGraph.length + 1}`,
                condition: testCond,
                data_flow: consequentData
              });

              if (currentIf.node.alternate && currentIf.node.alternate.type === 'IfStatement') {
                currentIf = currentIf.get('alternate');
              } else {
                if (currentIf.node.alternate) {
                  const alternateData = extractBranchDataFlow(currentIf.get('alternate'));
                  branchesGraph.push({
                    branch_id: `else_branch`,
                    condition: 'default/else',
                    data_flow: alternateData
                  });
                }
                currentIf = null;
              }
            }
          }
        }
      });

      if (hasControlBranches && branchesGraph.length >= 2) {
        graphs.push({
          symbol: funcName,
          file: filePath,
          signature: `${funcName}(${params.join(', ')})`,
          graph: {
            inputs: params,
            control_flow_type: branchesGraph[0].branch_id.startsWith('case_') ? 'Switch' : 'IfElse',
            branches_count: branchesGraph.length,
            branches: branchesGraph
          }
        });
      }
    }
  });

  return { hasGraphs: graphs.length > 0, graphs };
}