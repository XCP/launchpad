export type CounterpartyContentKind = 'text' | 'binary'

export const TEXTUAL_APPLICATION_MIME_TYPES = new Set([
  'application/xml',
  'application/javascript',
  'application/ecmascript',
  'application/x-javascript',
  'application/json',
  'application/manifest+json',
  'application/x-python-code',
  'application/x-sh',
  'application/x-csh',
  'application/x-tex',
  'application/x-latex',
  'application/postscript',
  'application/yaml',
  'application/x-yaml',
  'application/sql',
])

export const COUNTERPARTY_SAFE_MIME_TYPES = new Set([
  'application/atom+xml',
  'application/ecmascript',
  'application/gzip',
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/manifest+json',
  'application/msword',
  'application/n-quads',
  'application/n-triples',
  'application/octet-stream',
  'application/oda',
  'application/ogg',
  'application/pdf',
  'application/pkcs7-mime',
  'application/postscript',
  'application/rss+xml',
  'application/sql',
  'application/trig',
  'application/vnd.apple.mpegurl',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/wasm',
  'application/x-7z-compressed',
  'application/x-bcpio',
  'application/x-bzip',
  'application/x-bzip2',
  'application/x-cpio',
  'application/x-csh',
  'application/x-dvi',
  'application/x-gtar',
  'application/x-hdf',
  'application/x-hdf5',
  'application/x-javascript',
  'application/x-latex',
  'application/x-mif',
  'application/x-netcdf',
  'application/x-pkcs12',
  'application/x-pn-realaudio',
  'application/x-python-code',
  'application/x-rar-compressed',
  'application/x-sh',
  'application/x-shar',
  'application/x-shockwave-flash',
  'application/x-sv4cpio',
  'application/x-sv4crc',
  'application/x-tar',
  'application/x-tcl',
  'application/x-tex',
  'application/x-texinfo',
  'application/x-troff',
  'application/x-troff-man',
  'application/x-troff-me',
  'application/x-troff-ms',
  'application/x-ustar',
  'application/x-wais-source',
  'application/x-yaml',
  'application/xhtml+xml',
  'application/xml',
  'application/yaml',
  'application/zip',
  'audio/3gpp',
  'audio/3gpp2',
  'audio/aac',
  'audio/basic',
  'audio/flac',
  'audio/midi',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/webm',
  'audio/x-aiff',
  'audio/x-flac',
  'audio/x-m4a',
  'audio/x-pn-realaudio',
  'audio/x-wav',
  'font/otf',
  'font/ttf',
  'font/woff',
  'font/woff2',
  'image/apng',
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/ief',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/tiff',
  'image/vnd.microsoft.icon',
  'image/webp',
  'image/x-cmu-raster',
  'image/x-icon',
  'image/x-portable-anymap',
  'image/x-portable-bitmap',
  'image/x-portable-graymap',
  'image/x-portable-pixmap',
  'image/x-rgb',
  'image/x-xbitmap',
  'image/x-xpixmap',
  'image/x-xwindowdump',
  'message/rfc822',
  'model/gltf+json',
  'model/gltf-binary',
  'model/stl',
  'text/css',
  'text/csv',
  'text/html',
  'text/javascript',
  'text/markdown',
  'text/n3',
  'text/plain',
  'text/richtext',
  'text/tab-separated-values',
  'text/vtt',
  'text/x-python',
  'text/x-rst',
  'text/x-setext',
  'text/x-sgml',
  'text/x-vcard',
  'text/xml',
  'text/yaml',
  'video/3gpp',
  'video/3gpp2',
  'video/mp4',
  'video/mpeg',
  'video/ogg',
  'video/quicktime',
  'video/webm',
  'video/x-flv',
  'video/x-matroska',
  'video/x-msvideo',
  'video/x-sgi-movie',
])

for (const mimeType of TEXTUAL_APPLICATION_MIME_TYPES) {
  COUNTERPARTY_SAFE_MIME_TYPES.add(mimeType)
}

export function baseMimeType(mimeType: string | null | undefined): string {
  return (mimeType || 'text/plain').split(';')[0].trim().toLowerCase()
}

export function normalizeMimeType(mimeType: string | null | undefined, fallback = 'text/plain'): string {
  const value = (mimeType || fallback).trim()
  return value || fallback
}

export function classifyCounterpartyMimeType(mimeType: string | null | undefined): CounterpartyContentKind {
  const base = baseMimeType(mimeType)
  if (
    base.startsWith('text/') ||
    base.startsWith('message/') ||
    base.endsWith('+xml') ||
    base.endsWith('+json') ||
    TEXTUAL_APPLICATION_MIME_TYPES.has(base)
  ) {
    return 'text'
  }
  return 'binary'
}

export function isCounterpartySafeMimeType(mimeType: string | null | undefined): boolean {
  return COUNTERPARTY_SAFE_MIME_TYPES.has(baseMimeType(mimeType))
}

