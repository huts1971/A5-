import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const motionRoot = path.join(projectRoot, 'public', 'avatar', 'uketsukejou151', 'motions');
const expected = new Map([
  ['welcome_wave_08.fbx', 'welcome'],
  ['idle_neutral_04.fbx', 'idle'],
  ['idle_head_nod_19.fbx', 'idle'],
  ['think_looking_14.fbx', 'thinking'],
  ['talk_basic_14.fbx', 'speaking'],
  ['talk_basic_15.fbx', 'speaking'],
  ['talk_confirm_32.fbx', 'speaking'],
  ['talk_waist_48.fbx', 'speaking'],
]);

const found = fs.readdirSync(motionRoot).filter((file) => file.toLowerCase().endsWith('.fbx'));
for (const file of expected.keys()) {
  if (!found.includes(file)) {
    throw new Error(`[verify-avatar151-motions] missing ${file}`);
  }
}

const byGroup = {};
for (const group of expected.values()) {
  byGroup[group] = (byGroup[group] ?? 0) + 1;
}

console.log(
  `[verify-avatar151-motions] ok: ${found.length} FBX motions, groups=${Object.entries(byGroup)
    .map(([group, count]) => `${group}:${count}`)
    .join(', ')}`,
);
