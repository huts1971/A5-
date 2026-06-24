import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [lingShanSource, nianhuaBaySource] = process.argv.slice(2);
if (!lingShanSource || !nianhuaBaySource) {
  throw new Error(
    'Usage: node scripts/import-simple-road-networks.mjs <ling-shan.json> <nianhua-bay.json>',
  );
}

const root = resolve(import.meta.dirname, '..');
const routesDir = resolve(root, 'knowledge', 'routes');
const frontendNetworkDir = resolve(
  root,
  'frontend',
  'public',
  'scenic',
  'networks',
);

const sourceByMap = {
  'ling-shan': lingShanSource,
  'nianhua-bay': nianhuaBaySource,
};

function normalizeCoordinate(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`Invalid normalized coordinate: ${value}`);
  }
  return Number(number.toFixed(6));
}

function normalizeNetwork(source, expectedMapId) {
  if (source.map_id !== expectedMapId) {
    throw new Error(
      `Expected map_id ${expectedMapId}, received ${source.map_id}`,
    );
  }

  const sourceNodes = new Map(
    (source.nodes ?? []).map((node) => [node.id, node]),
  );
  const edgeIds = new Set();
  const referencedNodeIds = new Set();
  const edges = (source.edges ?? []).map((edge) => {
    if (edgeIds.has(edge.id)) {
      throw new Error(`Duplicate road edge id: ${edge.id}`);
    }
    edgeIds.add(edge.id);
    if (
      !sourceNodes.has(edge.from_node_id) ||
      !sourceNodes.has(edge.to_node_id)
    ) {
      throw new Error(`Road edge ${edge.id} references a missing node`);
    }
    if (!Array.isArray(edge.points) || edge.points.length < 2) {
      throw new Error(`Road edge ${edge.id} needs at least two points`);
    }
    referencedNodeIds.add(edge.from_node_id);
    referencedNodeIds.add(edge.to_node_id);
    return {
      id: edge.id,
      from_node_id: edge.from_node_id,
      to_node_id: edge.to_node_id,
      points: edge.points.map((point) => ({
        x_ratio: normalizeCoordinate(point.x_ratio),
        y_ratio: normalizeCoordinate(point.y_ratio),
      })),
    };
  });

  const nodes = [...referencedNodeIds]
    .map((nodeId) => {
      const node = sourceNodes.get(nodeId);
      return {
        id: node.id,
        x_ratio: normalizeCoordinate(node.x_ratio),
        y_ratio: normalizeCoordinate(node.y_ratio),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    id: source.id,
    map_id: source.map_id,
    data_version: source.data_version,
    status: 'provisional',
    is_active: true,
    source_note:
      '用户人工描绘的游客可走道路。所有道路统一按普通双向步行处理，时间仅为地图粗略估算。',
    map_width: Number(source.map_width),
    map_height: Number(source.map_height),
    nodes,
    edges,
  };
}

function countComponents(network) {
  const adjacency = new Map(network.nodes.map((node) => [node.id, []]));
  for (const edge of network.edges) {
    adjacency.get(edge.from_node_id).push(edge.to_node_id);
    adjacency.get(edge.to_node_id).push(edge.from_node_id);
  }
  const visited = new Set();
  let count = 0;
  for (const node of network.nodes) {
    if (visited.has(node.id)) continue;
    count += 1;
    const queue = [node.id];
    visited.add(node.id);
    while (queue.length) {
      const current = queue.shift();
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return count;
}

const networks = {};
for (const [mapId, sourcePath] of Object.entries(sourceByMap)) {
  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  const network = normalizeNetwork(source, mapId);
  networks[mapId] = network;
  await writeFile(
    resolve(routesDir, `${network.id}.json`),
    `${JSON.stringify(network, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `${mapId}: ${network.nodes.length} nodes, ${network.edges.length} edges, ${countComponents(network)} component(s)`,
  );
}

const anchors = {
  data_version: 'road-time-anchors-v1',
  anchors: [
    {
      id: 'anchor_ling_shan_001',
      map_id: 'ling-shan',
      from_spot_id: 'spot_ls_003',
      to_spot_id: 'spot_ling_shan_buddha',
      observed_minutes: 25,
      measurement_type: 'rough_reference',
      confidence: 0.55,
      source_note: '用户提供：佛足坛到灵山大佛正常步行约25分钟。',
    },
    {
      id: 'anchor_nianhua_bay_001',
      map_id: 'nianhua-bay',
      from_spot_id: 'spot_nh_001',
      to_spot_id: 'spot_nh_002',
      observed_minutes: 10,
      measurement_type: 'rough_reference',
      confidence: 0.55,
      source_note: '用户提供：拈花广场到梵天花海正常步行约10分钟。',
    },
  ],
};
await writeFile(
  resolve(routesDir, 'road-time-anchors-v1.json'),
  `${JSON.stringify(anchors, null, 2)}\n`,
  'utf8',
);

await mkdir(frontendNetworkDir, { recursive: true });
await writeFile(
  resolve(frontendNetworkDir, 'road-network-seed-v1.js'),
  `globalThis.SCENIC_ROAD_NETWORK_SEED = ${JSON.stringify(
    {
      networks,
      anchors: anchors.anchors,
    },
    null,
    2,
  )};\n`,
  'utf8',
);
