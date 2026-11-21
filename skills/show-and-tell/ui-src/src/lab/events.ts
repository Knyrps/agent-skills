// The raw DOM events the debug panel can show, by group. Every row shows the real event name; a note only
// where the name does not explain itself. The log says "hover start" and "focus" for the events whose DOM
// names are least obvious.
export interface EventType { type: string; note: string; label: string }
export interface EventGroup { name: string; types: EventType[] }

const group = (name: string, ...types: [type: string, note?: string, label?: string][]): EventGroup =>
  ({ name, types: types.map(([type, note = '', label = type]) => ({ type, note, label })) });

export const GROUPS: EventGroup[] = [
  group('Pointer', ['pointerdown'], ['pointerup'], ['pointermove'], ['pointercancel', 'the browser took over the gesture, e.g. to scroll']),
  group('Hover', ['mouseover', 'hover start', 'hover start'], ['mouseout', 'hover end', 'hover end']),
  group('Mouse', ['click'], ['dblclick'], ['auxclick', 'middle or other non-primary button'], ['contextmenu'], ['wheel']),
  group('Keyboard', ['keydown'], ['keyup']),
  group('Focus', ['focusin', 'focus, also from inside components', 'focus'], ['focusout', 'blur, also from inside components', 'blur']),
  group('Input', ['beforeinput', 'just before a field\'s value changes'], ['input'], ['change'],
    ['compositionstart', 'IME or dead-key input begins'], ['compositionend', 'IME or dead-key input ends']),
  group('Touch', ['touchstart'], ['touchmove'], ['touchend'], ['touchcancel']),
  group('Drag', ['dragstart'], ['drag'], ['dragenter'], ['dragover'], ['dragleave'], ['drop'], ['dragend']),
  group('Scroll', ['scroll']),
  group('Clipboard', ['copy'], ['cut'], ['paste']),
  group('Page', ['visibilitychange', 'the tab was hidden or shown'], ['resize'], ['pageshow', 'also when restored from the back/forward cache']),
];
export const LABELS: Record<string, string> = Object.fromEntries(GROUPS.flatMap(g => g.types.map(t => [t.type, t.label])));
