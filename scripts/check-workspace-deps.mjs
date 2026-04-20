#!/usr/bin/env node
/**
 * Aethelred Wallet - Workspace-level dependency graph validator.
 *
 * Reads every `packages/* / package.json` and `apps/* / package.json`
 * in the workspace and constructs the directed graph of internal
 * @aethelred/* dependencies. Detects cycles with depth-first search
 * and prints the graph in Mermaid syntax for humans and CI artifacts.
 *
 * Invariant enforced: the dependency graph of internal packages is a
 * DAG. Common rot pattern in large monorepos: `packages/foo` depends
 * on `packages/bar`, and later someone adds a `bar -> foo` edge
 * because "it works." At build time both packages get transpiled and
 * module resolution handles it, but import ordering becomes
 * non-deterministic and subtle bugs surface at runtime. We catch the
 * cycle at the package-manifest layer before it lands.
 *
 * Exit codes:
 *   0 - graph is acyclic; all dependency edges resolve
 *   1 - cycle detected OR reference to an unknown @aethelred/* package
 *   2 - configuration error (missing directory, invalid JSON)
 */

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const WORKSPACE_ROOTS = ["packages", "apps"];
const INTERNAL_SCOPE = "@aethelred/";

function listWorkspaceManifests() {
  const manifests = [];
  for (const root of WORKSPACE_ROOTS) {
    const rootDir = resolve(repoRoot, root);
    if (!existsSync(rootDir)) continue;
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgJsonPath = join(rootDir, entry.name, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      let json;
      try {
        json = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      } catch (err) {
        console.error(`Invalid JSON: ${pkgJsonPath}: ${err.message}`);
        process.exit(2);
      }
      manifests.push({
        name: json.name,
        deps: {
          ...(json.dependencies ?? {}),
          ...(json.devDependencies ?? {}),
          ...(json.peerDependencies ?? {}),
        },
        optionalDeps: { ...(json.peerDependencies ?? {}) },
        path: `${root}/${entry.name}/package.json`,
      });
    }
  }
  return manifests;
}

/**
 * Build the adjacency list. Only internal @aethelred/* edges are
 * included; third-party packages are irrelevant for cycle detection.
 *
 * Also returns the set of known package names so we can flag
 * references to packages that don't exist in the workspace.
 */
function buildGraph(manifests) {
  const knownNames = new Set(manifests.map((m) => m.name));
  const graph = new Map();
  for (const m of manifests) {
    const edges = [];
    for (const depName of Object.keys(m.deps)) {
      if (!depName.startsWith(INTERNAL_SCOPE)) continue;
      if (!knownNames.has(depName)) {
        // Reference to a package not present in the workspace.
        console.error(
          `${m.path}: depends on ${depName}, but no package with that name exists in the workspace.`,
        );
        process.exit(1);
      }
      edges.push(depName);
    }
    graph.set(m.name, edges.sort());
  }
  return graph;
}

/**
 * DFS cycle detection. Returns an array of cycles; each cycle is the
 * list of package names in visit order. Walks the graph from every
 * root so disconnected components are checked too.
 */
function findCycles(graph) {
  const cycles = [];
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map([...graph.keys()].map((n) => [n, WHITE]));
  const parent = new Map();

  function dfs(node, path) {
    color.set(node, GRAY);
    path.push(node);
    for (const next of graph.get(node) ?? []) {
      const c = color.get(next);
      if (c === GRAY) {
        // Back edge - slice the path from the first occurrence of `next`.
        const i = path.indexOf(next);
        cycles.push([...path.slice(i), next]);
      } else if (c === WHITE) {
        parent.set(next, node);
        dfs(next, path);
      }
    }
    path.pop();
    color.set(node, BLACK);
  }

  for (const node of graph.keys()) {
    if (color.get(node) === WHITE) dfs(node, []);
  }
  return cycles;
}

/**
 * Emit the graph as Mermaid. Mermaid renders inline in GitHub issue
 * comments and markdown reports, which is handy for the CI artifact.
 */
function toMermaid(graph) {
  const lines = ["flowchart LR"];
  for (const [node, edges] of [...graph.entries()].sort()) {
    const short = node.replace(INTERNAL_SCOPE, "");
    if (edges.length === 0) {
      lines.push(`  ${short}`);
    } else {
      for (const e of edges) {
        const eShort = e.replace(INTERNAL_SCOPE, "");
        lines.push(`  ${short} --> ${eShort}`);
      }
    }
  }
  return lines.join("\n");
}

function emitReport(graph) {
  const reportsDir = resolve(repoRoot, "reports");
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const mermaidPath = resolve(reportsDir, "workspace-deps.mmd");
  const jsonPath = resolve(reportsDir, "workspace-deps.json");
  writeFileSync(mermaidPath, toMermaid(graph) + "\n");
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        nodes: [...graph.keys()].sort(),
        edges: [...graph.entries()]
          .flatMap(([from, tos]) => tos.map((to) => ({ from, to })))
          .sort((a, b) =>
            a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from),
          ),
      },
      null,
      2,
    ) + "\n",
  );
  return { mermaidPath, jsonPath };
}

function main() {
  const manifests = listWorkspaceManifests();
  if (manifests.length === 0) {
    console.error("No workspace manifests found under packages/ or apps/.");
    process.exit(2);
  }

  const graph = buildGraph(manifests);
  const cycles = findCycles(graph);
  const { mermaidPath, jsonPath } = emitReport(graph);

  // Print the mermaid diagram to stdout too so CI logs carry it.
  console.log("Workspace dependency graph (Mermaid):");
  console.log("");
  console.log(toMermaid(graph));
  console.log("");
  console.log(`Graph artifacts:`);
  console.log(`  ${mermaidPath}`);
  console.log(`  ${jsonPath}`);
  console.log("");

  if (cycles.length === 0) {
    console.log(`Workspace dep gate: OK (${graph.size} packages, DAG verified).`);
    return;
  }

  console.error(`Workspace dep gate: FAIL (${cycles.length} cycle(s) detected).`);
  console.error("");
  for (const [i, cycle] of cycles.entries()) {
    console.error(`Cycle ${i + 1}:`);
    console.error(`  ${cycle.join(" -> ")}`);
    console.error("");
  }
  console.error(
    "Fix: remove one of the edges so the graph is a DAG. Long-term,",
  );
  console.error(
    "     packages closer to the trust kernel (core, connect) should be",
  );
  console.error("     leaves; consumer packages are always parents.");
  process.exit(1);
}

main();
