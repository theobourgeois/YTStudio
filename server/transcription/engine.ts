/**
 * The seam between Auto captions and whoever turns speech into words: a
 * transcription engine takes a 16 kHz mono WAV and returns timed words. The
 * service (`service.ts`) does everything around it (decoding, squeezing out
 * silences, caching, jobs), so an engine is only the model call. To add one
 * (another API, another local model), implement this and register it in
 * `service.ts`.
 */
import type { SetUpEngineRequest, TranscriptWord, TranscriptionEngineId, TranscriptionEngineInfo } from "../../shared/types.ts";

export interface EngineResult {
  /** ISO 639-1 code, when the engine says. */
  language: string | null;
  /** Times in seconds from the start of the WAV file. */
  words: TranscriptWord[];
}

export interface TranscribeOptions {
  /** "auto", or an ISO 639-1 code. */
  language: string;
  signal: AbortSignal;
  /** 0..1 through this file. */
  onProgress: (fraction: number) => void;
  /** A temporary file path (removed by the caller afterwards). */
  tmpFile: (suffix: string) => string;
}

export interface TranscriptionEngine {
  readonly id: TranscriptionEngineId;
  /** Names the model (and settings) the words come from: cached transcripts are only reused for the same one. */
  readonly model: string;
  info(): Promise<TranscriptionEngineInfo>;
  /** Local: start installing what's missing (returns straight away). Cloud: check and save the API key. */
  setUp(body: SetUpEngineRequest): Promise<void>;
  /** Cloud: forget the saved API key. */
  forget?(): Promise<void>;
  transcribe(wav: string, opts: TranscribeOptions): Promise<EngineResult>;
}

/** Scripts written without spaces between words: each piece is a word of its own. */
const UNSPACED = /[぀-ヿ㐀-䶿一-鿿豈-﫿฀-๿က-႟]/;

/**
 * Words from the pieces a model outputs (tokens, or words without their
 * punctuation): a piece starting with a space starts a word, anything else
 * joins the word before it (the rest of a word, punctuation, "'s"), except
 * in scripts written without spaces. Words keep their leading space.
 */
export function wordsFromPieces(pieces: readonly { text: string; start: number; end: number }[]): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  for (const piece of pieces) {
    if (!piece.text || /^\s+$/.test(piece.text)) continue;
    const last = words.at(-1);
    const startsWord = !last || /^\s/.test(piece.text) || UNSPACED.test(piece.text[0]) || UNSPACED.test(last.text.at(-1)!);
    if (startsWord) {
      words.push({ text: piece.text.replace(/^\s+/, " "), start: piece.start, end: Math.max(piece.start, piece.end) });
    } else {
      last.text += piece.text;
      last.end = Math.max(last.end, piece.end);
    }
  }
  return words;
}

/** Prompting with a line of punctuated text keeps Whisper writing sentences with capitals and punctuation. */
export const ENGLISH_STYLE_PROMPT = "Hi! How are you? I'm good, thanks.";
