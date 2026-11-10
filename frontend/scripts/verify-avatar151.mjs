import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const avatarRoot = path.join(projectRoot, 'public', 'avatar', 'uketsukejou151');
const requiredFiles = [
  'avatar-151-chat.svg',
  'manifest.json',
  'model/uketsukejou_1.0.vrm',
  'motions/welcome_wave_08.fbx',
  'motions/idle_neutral_04.fbx',
  'motions/idle_head_nod_19.fbx',
  'motions/think_looking_14.fbx',
  'motions/talk_basic_14.fbx',
  'motions/talk_basic_15.fbx',
  'motions/talk_confirm_32.fbx',
  'motions/talk_waist_48.fbx',
  'unity-webgl/Build/avatar151-guide.loader.js',
  'unity-webgl/Build/avatar151-guide.data',
  'unity-webgl/Build/avatar151-guide.framework.js',
  'unity-webgl/Build/avatar151-guide.wasm',
];

for (const relativePath of requiredFiles) {
  const filePath = path.join(avatarRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`[verify-avatar151] missing ${relativePath}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.size) {
    throw new Error(`[verify-avatar151] empty file ${relativePath}`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(avatarRoot, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
if (manifest.id !== 'uketsukejou151') {
  throw new Error('[verify-avatar151] manifest id should be uketsukejou151');
}

console.log(`[verify-avatar151] ok: ${requiredFiles.length} avatar files are present.`);
