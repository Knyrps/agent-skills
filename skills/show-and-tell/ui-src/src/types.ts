// What the page hands down. Nothing below a page knows about chrome.* or storage; it gets these.

/** One entry of the conversation with the session in front. */
export interface ChatMessage {
  role?: 'user';
  /** Agent entries: what kind of thing it did. */
  kind?: 'activity' | 'request' | 'point' | 'say';
  text?: string;
  ts: number;
  /** User entries: attachment labels ("Annotation · 2"), and whether the bridge took the message. */
  att?: string[];
  acked?: boolean;
  /** Activity: how many browser actions the entry stands for. */
  count?: number;
  /** Point: where it pointed. */
  host?: string;
  selector?: string;
}

export interface VideoView {
  state: 'starting' | 'countdown' | 'recording' | 'finishing';
  count?: number;
  width: number;
  height: number;
  step: number;
  steps: number;
}

export type PauseState = 'paused' | 'held' | 'armed';
/** What the user picked on the pause card. */
export type PauseChoice = 'resume' | 'remove' | 'again' | 'skip' | 'drop' | 'held' | 'armed';
export type HostDecision = 'no' | 'session' | 'always';
export type AllowMode = 'session' | 'always';
export type Suggestion = 'annotate' | 'record' | 'ask';
export type AttachmentKind = 'annotation' | 'recording';
