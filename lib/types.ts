export type FishModel = "s2.1-pro" | "s2-pro" | "s1";
export type OutputFormat = "mp3" | "wav" | "opus" | "pcm";
export type Engine = "gateway" | "fish";
export type BibleCitationStyle = "compact" | "narrated";

export interface BibleCitationSettings {
  enabled: boolean;
  style: BibleCitationStyle;
}

export interface VoiceSample {
  title: string;
  text: string;
  task_id: string;
  audio: string;
}

export interface VoiceItem {
  _id: string;
  type?: string;
  title: string;
  description?: string;
  cover_image?: string;
  state?: string;
  tags?: string[];
  samples?: VoiceSample[];
  languages?: string[];
  visibility?: string;
  like_count?: number;
  mark_count?: number;
  task_count?: number;
  author?: { _id: string; nickname: string; avatar?: string };
  created_at?: string;
}

export interface VoiceListResponse {
  total: number;
  items: VoiceItem[];
  window_limited?: boolean;
}

export interface TtsControls {
  outputFormat: OutputFormat;
  mp3Bitrate: 64 | 128 | 192;
  opusBitrate: 24000 | 32000 | 48000 | 64000;
  sampleRate: 44100 | 48000;
  latency: "low" | "normal" | "balanced";
  speed: number; // 0.5 - 2
  volume: number; // dB, -30 .. +12
  normalizeLoudness: boolean;
  useCreativity: boolean;
  temperature: number; // 0 - 1
  topP: number; // 0 - 1
  useAdvanced: boolean;
  chunkLength: number; // 100 - 300
  minChunkLength?: number;
  conditionOnPreviousChunks: boolean;
  qualityGuard: boolean;
}

export interface TtsRequestPayload {
  engine: Engine;
  model: FishModel;
  freeSuffix: boolean;
  text: string;
  voice?: string;
  voices?: string[];
  controls: TtsControls;
}

export interface TtsResponse {
  audio: string; // base64
  warnings?: string[];
  model: string;
  chars: number;
}

export interface TranscriptSegment {
  text: string;
  start?: number;
  end?: number;
}

export interface TranscribeResponse {
  text: string;
  segments: TranscriptSegment[];
  language?: string;
  durationInSeconds?: number;
  warnings?: string[];
}

export interface GenerationResult {
  id: string;
  ts: number;
  text: string;
  model: FishModel;
  engine: Engine;
  voiceTitles: string[];
  format: OutputFormat;
  warnings: string[];
  blobUrl: string;
  size: number;
  chunks: number;
  chars: number;
  ms: number;
}
