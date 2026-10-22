// How the board and the counters are shown. These choices belong to the viewer, not to a game:
// they never change a game's rules or record, so they are saved on their own.
export const DISPLAY_KEY = 'surface-go:display:v1';
export const MARK_KEYS = ['alive', 'dead', 'atari', 'territory'];
export const COUNTERS = {
  captures: '取った石',
  capturesAndPasses: '取った石＋相手のパス',
  stones: '盤上の石',
  area: '盤上の石＋地'
};
export const DEFAULT_DISPLAY = {marks: {alive: false, dead: false, atari: false, territory: false}, counter: 'captures'};

export const marksShown = display => MARK_KEYS.some(key => display.marks[key]);

// Counts for black and white (index 1 and 2) under one counter choice. Komi is not included.
export function counterValues(game, counter) {
  const captures = game.captures;
  if (counter === 'capturesAndPasses') {
    const passes = game.passCounts();
    return [0, captures[1] + passes[2], captures[2] + passes[1]];
  }
  if (counter === 'stones' || counter === 'area') {
    const score = game.score();
    return counter === 'stones' ? [0, score.stonesBlack, score.stonesWhite] : [0, score.stonesBlack + score.territoryBlack, score.stonesWhite + score.territoryWhite];
  }
  return [0, captures[1], captures[2]];
}

// Saved data is only trusted field by field: anything unknown falls back to the default.
export function normalizeDisplay(data) {
  const marks = data !== null && typeof data === 'object' && data.marks !== null && typeof data.marks === 'object' ? data.marks : {};
  return {
    marks: Object.fromEntries(MARK_KEYS.map(key => [key, marks[key] === true])),
    counter: typeof data?.counter === 'string' && Object.hasOwn(COUNTERS, data.counter) ? data.counter : DEFAULT_DISPLAY.counter
  };
}

export function loadDisplay(storage) {
  try {
    storage ??= window.localStorage;
    const raw = storage.getItem(DISPLAY_KEY);
    return normalizeDisplay(raw === null ? null : JSON.parse(raw));
  } catch {
    return normalizeDisplay(null);
  }
}

export function saveDisplay(display, storage) {
  try {
    storage ??= window.localStorage;
    storage.setItem(DISPLAY_KEY, JSON.stringify(normalizeDisplay(display)));
    return true;
  } catch {
    return false;
  }
}
