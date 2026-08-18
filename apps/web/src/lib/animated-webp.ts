/**
 * Whether a WEBP file is an animated one.
 *
 * Worth knowing at upload time because animated WEBP is the one format the
 * site accepts that cannot move everywhere it is shown. Telegram has no
 * message type that plays it — sendAnimation takes GIF and silent H.264 only,
 * sendDocument is a file card, and the sticker formats are static .webp,
 * Lottie .tgs and VP9 .webm — so the announce feed posts a still frame of it
 * and there is nothing apps/api can do about that at send time. A creator who
 * uploaded a moving picture should hear it here, while GIF is still a choice
 * they can make, rather than discover it in the channel after broadcast.
 *
 * WEBP is a RIFF container: "RIFF" <size> "WEBP" then chunks. Animation
 * requires the extended header, so the first chunk is "VP8X" and its flags
 * byte carries the ANIMATION bit. A plain still is "VP8 " or "VP8L" and never
 * reaches the flag test.
 */
const ANIMATION_FLAG = 0x02;

const fourcc = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

export function isAnimatedWebp(data: ArrayBuffer | Uint8Array): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // 21 bytes: the 12-byte RIFF/WEBP header, the 8-byte VP8X chunk header, and
  // the flags byte itself at offset 20. Anything shorter cannot be animated.
  if (bytes.length < 21) return false;
  if (fourcc(bytes, 0) !== "RIFF" || fourcc(bytes, 8) !== "WEBP") return false;
  if (fourcc(bytes, 12) !== "VP8X") return false;
  return (bytes[20] & ANIMATION_FLAG) !== 0;
}

/**
 * The same question asked of a picked file. Reads only the header.
 *
 * Deliberately does not check file.type first. The sniff above already
 * requires the RIFF/WEBP magic, so a declared type adds nothing but a way to
 * miss: a browser reports "" for a file dragged from some sources, and a
 * renamed extension reports whatever the name implies. The bytes are the only
 * thing that actually knows.
 */
export async function fileIsAnimatedWebp(file: File): Promise<boolean> {
  return isAnimatedWebp(await file.slice(0, 32).arrayBuffer());
}
