export type PhotoWorkshopAspectRatio =
  | 'smart'
  | '1:1'
  | '3:4'
  | '4:3'
  | '16:9'
  | '9:16'
  | '2:3'
  | '3:2'
  | '21:9';

export type PhotoWorkshopResolution = '1K' | '2K';

export interface PhotoWorkshopImageResult {
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface PhotoWorkshopSnapshot {
  sourceFile: File;
  sourceUrl: string;
  prompt: string;
  aspectRatio: PhotoWorkshopAspectRatio;
  resolution: PhotoWorkshopResolution;
}

export interface PhotoWorkshopHistoryEntry extends PhotoWorkshopSnapshot {
  id: string;
  createdAt: Date;
  result: PhotoWorkshopImageResult;
}

