const spotImageBase = '/scenic/spots';
const spotPhotoBase = `${spotImageBase}/photos`;

export const spotImageMap: Record<string, string> = {
  spot_ls_entrance: `${spotImageBase}/service.svg`,
  spot_ls_001: `${spotPhotoBase}/LS-001_灵山大照壁/1.jpg`,
  spot_ls_002: `${spotPhotoBase}/LS-002_五明桥/2.jpg`,
  spot_ls_003: `${spotPhotoBase}/LS-003_佛足坛/1.jpg`,
  spot_ls_004: `${spotPhotoBase}/LS-004_五智门/1.jpg`,
  spot_ls_005: `${spotPhotoBase}/LS-005_菩提大道/1.jpg`,
  spot_nine_dragons: `${spotPhotoBase}/LS-006_九龙灌浴/1.jpg`,
  spot_ls_007: `${spotPhotoBase}/LS-007_降魔浮雕/2.jpg`,
  spot_ls_008: `${spotPhotoBase}/LS-008_阿育王柱/2.jpg`,
  spot_ls_009: `${spotPhotoBase}/LS-009_百子戏弥勒/1.jpg`,
  spot_xiangfu_temple: `${spotPhotoBase}/LS-010_祥符禅寺/1.jpg`,
  spot_ling_shan_buddha: `${spotPhotoBase}/LS-011_灵山大佛/1.jpg`,
  spot_ls_012: `${spotPhotoBase}/LS-012_佛教文化博览馆/1.jpg`,
  spot_brahma_palace: `${spotPhotoBase}/LS-013_灵山梵宫/2.jpg`,
  spot_five_mudra_mandala: `${spotPhotoBase}/LS-014_五印坛城/2.jpg`,
  spot_ls_015: `${spotPhotoBase}/LS-015_曼飞龙塔/1.jpg`,
  spot_ls_016: `${spotPhotoBase}/LS-016_无尽意斋/2.jpg`,
  spot_nh_entrance: `${spotImageBase}/service.svg`,
  spot_nh_001: `${spotPhotoBase}/NH-001_拈花广场/2.jpg`,
  spot_nh_002: `${spotPhotoBase}/NH-002_梵天花海/2.jpg`,
  spot_nh_003: `${spotPhotoBase}/NH-003_香月花街/2.jpg`,
  spot_nh_004: `${spotPhotoBase}/NH-004_拈花堂/2.jpg`,
  spot_nh_005: `${spotPhotoBase}/NH-005_五灯湖/2.jpg`,
  spot_nh_006: `${spotPhotoBase}/NH-006_鹿鸣谷/1.jpg`,
  'yuanxiang-hall': `${spotImageBase}/lake.svg`,
  'xiaofeihong-bridge': `${spotImageBase}/bridge-water.svg`,
  'lotus-wind-pavilion': `${spotImageBase}/garden-path.svg`,
  'bonsai-garden': `${spotImageBase}/flower-field.svg`,
  'visitor-service': `${spotImageBase}/service.svg`,
};

export const fallbackSpotImage = `${spotImageBase}/default.svg`;

/**
 * The browser cannot enumerate files in `public`, so the scenic photo sequence
 * is deliberately kept as an explicit manifest.  The directory portion still
 * comes from `spotImageMap`, keeping the source of truth for each scenic spot
 * in one place.
 */
const spotPhotoFiles: Record<string, readonly string[]> = {
  spot_ls_001: ['1.jpg', '2.jpg', '3.jpg'],
  spot_ls_002: ['1.jpg', '2.jpg', '3.jpg'],
  spot_ls_003: ['1.jpg', '2.jpg'],
  spot_ls_004: ['1.jpg', '2.jpg', '3.jpg'],
  spot_ls_005: ['1.jpg', '2.jpg'],
  spot_nine_dragons: ['1.jpg', '2.jpg', '3.jpg'],
  spot_ls_007: ['1.jpg', '2.jpg', '3.jpg'],
  spot_ls_008: ['1.jpg', '2.jpg', '3.jpg'],
  spot_ls_009: ['1.jpg', '2.jpg', '3.jpg'],
  spot_xiangfu_temple: ['1.jpg', '2.jpg', '3.jpg'],
  spot_ling_shan_buddha: ['1.jpg', '2.jpg', '3.jpg'],
  spot_ls_012: ['1.jpg', '2.jpg'],
  spot_brahma_palace: ['1.jpg', '2.jpg', '3.jpg'],
  spot_five_mudra_mandala: ['1.jpg', '2.jpg', '3.jpg'],
  spot_ls_015: ['1.jpg', '2.jpg', '3.jpg'],
  spot_ls_016: ['1.jpg', '2.jpg'],
  spot_nh_001: ['1.jpg', '2.jpg'],
  spot_nh_002: ['1.jpg', '2.jpg'],
  spot_nh_003: ['1.jpeg', '2.jpg'],
  spot_nh_004: ['1.jpg', '2.jpg', '3.jpg'],
  spot_nh_005: ['1.jpg', '2.jpg', '3.jpg'],
  spot_nh_006: ['1.jpg', '2.jpg', '3.jpg'],
};

export function resolveSpotImage(spotId: string, backendImageUrl?: string): string {
  const trimmed = backendImageUrl?.trim();
  if (trimmed) {
    return trimmed;
  }

  return spotImageMap[spotId] ?? fallbackSpotImage;
}

export function resolveSpotPhotos(spotId: string, fallbackImage?: string): string[] {
  const files = spotPhotoFiles[spotId];
  const coverImage = spotImageMap[spotId];

  if (files && coverImage) {
    const directoryEnd = coverImage.lastIndexOf('/');
    if (directoryEnd > 0) {
      const directory = coverImage.slice(0, directoryEnd);
      return files.map((file) => `${directory}/${file}`);
    }
  }

  return [fallbackImage || coverImage || fallbackSpotImage];
}
