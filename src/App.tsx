import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Check,
  Copy,
  Download,
  FileImage,
  Image as ImageIcon,
  Maximize2,
  Palette,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { Header } from './components/Header';
import { PrivacyTermsModal } from './components/PrivacyTermsModal';
import {
  MAX_FILE_SIZE_BYTES,
  SOCIAL_PRESETS,
  type ColorSwatch,
  type ImageItem,
  type SocialPreset,
  type ToolId,
} from './types/imageTools';
import { parseImageMetadata } from './utils/exifParser';
import {
  compressImage,
  convertToWebP,
  createSampleImage,
  extractBrandPalette,
  formatBytes,
  generatePaletteCardBlob,
  loadImageElement,
  resizeForSocial,
  stripExifAndGps,
  stripExtension,
} from './utils/imageProcessor';
import { buildZipBlob } from './utils/zipBuilder';

const ENABLE_PRO_LOCK = false;

interface ToolMeta {
  id: ToolId;
  shortTitle: string;
  title: string;
  instruction: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TOOLS: ToolMeta[] = [
  {
    id: 'webp',
    shortTitle: 'JPG/PNG to WebP',
    title: 'JPG/PNG to WebP Converter',
    instruction: 'Drop, paste (Ctrl+V), or load a sample to convert images to crisp WebP with transparency intact.',
    icon: ImageIcon,
  },
  {
    id: 'compress',
    shortTitle: 'Batch Compressor',
    title: 'Smart Batch Image Compressor',
    instruction: 'Upload or paste images, pick a quality level, and compare before vs. after file sizes instantly.',
    icon: Sliders,
  },
  {
    id: 'resize',
    shortTitle: 'Social Resizer',
    title: 'Bulk Social Media Resizer',
    instruction: 'Pick a Facebook, Instagram, YouTube, or LinkedIn size to resize batches without stretching.',
    icon: Maximize2,
  },
  {
    id: 'exif',
    shortTitle: 'EXIF & GPS Remover',
    title: 'EXIF & GPS Location Remover',
    instruction: 'Inspect hidden camera and GPS location data inside photos and strip it completely in 1 click.',
    icon: ShieldCheck,
  },
  {
    id: 'palette',
    shortTitle: 'Palette Extractor',
    title: 'Brand Color Palette Extractor',
    instruction: 'Upload any photo or logo to extract 6 main HEX and RGB brand color codes with 1-click copy.',
    icon: Palette,
  },
];

export default function App() {
  const [activeTool, setActiveTool] = useState<ToolId>('webp');
  const [items, setItems] = useState<ImageItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [showFallbackShare, setShowFallbackShare] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);

  // Tool 1: WebP option
  const [webpQuality, setWebpQuality] = useState<number>(90);

  // Tool 2: Compressor options
  const [compressQuality, setCompressQuality] = useState<number>(75);
  const [compressFormat, setCompressFormat] = useState<'auto' | 'jpeg' | 'webp'>('auto');

  // Tool 3: Social Media Resizer options
  const [selectedPreset, setSelectedPreset] = useState<SocialPreset>(SOCIAL_PRESETS[2]); // Instagram Square 1080x1080
  const [fitMode, setFitMode] = useState<'cover' | 'contain'>('cover');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorTimerRef = useRef<number | null>(null);
  const itemsRef = useRef<ImageItem[]>([]);
  itemsRef.current = items;

  const activeToolMeta = useMemo(
    () => TOOLS.find((t) => t.id === activeTool) ?? TOOLS[0],
    [activeTool]
  );

  // Automatic Dark Mode synced to OS preference (#0B1120 dark / #F8FAFC light)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = (dark: boolean) => {
      document.documentElement.classList.toggle('dark', dark);
    };
    applyTheme(mq.matches);
    const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        URL.revokeObjectURL(item.sourceUrl);
        if (item.processedUrl) URL.revokeObjectURL(item.processedUrl);
      }
      if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
    };
  }, []);

  const showAutoResetError = useCallback((msg: string) => {
    setErrorBanner(msg);
    if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = window.setTimeout(() => {
      setErrorBanner(null);
    }, 6000);
  }, []);

  const resetAll = useCallback(() => {
    for (const item of itemsRef.current) {
      URL.revokeObjectURL(item.sourceUrl);
      if (item.processedUrl) URL.revokeObjectURL(item.processedUrl);
    }
    setItems([]);
    setErrorBanner(null);
    setHasDownloaded(false);
    setShowFallbackShare(false);
    setShareFeedback(null);
    setIsProcessing(false);
  }, []);

  const handleSelectTool = (nextTool: ToolId) => {
    setActiveTool(nextTool);
    setErrorBanner(null);
    setHasDownloaded(false);
    setShowFallbackShare(false);
    // Clear processed outputs when switching tools so user gets clean Step 2 -> Step 3 flow on loaded images
    setItems((prev) =>
      prev.map((item) => {
        if (item.processedUrl) URL.revokeObjectURL(item.processedUrl);
        return {
          ...item,
          processedBlob: undefined,
          processedUrl: undefined,
          processedSize: undefined,
          processedName: undefined,
          processedWidth: undefined,
          processedHeight: undefined,
          processedExifReport: undefined,
          status: 'ready',
          errorMessage: undefined,
        };
      })
    );
  };

  const ingestFiles = useCallback(
    async (incoming: File[]) => {
      if (incoming.length === 0) return;
      setErrorBanner(null);
      setHasDownloaded(false);
      setShowFallbackShare(false);

      const accepted: ImageItem[] = [];
      const rejectedReasons: string[] = [];

      for (const file of incoming) {
        if (!file.type.startsWith('image/')) {
          rejectedReasons.push(`${file.name || 'File'} is not a supported image.`);
          continue;
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          rejectedReasons.push(`${file.name} exceeds the 30MB safety limit (${formatBytes(file.size)}).`);
          continue;
        }

        const sourceUrl = URL.createObjectURL(file);
        try {
          const img = await loadImageElement(sourceUrl);
          const [exifReport, palette] = await Promise.all([
            parseImageMetadata(file).catch(() => ({ hasMetadata: false, tags: [], orientation: 1 })),
            activeTool === 'palette'
              ? extractBrandPalette(file, 6).catch(() => [] as ColorSwatch[])
              : Promise.resolve(undefined),
          ]);

          accepted.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name: file.name || `pasted-image-${accepted.length + 1}.png`,
            originalType: file.type,
            originalSize: file.size,
            width: img.naturalWidth,
            height: img.naturalHeight,
            sourceUrl,
            file,
            exifReport,
            palette,
            status: palette ? 'done' : 'ready',
          });
        } catch {
          URL.revokeObjectURL(sourceUrl);
          rejectedReasons.push(`Could not read ${file.name || 'image'}. Auto-recovered safely.`);
        }
      }

      if (rejectedReasons.length > 0) {
        showAutoResetError(rejectedReasons[0]);
      }

      if (accepted.length > 0) {
        setItems((prev) => [...prev, ...accepted]);
      }
    },
    [activeTool, showAutoResetError]
  );

  // Auto-extract palette if user switched into Palette tool with existing images
  useEffect(() => {
    if (activeTool !== 'palette') return;
    const pending = items.filter((it) => !it.palette && it.status !== 'error');
    if (pending.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const target of pending) {
        try {
          const swatches = await extractBrandPalette(target.file, 6);
          if (cancelled) return;
          setItems((prev) =>
            prev.map((it) => (it.id === target.id ? { ...it, palette: swatches, status: 'done' } : it))
          );
        } catch {
          if (cancelled) return;
          setItems((prev) =>
            prev.map((it) =>
              it.id === target.id ? { ...it, status: 'error', errorMessage: 'Palette extraction failed.' } : it
            )
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTool, items]);

  // Global Ctrl+V / Cmd+V clipboard paste support
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const clipboardItems = e.clipboardData?.items;
      if (!clipboardItems) return;
      const pastedImages: File[] = [];
      for (let i = 0; i < clipboardItems.length; i++) {
        const entry = clipboardItems[i];
        if (entry.type.startsWith('image/')) {
          const blob = entry.getAsFile();
          if (blob) {
            const ext = entry.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
            pastedImages.push(new File([blob], `pasted-image-${Date.now()}.${ext}`, { type: entry.type }));
          }
        }
      }
      if (pastedImages.length > 0) {
        e.preventDefault();
        await ingestFiles(pastedImages);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [ingestFiles]);

  const handleTrySample = async () => {
    try {
      setErrorBanner(null);
      const sampleFile = await createSampleImage(activeTool);
      await ingestFiles([sampleFile]);
    } catch {
      showAutoResetError('Could not generate sample image. Resetting tool state.');
    }
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) {
        URL.revokeObjectURL(target.sourceUrl);
        if (target.processedUrl) URL.revokeObjectURL(target.processedUrl);
      }
      return prev.filter((i) => i.id !== id);
    });
  };

  const processBatch = async () => {
    if (ENABLE_PRO_LOCK) return;
    if (items.length === 0) {
      showAutoResetError('Upload, paste (Ctrl+V), or load a sample image first.');
      return;
    }

    setIsProcessing(true);
    setErrorBanner(null);
    setHasDownloaded(false);

    try {
      const updated = await Promise.all(
        items.map(async (item) => {
          if (item.processedUrl) URL.revokeObjectURL(item.processedUrl);

          try {
            if (activeTool === 'webp') {
              const res = await convertToWebP(item.file, webpQuality);
              const processedUrl = URL.createObjectURL(res.blob);
              return {
                ...item,
                processedBlob: res.blob,
                processedUrl,
                processedSize: res.blob.size,
                processedName: `${stripExtension(item.name)}.webp`,
                processedWidth: res.width,
                processedHeight: res.height,
                status: 'done' as const,
                errorMessage: undefined,
              };
            }

            if (activeTool === 'compress') {
              const res = await compressImage(item.file, compressQuality, compressFormat);
              const processedUrl = URL.createObjectURL(res.blob);
              return {
                ...item,
                processedBlob: res.blob,
                processedUrl,
                processedSize: res.blob.size,
                processedName: `${stripExtension(item.name)}-compressed.${res.ext}`,
                processedWidth: res.width,
                processedHeight: res.height,
                status: 'done' as const,
                errorMessage: undefined,
              };
            }

            if (activeTool === 'resize') {
              const res = await resizeForSocial(
                item.file,
                selectedPreset.width,
                selectedPreset.height,
                fitMode
              );
              const processedUrl = URL.createObjectURL(res.blob);
              const slug = `${selectedPreset.platform.toLowerCase()}-${selectedPreset.width}x${selectedPreset.height}`;
              return {
                ...item,
                processedBlob: res.blob,
                processedUrl,
                processedSize: res.blob.size,
                processedName: `${stripExtension(item.name)}-${slug}.${res.ext}`,
                processedWidth: res.width,
                processedHeight: res.height,
                status: 'done' as const,
                errorMessage: undefined,
              };
            }

            if (activeTool === 'exif') {
              const res = await stripExifAndGps(item.file);
              const cleanReport = await parseImageMetadata(res.blob);
              const processedUrl = URL.createObjectURL(res.blob);
              return {
                ...item,
                processedBlob: res.blob,
                processedUrl,
                processedSize: res.blob.size,
                processedName: `${stripExtension(item.name)}-clean.${res.ext}`,
                processedWidth: res.width,
                processedHeight: res.height,
                processedExifReport: cleanReport,
                status: 'done' as const,
                errorMessage: undefined,
              };
            }

            // Palette tool
            const swatches = await extractBrandPalette(item.file, 6);
            const cardBlob = await generatePaletteCardBlob(swatches, stripExtension(item.name));
            const processedUrl = URL.createObjectURL(cardBlob);
            return {
              ...item,
              palette: swatches,
              processedBlob: cardBlob,
              processedUrl,
              processedSize: cardBlob.size,
              processedName: `${stripExtension(item.name)}-palette.png`,
              processedWidth: 1200,
              processedHeight: 520,
              status: 'done' as const,
              errorMessage: undefined,
            };
          } catch {
            // Auto-Reset error recovery for individual corrupt items
            return {
              ...item,
              status: 'ready' as const,
              errorMessage: 'Processing failed — reset to ready state.',
            };
          }
        })
      );

      setItems(updated);
      const anyErrors = updated.some((u) => u.errorMessage);
      if (anyErrors) {
        showAutoResetError('One or more images failed to process and were safely reset.');
      }
    } catch {
      showAutoResetError('Unexpected error during processing. Auto-resetting workspace.');
    } finally {
      setIsProcessing(false);
    }
  };

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setHasDownloaded(true);
  };

  const handleDownloadSingle = async (item: ImageItem) => {
    if (activeTool === 'palette' && item.palette && !item.processedBlob) {
      const cardBlob = await generatePaletteCardBlob(item.palette, stripExtension(item.name));
      triggerBlobDownload(cardBlob, `${stripExtension(item.name)}-palette.png`);
      return;
    }
    if (item.processedBlob && item.processedName) {
      triggerBlobDownload(item.processedBlob, item.processedName);
    }
  };

  const handleDownloadZip = async () => {
    try {
      const zipFiles: Array<{ name: string; data: Blob | string }> = [];

      for (const item of items) {
        if (activeTool === 'palette' && item.palette) {
          const cardBlob =
            item.processedBlob || (await generatePaletteCardBlob(item.palette, stripExtension(item.name)));
          zipFiles.push({ name: `${stripExtension(item.name)}-palette.png`, data: cardBlob });
          const cssVars = item.palette.map((c, idx) => `  --brand-${idx + 1}: ${c.hex}; /* ${c.rgb} */`).join('\n');
          zipFiles.push({
            name: `${stripExtension(item.name)}-palette.css`,
            data: `:root {\n${cssVars}\n}\n`,
          });
        } else if (item.processedBlob && item.processedName) {
          zipFiles.push({ name: item.processedName, data: item.processedBlob });
        }
      }

      if (zipFiles.length === 0) return;
      const zipBlob = await buildZipBlob(zipFiles);
      triggerBlobDownload(zipBlob, `spark-image-${activeTool}-batch.zip`);
    } catch {
      showAutoResetError('ZIP packaging failed. Try downloading individual files instead.');
    }
  };

  const handleCopyColor = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCode(text);
      window.setTimeout(() => setCopiedCode((prev) => (prev === text ? null : prev)), 1500);
    } catch {
      showAutoResetError('Clipboard permission denied by browser.');
    }
  };

  const handleShare = async () => {
    const shareData = {
      title: 'Spark Image — Private Offline Image Editor',
      text: 'I just edited my images offline in seconds with Spark Image (100% private, zero uploads).',
      url: window.location.href,
    };

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
        setShareFeedback('Shared successfully.');
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    setShowFallbackShare((prev) => !prev);
  };

  const processedItems = items.filter(
    (it) => it.status === 'done' && (it.processedBlob || (activeTool === 'palette' && it.palette))
  );

  const totalOriginalBytes = processedItems.reduce((acc, it) => acc + it.originalSize, 0);
  const totalProcessedBytes = processedItems.reduce((acc, it) => acc + (it.processedSize ?? it.originalSize), 0);
  const totalSavedPercent =
    totalOriginalBytes > 0
      ? Math.round(((totalOriginalBytes - totalProcessedBytes) / totalOriginalBytes) * 100)
      : 0;

  const groupedPresets = useMemo(() => {
    const platforms: Array<SocialPreset['platform']> = ['Facebook', 'Instagram', 'YouTube', 'LinkedIn'];
    return platforms.map((platform) => ({
      platform,
      presets: SOCIAL_PRESETS.filter((p) => p.platform === platform),
    }));
  }, []);

  const primaryActionLabel = useMemo(() => {
    if (isProcessing) return 'Processing...';
    switch (activeTool) {
      case 'webp':
        return items.length > 1 ? `Convert ${items.length} Images to WebP` : 'Convert to WebP';
      case 'compress':
        return items.length > 1 ? `Compress ${items.length} Images` : 'Compress Image';
      case 'resize':
        return `Resize to ${selectedPreset.width} × ${selectedPreset.height}`;
      case 'exif':
        return items.length > 1 ? `Remove EXIF & GPS (${items.length})` : 'Remove EXIF & GPS';
      case 'palette':
        return 'Refresh Palette & Card';
    }
  }, [activeTool, isProcessing, items.length, selectedPreset]);

  const shareTextEncoded = encodeURIComponent(
    `Check out Spark Image — 100% private offline image editor: ${window.location.href}`
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#F8FAFC] text-[#0F172A] dark:bg-[#0B1120] dark:text-slate-100">
      <Header />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {/* Compact 5-Tool Selector Bar */}
        <nav aria-label="Image Tools" className="mb-6">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              const isActive = tool.id === activeTool;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => handleSelectTool(tool.id)}
                  aria-pressed={isActive}
                  className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'border-[#6366F1] bg-[#6366F1] text-white'
                      : 'border-[#E2E8F0] bg-white text-[#0F172A] hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{tool.shortTitle}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Main Workspace Card */}
        <section
          aria-labelledby="active-tool-heading"
          className="rounded-2xl border border-[#E2E8F0] bg-white p-5 sm:p-7 dark:border-slate-800 dark:bg-slate-900"
        >
          {/* Tool Heading & 1-Line Simple Instruction */}
          <div className="flex flex-col justify-between gap-3 border-b border-[#E2E8F0] pb-5 sm:flex-row sm:items-center dark:border-slate-800">
            <div>
              <h1
                id="active-tool-heading"
                className="text-2xl font-bold tracking-tight text-[#0F172A] dark:text-white"
              >
                {activeToolMeta.title}
              </h1>
              <p className="mt-1 text-base text-slate-600 dark:text-slate-300">
                {activeToolMeta.instruction}
              </p>
            </div>

            {items.length > 0 && (
              <button
                type="button"
                onClick={resetAll}
                className="inline-flex min-h-[44px] items-center gap-2 self-start rounded-xl border border-[#E2E8F0] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                <span>Start Over</span>
              </button>
            )}
          </div>

          {/* Inline Error Recovery Banner */}
          {errorBanner && (
            <div
              role="alert"
              className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-base text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200"
            >
              <span>{errorBanner}</span>
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                className="min-h-[44px] px-3 text-sm font-semibold underline whitespace-nowrap shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* 3-Step Horizontal Flow */}
          <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12">
            {/* LEFT COLUMN: Step 1 (Upload/Paste) & Step 2 (Choose Option) */}
            <div className="space-y-6 lg:col-span-5">
              {/* STEP 1 */}
              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-[#6366F1] dark:text-indigo-400">
                    1. Upload or Paste (Ctrl+V)
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Max 30MB per image</span>
                </div>

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const files = Array.from(e.dataTransfer.files);
                    await ingestFiles(files);
                  }}
                  className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                    isDragging
                      ? 'border-[#6366F1] bg-[#6366F1]/5'
                      : 'border-[#E2E8F0] bg-[#F8FAFC] dark:border-slate-700 dark:bg-[#0B1120]'
                  }`}
                >
                  <Upload className="h-7 w-7 text-[#6366F1] dark:text-indigo-400" aria-hidden="true" />
                  <p className="mt-2 text-base font-semibold text-[#0F172A] dark:text-white">
                    Drop images here or press Ctrl+V
                  </p>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                    Supports JPG, PNG, WebP · Batch ready
                  </p>

                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,image/gif,image/bmp"
                    className="sr-only"
                    onChange={async (e) => {
                      const files = e.target.files ? Array.from(e.target.files) : [];
                      e.target.value = '';
                      await ingestFiles(files);
                    }}
                  />

                  <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#6366F1] px-5 py-2.5 text-base font-semibold text-white transition-colors hover:bg-indigo-600 whitespace-nowrap shrink-0"
                    >
                      <FileImage className="h-4 w-4" aria-hidden="true" />
                      <span>Choose Images</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleTrySample}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-4 py-2.5 text-base font-semibold text-[#0F172A] transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
                    >
                      <Sparkles className="h-4 w-4 text-[#6366F1] dark:text-indigo-400" aria-hidden="true" />
                      <span>Try Sample</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* STEP 2: Tool-specific options */}
              <div className="border-t border-[#E2E8F0] pt-6 dark:border-slate-800">
                <span className="mb-3 block text-sm font-bold text-[#6366F1] dark:text-indigo-400">
                  2. Choose Option
                </span>

                {activeTool === 'webp' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-base">
                      <span className="font-medium">WebP Quality</span>
                      <span className="font-mono-tabular font-semibold">{webpQuality}%</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Compact (75%)', val: 75 },
                        { label: 'Balanced (90%)', val: 90 },
                        { label: 'Crisp (98%)', val: 98 },
                      ].map((opt) => (
                        <button
                          key={opt.val}
                          type="button"
                          onClick={() => setWebpQuality(opt.val)}
                          className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm font-semibold transition-colors whitespace-nowrap ${
                            webpQuality === opt.val
                              ? 'border-[#6366F1] bg-[#6366F1]/10 text-[#6366F1] dark:bg-[#6366F1]/20 dark:text-indigo-300'
                              : 'border-[#E2E8F0] bg-[#F8FAFC] text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Transparent PNG backgrounds stay 100% transparent.
                    </p>
                  </div>
                )}

                {activeTool === 'compress' && (
                  <div className="space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between text-base">
                        <label htmlFor="compress-quality" className="font-medium">
                          Compression Quality
                        </label>
                        <span className="font-mono-tabular font-semibold">{compressQuality}%</span>
                      </div>
                      <input
                        id="compress-quality"
                        type="range"
                        min={15}
                        max={95}
                        step={5}
                        value={compressQuality}
                        onChange={(e) => setCompressQuality(Number(e.target.value))}
                        className="spark-slider w-full"
                      />
                      <div className="mt-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>Smaller file</span>
                        <span>Higher detail</span>
                      </div>
                    </div>

                    <div>
                      <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Output Format
                      </span>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: 'auto' as const, label: 'Auto Best' },
                          { id: 'jpeg' as const, label: 'JPEG' },
                          { id: 'webp' as const, label: 'WebP' },
                        ].map((fmt) => (
                          <button
                            key={fmt.id}
                            type="button"
                            onClick={() => setCompressFormat(fmt.id)}
                            className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm font-semibold transition-colors whitespace-nowrap ${
                              compressFormat === fmt.id
                                ? 'border-[#6366F1] bg-[#6366F1]/10 text-[#6366F1] dark:bg-[#6366F1]/20 dark:text-indigo-300'
                                : 'border-[#E2E8F0] bg-[#F8FAFC] text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {fmt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeTool === 'resize' && (
                  <div className="space-y-4">
                    <div className="space-y-3">
                      {groupedPresets.map((group) => (
                        <div key={group.platform}>
                          <span className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {group.platform}
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {group.presets.map((preset) => {
                              const active = selectedPreset.id === preset.id;
                              return (
                                <button
                                  key={preset.id}
                                  type="button"
                                  onClick={() => setSelectedPreset(preset)}
                                  className={`min-h-[44px] rounded-xl border px-3 py-2 text-left text-sm font-semibold transition-colors whitespace-nowrap ${
                                    active
                                      ? 'border-[#6366F1] bg-[#6366F1]/10 text-[#6366F1] dark:bg-[#6366F1]/20 dark:text-indigo-300'
                                      : 'border-[#E2E8F0] bg-[#F8FAFC] text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                                  }`}
                                >
                                  <span>{preset.label}</span>
                                  <span className="ml-1.5 font-mono-tabular text-xs opacity-75">
                                    {preset.width}×{preset.height}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setFitMode('cover')}
                        className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm font-semibold transition-colors whitespace-nowrap ${
                          fitMode === 'cover'
                            ? 'border-[#6366F1] bg-[#6366F1]/10 text-[#6366F1] dark:bg-[#6366F1]/20 dark:text-indigo-300'
                            : 'border-[#E2E8F0] bg-[#F8FAFC] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                        }`}
                      >
                        Center Crop (Fill)
                      </button>
                      <button
                        type="button"
                        onClick={() => setFitMode('contain')}
                        className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm font-semibold transition-colors whitespace-nowrap ${
                          fitMode === 'contain'
                            ? 'border-[#6366F1] bg-[#6366F1]/10 text-[#6366F1] dark:bg-[#6366F1]/20 dark:text-indigo-300'
                            : 'border-[#E2E8F0] bg-[#F8FAFC] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                        }`}
                      >
                        Fit Inside (No Crop)
                      </button>
                    </div>
                  </div>
                )}

                {activeTool === 'exif' && (
                  <div className="space-y-3">
                    <p className="text-base text-slate-700 dark:text-slate-300">
                      Removes hidden GPS coordinates, camera serial/model, timestamps, and XMP/IPTC tags cleanly
                      by re-encoding pixels in memory.
                    </p>
                    {items.length === 0 && (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Click &ldquo;Try Sample&rdquo; above to test with a sample JPEG containing real GPS &amp; camera data.
                      </p>
                    )}
                  </div>
                )}

                {activeTool === 'palette' && (
                  <div className="space-y-3">
                    <p className="text-base text-slate-700 dark:text-slate-300">
                      Automatically extracts the 6 dominant brand colors from any logo or photo. Tap any swatch
                      to copy HEX or RGB.
                    </p>
                  </div>
                )}

                {/* Primary Step 2 Execution CTA */}
                <button
                  type="button"
                  disabled={items.length === 0 || isProcessing}
                  onClick={processBatch}
                  className="mt-5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#6366F1] px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span>{primaryActionLabel}</span>
                </button>
              </div>
            </div>

            {/* RIGHT COLUMN: Step 3 (Queue, Inspector, Output & Download) */}
            <div className="border-t border-[#E2E8F0] pt-6 lg:col-span-7 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8 dark:border-slate-800">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-bold text-[#6366F1] dark:text-indigo-400">
                  3. Preview &amp; Download
                </span>

                {processedItems.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDownloadZip}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#0F172A] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-[#6366F1] dark:hover:bg-indigo-600"
                  >
                    <Archive className="h-4 w-4" aria-hidden="true" />
                    <span>Download All as ZIP ({processedItems.length})</span>
                  </button>
                )}
              </div>

              {/* Batch Compressor Summary Strip */}
              {activeTool === 'compress' && processedItems.length > 0 && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
                  <span>
                    Before: <strong className="font-mono-tabular">{formatBytes(totalOriginalBytes)}</strong>
                    {' → '}
                    After: <strong className="font-mono-tabular">{formatBytes(totalProcessedBytes)}</strong>
                  </span>
                  <span className="font-mono-tabular font-bold">
                    {totalSavedPercent >= 0 ? `${totalSavedPercent}% smaller` : `${Math.abs(totalSavedPercent)}% larger`}
                  </span>
                </div>
              )}

              {/* Empty State */}
              {items.length === 0 ? (
                <div className="flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-8 text-center dark:border-slate-800 dark:bg-[#0B1120]">
                  <ImageIcon className="h-10 w-10 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                  <p className="mt-3 text-base font-semibold text-[#0F172A] dark:text-white">
                    No images loaded yet
                  </p>
                  <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                    Upload files, paste from clipboard (Ctrl+V), or click &ldquo;Try Sample&rdquo; on the left.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#E2E8F0] rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] dark:divide-slate-800 dark:border-slate-800 dark:bg-[#0B1120]">
                  {items.map((item) => {
                    const savedPct =
                      item.processedSize !== undefined && item.originalSize > 0
                        ? Math.round(((item.originalSize - item.processedSize) / item.originalSize) * 100)
                        : null;

                    return (
                      <div key={item.id} className="p-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          {/* Thumbnail + File Stats */}
                          <div className="flex min-w-0 items-center gap-3.5">
                            <img
                              src={item.processedUrl || item.sourceUrl}
                              alt={item.name}
                              referrerPolicy="no-referrer"
                              className="h-16 w-16 shrink-0 rounded-lg border border-[#E2E8F0] bg-white object-cover dark:border-slate-700 dark:bg-slate-800"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-base font-semibold text-[#0F172A] dark:text-white">
                                {item.processedName || item.name}
                              </p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                                <span className="font-mono-tabular">
                                  {item.processedWidth ?? item.width} × {item.processedHeight ?? item.height}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono-tabular">
                                  {formatBytes(item.originalSize)}
                                  {item.processedSize !== undefined && (
                                    <>
                                      {' → '}
                                      <strong className="text-[#0F172A] dark:text-white">
                                        {formatBytes(item.processedSize)}
                                      </strong>
                                    </>
                                  )}
                                </span>
                                {savedPct !== null && activeTool !== 'palette' && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span
                                      className={`font-mono-tabular font-semibold ${
                                        savedPct >= 0
                                          ? 'text-emerald-700 dark:text-emerald-400'
                                          : 'text-amber-700 dark:text-amber-400'
                                      }`}
                                    >
                                      {savedPct >= 0 ? `-${savedPct}%` : `+${Math.abs(savedPct)}%`}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Row Actions */}
                          <div className="flex items-center gap-2 shrink-0">
                            {(item.processedBlob || (activeTool === 'palette' && item.palette)) && (
                              <button
                                type="button"
                                onClick={() => handleDownloadSingle(item)}
                                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[#6366F1] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-600 whitespace-nowrap"
                              >
                                <Download className="h-4 w-4" aria-hidden="true" />
                                <span>Download</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => removeItem(item.id)}
                              aria-label={`Remove ${item.name}`}
                              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[#E2E8F0] bg-white text-slate-600 hover:bg-slate-100 hover:text-red-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        {/* Tool 4: EXIF & GPS Metadata Inspector */}
                        {activeTool === 'exif' && (
                          <div className="mt-3 border-t border-[#E2E8F0] pt-3 dark:border-slate-800">
                            {item.processedExifReport ? (
                              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                                Verified clean: 0 EXIF or GPS metadata tags remaining.
                              </p>
                            ) : item.exifReport?.hasMetadata ? (
                              <div>
                                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                                  Found {item.exifReport.tags.length} hidden metadata tags:
                                </p>
                                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
                                  {item.exifReport.tags.map((tag, idx) => (
                                    <div key={`${tag.label}-${idx}`} className="flex justify-between gap-2">
                                      <dt className="text-slate-500 dark:text-slate-400">{tag.label}:</dt>
                                      <dd
                                        className={`font-mono-tabular truncate font-medium ${
                                          tag.sensitive
                                            ? 'text-red-700 dark:text-red-400'
                                            : 'text-[#0F172A] dark:text-slate-200'
                                        }`}
                                      >
                                        {tag.value}
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                              </div>
                            ) : (
                              <p className="text-sm text-slate-500 dark:text-slate-400">
                                No EXIF or GPS metadata detected in source file (you can still re-save to strip any hidden chunks).
                              </p>
                            )}
                          </div>
                        )}

                        {/* Tool 5: Brand Color Palette Extractor Swatches */}
                        {activeTool === 'palette' && item.palette && item.palette.length > 0 && (
                          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {item.palette.map((swatch, idx) => (
                              <div
                                key={`${swatch.hex}-${idx}`}
                                className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white dark:border-slate-700 dark:bg-slate-900"
                              >
                                <div
                                  className="h-14 w-full"
                                  style={{ backgroundColor: swatch.hex }}
                                  aria-label={`Color swatch ${swatch.hex}`}
                                />
                                <div className="p-2.5">
                                  <button
                                    type="button"
                                    onClick={() => handleCopyColor(swatch.hex)}
                                    className="flex min-h-[44px] w-full items-center justify-between gap-1 rounded-lg px-2 text-left font-mono-tabular text-sm font-bold text-[#0F172A] hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800"
                                  >
                                    <span>{swatch.hex}</span>
                                    {copiedCode === swatch.hex ? (
                                      <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCopyColor(swatch.rgb)}
                                    className="flex min-h-[36px] w-full items-center justify-between gap-1 rounded-lg px-2 text-left font-mono-tabular text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                                  >
                                    <span className="truncate">{swatch.rgb}</span>
                                    {copiedCode === swatch.rgb ? (
                                      <span className="text-emerald-600 font-semibold">Copied</span>
                                    ) : (
                                      <Copy className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
                                    )}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Viral Sharing & Tip Revealed After Download */}
              {hasDownloaded && (
                <div className="mt-5 rounded-xl border border-[#6366F1]/30 bg-[#6366F1]/5 p-4 dark:border-[#6366F1]/40 dark:bg-[#6366F1]/10">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <p className="text-sm font-medium text-[#0F172A] dark:text-slate-100">
                      Want to combine these images into a PDF?{' '}
                      <a href="#" className="font-semibold text-[#6366F1] underline dark:text-indigo-300">
                        Try Spark PDF
                      </a>
                    </p>

                    <button
                      type="button"
                      onClick={handleShare}
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#6366F1] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-600 whitespace-nowrap shrink-0"
                    >
                      <Share2 className="h-4 w-4" aria-hidden="true" />
                      <span>Share via WhatsApp / Email</span>
                    </button>
                  </div>

                  {shareFeedback && (
                    <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{shareFeedback}</p>
                  )}

                  {showFallbackShare && (
                    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[#6366F1]/20 pt-3 text-sm">
                      <a
                        href={`https://api.whatsapp.com/send?text=${shareTextEncoded}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[44px] items-center rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
                      >
                        Send via WhatsApp
                      </a>
                      <a
                        href={`mailto:?subject=${encodeURIComponent('Spark Image — Offline Image Editor')}&body=${shareTextEncoded}`}
                        className="inline-flex min-h-[44px] items-center rounded-lg border border-[#E2E8F0] bg-white px-4 py-2 font-semibold text-[#0F172A] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        Send via Email
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Bottom-Only Footer */}
      <footer className="border-t border-[#E2E8F0] bg-white py-5 dark:border-slate-800 dark:bg-[#0B1120]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-center text-sm text-slate-600 sm:flex-row sm:px-6 sm:text-left dark:text-slate-400">
          <p>100% Private • Works Offline (Test in Airplane Mode) • Powered by Spark Lab</p>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setLegalOpen(true)}
              className="min-h-[44px] px-1 font-medium text-[#0F172A] underline-offset-4 hover:underline dark:text-slate-200"
            >
              Privacy &amp; Terms
            </button>
            <a
              href="mailto:support@sparklab.app?subject=Spark%20Image%20Issue%20Report"
              className="inline-flex min-h-[44px] items-center px-1 font-medium text-[#0F172A] underline-offset-4 hover:underline dark:text-slate-200"
            >
              Report Issue
            </a>
          </div>
        </div>
      </footer>

      <PrivacyTermsModal open={legalOpen} onClose={() => setLegalOpen(false)} />
    </div>
  );
}
