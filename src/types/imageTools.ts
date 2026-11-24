export type ToolId = 'webp' | 'compress' | 'resize' | 'exif' | 'palette';

export interface ExifTagEntry {
  label: string;
  value: string;
  sensitive?: boolean;
}

export interface ExifReport {
  hasMetadata: boolean;
  tags: ExifTagEntry[];
  orientation: number;
}

export interface ColorSwatch {
  hex: string;
  rgb: string;
  r: number;
  g: number;
  b: number;
  percentage: number;
}

export interface ImageItem {
  id: string;
  name: string;
  originalType: string;
  originalSize: number;
  width: number;
  height: number;
  sourceUrl: string;
  file: File;
  exifReport?: ExifReport;
  processedBlob?: Blob;
  processedUrl?: string;
  processedSize?: number;
  processedName?: string;
  processedWidth?: number;
  processedHeight?: number;
  processedExifReport?: ExifReport;
  palette?: ColorSwatch[];
  status: 'ready' | 'processing' | 'done' | 'error';
  errorMessage?: string;
}

export interface SocialPreset {
  id: string;
  platform: 'Facebook' | 'Instagram' | 'YouTube' | 'LinkedIn';
  label: string;
  width: number;
  height: number;
}

export const SOCIAL_PRESETS: SocialPreset[] = [
  { id: 'fb-post', platform: 'Facebook', label: 'Post / Link', width: 1200, height: 630 },
  { id: 'fb-cover', platform: 'Facebook', label: 'Cover', width: 820, height: 312 },
  { id: 'ig-square', platform: 'Instagram', label: 'Square', width: 1080, height: 1080 },
  { id: 'ig-portrait', platform: 'Instagram', label: 'Portrait', width: 1080, height: 1350 },
  { id: 'ig-story', platform: 'Instagram', label: 'Story / Reel', width: 1080, height: 1920 },
  { id: 'yt-thumb', platform: 'YouTube', label: 'Thumbnail', width: 1280, height: 720 },
  { id: 'yt-banner', platform: 'YouTube', label: 'Banner', width: 2560, height: 1440 },
  { id: 'li-post', platform: 'LinkedIn', label: 'Post', width: 1200, height: 627 },
  { id: 'li-banner', platform: 'LinkedIn', label: 'Banner', width: 1584, height: 396 },
];

export const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024; // 30MB file size guard
