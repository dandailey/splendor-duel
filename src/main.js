import { isStraightLine } from './engine/tokens.js';
import "./style.css";
import { aiModeAvailable, vsComputer, enableComputer, disableComputer, applyGameInto,
  rememberedLevel, rememberLevel, levelPickerHtml, summaryBannerHtml, scheduleComputerTurn } from './ai/vs-computer.js';
import cardsCsv from "./splendor_cards.csv?raw";
import { buildPushMeta, buildLobbyMeta } from "./push-meta.js";
import { nativePushAvailable, nativePush } from "./native-push.js";
import {
  awardPrivilege,
  consumeExtraTurn,
  createTurnState,
  getOpponentTurnsSinceLastLocalTurn,
  queueExtraTurn,
  resetGamePieces,
  spendPrivilege
} from "./game-rules.js";

let allCards = [];
let pyramidCards = { level1: [], level2: [], level3: [] };

const GAME_TYPE_PREFIX = "splendor_duel_";

// Game state structure
const gameState = {
  decks: {
    level1: [],
    level2: [],
    level3: []
  },
  initialDeckSizes: {
    level1: 0,
    level2: 0,
    level3: 0
  },
  pyramid: {
    level1: [],
    level2: [],
    level3: []
  },
  bag: {
    blue: 4,
    white: 4,
    green: 4,
    black: 4,
    red: 4,
    pearl: 2,
    gold: 3
  },
  board: Array(5).fill(null).map(() => Array(5).fill(null)),
  royalCards: [],
  scrollPool: 3, // Total scrolls available (max 3)
  players: {
    player1: {
      tokens: {
        blue: 0,
        white: 0,
        green: 0,
        black: 0,
        red: 0,
        pearl: 0,
        gold: 0
      },
      cards: [],
      reserves: [],
      privileges: 0
    },
    player2: {
      tokens: {
        blue: 0,
        white: 0,
        green: 0,
        black: 0,
        red: 0,
        pearl: 0,
        gold: 0
      },
      cards: [],
      reserves: [],
      privileges: 0
    }
  },
  currentPlayer: 1,
  turnState: createTurnState("player1"),
  gameOver: {
    winnerId: null,
    conditions: [],
    winnerStats: null
  },
  syncAssignments: {
    player1Id: null,
    player2Id: null
  }
};

// Turn switching system (isolated for future changes)
// Tracks which player is displayed as "you" (bottom) vs "opponent" (top)
// This is separate from gameState.currentPlayer which tracks actual game state
const turnDisplayState = {
  activePlayerId: 'player1', // Player shown at bottom as "your hand"
  opponentPlayerId: 'player2' // Player shown at top as "opponent"
};

const initTurnHistoryState = () => ({
  turns: [],
  pendingTurn: null,
  nextTurnId: 1
});

let turnHistoryState = initTurnHistoryState();

const resetTurnHistoryState = () => {
  turnHistoryState = initTurnHistoryState();
  clearTurnSeenAcknowledgement();
};

const getCurrentPlayerId = () => (gameState.currentPlayer === 1 ? 'player1' : 'player2');
const resetCurrentTurnState = () => {
  gameState.turnState = createTurnState(getCurrentPlayerId());
  turnCheckpointCommitted = false;
  turnCheckpointPromise = null;
};

const ensureCurrentTurnState = () => {
  if (!gameState.turnState || gameState.turnState.playerId !== getCurrentPlayerId()) {
    resetCurrentTurnState();
  }
  if (typeof gameState.turnState.boardRefilled !== "boolean") {
    gameState.turnState.boardRefilled = false;
  }
  if (typeof gameState.turnState.actionCompleted !== "boolean") {
    gameState.turnState.actionCompleted = false;
  }
  if (!Number.isInteger(gameState.turnState.extraTurnsPending) || gameState.turnState.extraTurnsPending < 0) {
    gameState.turnState.extraTurnsPending = 0;
  }
  if (typeof gameState.turnState.isExtraTurn !== "boolean") {
    gameState.turnState.isExtraTurn = false;
  }
  return gameState.turnState;
};

const hasRefilledBoardThisTurn = () => ensureCurrentTurnState().boardRefilled;
const getViewedPlayerId = () => {
  if (turnDisplayState.activePlayerId) {
    return turnDisplayState.activePlayerId;
  }
  return gameState.currentPlayer === 1 ? 'player1' : 'player2';
};

const getActionPlayerId = () => {
  if (syncContext.enabled && syncContext.localPlayerId) {
    return syncContext.localPlayerId;
  }
  return getCurrentPlayerId();
};

const ensurePendingTurn = () => {
  const playerId = getCurrentPlayerId();
  if (!turnHistoryState.pendingTurn || turnHistoryState.pendingTurn.playerId !== playerId) {
    turnHistoryState.pendingTurn = {
      id: `turn-${turnHistoryState.nextTurnId++}`,
      playerId,
      startedAt: Date.now(),
      events: []
    };
  }
  return turnHistoryState.pendingTurn;
};

const aggregateTokens = (tokenList = []) => {
  const counts = {};
  tokenList.forEach(color => {
    if (!color) return;
    counts[color] = (counts[color] || 0) + 1;
  });
  return Object.keys(counts).map(color => ({ color, count: counts[color] }));
};

const summarizeCard = (card) => ({
  id: card.id,
  level: card.level,
  color: card.color,
  points: card.points || 0,
  crowns: card.crowns || 0,
  ability: card.ability || null,
  isDouble: !!card.isDouble,
  costs: card.costs ? { ...card.costs } : {}
});

const summarizeSpend = (spend = {}) => Object.keys(spend)
  .filter(color => spend[color] > 0)
  .map(color => ({ color, count: spend[color] }));

const logTurnEvent = (type, payload = {}) => {
  const pending = ensurePendingTurn();
  pending.events.push({
    id: `${pending.id}-event-${pending.events.length + 1}`,
    type,
    timestamp: Date.now(),
    ...payload
  });
  pending.updatedAt = Date.now();
};

const finalizePendingTurn = (status = 'completed') => {
  const pending = turnHistoryState.pendingTurn;
  if (!pending) return;
  if (!pending.events.length) {
    turnHistoryState.pendingTurn = null;
    return;
  }
  pending.endedAt = Date.now();
  pending.status = status;
  pending.turnNumber = (turnHistoryState.turns?.length || 0) + 1;
  turnHistoryState.turns.push(pending);
  turnHistoryState.pendingTurn = null;
};

let turnDialogMode = null;
let turnGuardCustomMessage = "";
let turnCheckpointCommitted = false;
let turnCheckpointPromise = null;
let turnHandoffInProgress = false;

// Track previous crown counts to detect threshold crossings
const previousCrownCounts = {
  player1: 0,
  player2: 0
};

// Royal card selection state
let selectedRoyalCard = null;
let royalCardSelectionMode = false;
let rematchInProgress = false;

// Card ability processing state
let bonusTokenMode = false;
let bonusTokenRequiredColor = null;
let stealTokenMode = false;
let selectedStealColor = null;

// Token discard state
let tokensToDiscard = [];
let tokenDiscardMode = false;
let requiredDiscardCount = 0; // Number of tokens that must be discarded
let discardModalMinimized = false; // Whether discard modal is minimized

// Persistent client identifier (used to lock player slots in online games)
const CLIENT_ID_STORAGE_KEY = "splendor_duel_client_id";

const generateClientId = () => {
  try {
    if (crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch (error) {
    // Ignore and fall back
  }
  return `sd-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
};

const getClientId = () => {
  try {
    const stored = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (stored) return stored;

    const newId = generateClientId();
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, newId);
    return newId;
  } catch (error) {
    console.warn("Unable to access localStorage for client ID:", error);
    return generateClientId();
  }
};

const clientId = getClientId();
console.log("Splendor Duel client ID:", clientId);

// GameSync integration state
const syncContext = {
  enabled: false,
  serviceAvailable: false,
  sessionId: null,
  version: null,
  localPlayerId: null,
  isHost: false,
  pollTimerId: null,
  pollIntervalMs: null,
  syncStatus: 'offline', // 'offline', 'online', 'degraded'
  lastSeenTurnId: null,
  lastSeenTurnStorageKey: null
};

const TURN_SEEN_STORAGE_PREFIX = "splendor_duel_seen_opponent_turn";

const getTurnSeenStorageKey = () => {
  if (!syncContext.sessionId || !syncContext.localPlayerId) return null;
  return `${TURN_SEEN_STORAGE_PREFIX}:${syncContext.sessionId}:${syncContext.localPlayerId}`;
};

const loadTurnSeenAcknowledgement = () => {
  const storageKey = getTurnSeenStorageKey();
  if (!storageKey || syncContext.lastSeenTurnStorageKey === storageKey) return;

  syncContext.lastSeenTurnStorageKey = storageKey;
  try {
    syncContext.lastSeenTurnId = window.localStorage.getItem(storageKey);
  } catch (error) {
    console.warn("Unable to load opponent-turn acknowledgement:", error);
    syncContext.lastSeenTurnId = null;
  }
};

const saveTurnSeenAcknowledgement = () => {
  const storageKey = getTurnSeenStorageKey();
  if (!storageKey || !syncContext.lastSeenTurnId) return;

  syncContext.lastSeenTurnStorageKey = storageKey;
  try {
    window.localStorage.setItem(storageKey, syncContext.lastSeenTurnId);
  } catch (error) {
    console.warn("Unable to save opponent-turn acknowledgement:", error);
  }
};

const clearTurnSeenAcknowledgement = () => {
  const storageKey = getTurnSeenStorageKey() || syncContext.lastSeenTurnStorageKey;
  if (storageKey) {
    try {
      window.localStorage.removeItem(storageKey);
    } catch (error) {
      console.warn("Unable to clear opponent-turn acknowledgement:", error);
    }
  }
  syncContext.lastSeenTurnId = null;
  syncContext.lastSeenTurnStorageKey = null;
};

// GameSync client abstraction
class GameSyncClient {
  constructor(baseUrl, gameType) {
    this.baseUrl = baseUrl;
    this.gameType = gameType;
    this.sessionId = null;
    this.version = null;
    this.serviceAvailable = false;
    this.pollTimerId = null;
    this.pollStopped = false;
  }

  async checkStatus() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch(`${this.baseUrl}?action=status`, {
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        this.serviceAvailable = data.status === 'operational';
        return this.serviceAvailable;
      }
      
      this.serviceAvailable = false;
      return false;
    } catch (error) {
      this.serviceAvailable = false;
      return false;
    }
  }

  async createSession(stateBlob, meta = {}) {
    const response = await fetch(`${this.baseUrl}?action=create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        game_type: this.gameType,
        state_blob: stateBlob,
        meta: meta
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw {
        type: 'create_failed',
        status: response.status,
        message: error.error || `Failed to create session: ${response.status}`
      };
    }

    const session = await response.json();
    this.sessionId = session.session_id;
    this.version = session.version;
    return session;
  }

  async loadSession(sessionId) {
    const url = new URL(this.baseUrl);
    url.searchParams.set('action', 'load');
    url.searchParams.set('session_id', sessionId);
    url.searchParams.set('game_type', this.gameType);

    const response = await fetch(url);

    if (response.status === 404) {
      throw {
        type: 'not_found',
        status: 404,
        message: 'Session not found'
      };
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw {
        type: 'load_failed',
        status: response.status,
        message: error.error || `Failed to load session: ${response.status}`
      };
    }

    const session = await response.json();
    this.sessionId = session.session_id;
    this.version = session.version;
    return session;
  }

  async updateSession(stateBlob, maxRetries = 3, meta = null) {
    if (!this.sessionId || this.version === null) {
      throw {
        type: 'no_session',
        message: 'No active session'
      };
    }

    const pushMeta = meta ?? buildPushMeta(stateBlob);
    let attempts = 0;
    let currentVersion = this.version;

    while (attempts < maxRetries) {
      try {
        const body = {
          session_id: this.sessionId,
          game_type: this.gameType,
          state_blob: stateBlob,
          version: currentVersion
        };
        
        if (pushMeta !== null) body.meta = pushMeta;
        
        const response = await fetch(`${this.baseUrl}?action=update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (response.status === 409) {
          const conflict = await response.json();
          this.version = conflict.current.version;
          throw {
            type: 'version_conflict',
            status: 409,
            message: 'Version conflict: remote state changed',
            current: conflict.current
          };
        }

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw {
            type: 'update_failed',
            status: response.status,
            message: error.error || `Failed to update session: ${response.status}`
          };
        }

        const session = await response.json();
        this.version = session.version;
        return session;
      } catch (error) {
        if (error.type === 'version_conflict' || error.type === 'update_failed') {
          throw error;
        }
        attempts++;
        if (attempts >= maxRetries) {
          throw {
            type: 'network_error',
            message: error.message || 'Network error during update'
          };
        }
      }
    }
  }

  startPolling(intervalMs, onUpdate) {
    if (this.pollTimerId) {
      this.stopPolling();
    }

    if (!this.sessionId) {
      throw new Error('No active session for polling');
    }

    this.pollStopped = false;
    let pollInFlight = false;

    const poll = async () => {
      if (this.pollStopped || pollInFlight) return;
      pollInFlight = true;
      try {
      const previousVersion = this.version;
        const session = await this.loadSession(this.sessionId);
        
      if (previousVersion === null || session.version > previousVersion) {
        this.version = session.version;
          if (onUpdate) {
            onUpdate(session);
          }
        }
      } catch (error) {
        console.error('Poll error:', error);
        if (onUpdate) {
          onUpdate(null, error);
        }
      } finally {
        pollInFlight = false;
      }
      if (!this.pollStopped) {
        this.pollTimerId = setTimeout(poll, intervalMs);
      }
    };

    poll();
  }

  stopPolling() {
    this.pollStopped = true;
    if (this.pollTimerId) {
      clearTimeout(this.pollTimerId);
      this.pollTimerId = null;
    }
  }
}

// Detect if we're in dev mode (localhost or local IP)
const isDevMode = () => {
  const hostname = window.location.hostname;
  return hostname === 'localhost' || 
         hostname === '127.0.0.1' || 
         hostname.startsWith('192.168.') ||
         hostname.startsWith('10.') ||
         hostname === 'gamesync' ||
         window.location.port !== '';
};

// Initialize GameSync client with dev/prod detection
const gameSyncBaseUrl = isDevMode() 
  ? 'http://gamesync:8888/index.php'
  : 'https://danieldailey.com/gamesync/index.php';

const gameSyncClient = new GameSyncClient(
  gameSyncBaseUrl,
  'splendor_duel'
);

const parseCSV = (csvText) => {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    const card = {};
    headers.forEach((header, i) => {
      card[header] = values[i];
    });
    return createCard(card);
  });
};

const loadCards = () => {
  try {
    allCards = parseCSV(cardsCsv);
  } catch (error) {
    console.error('Failed to parse cards:', error);
    // Fallback to empty arrays if CSV can't be parsed
    allCards = [];
  }
};

const shuffle = (array) => {
  const shuffled = [...array];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
};

const initializeDecks = () => {
  // Separate loaded cards by level
  const byLevel = { 1: [], 2: [], 3: [] };
  allCards.forEach(card => {
    byLevel[card.level].push(card);
  });
  
  // Shuffle each deck
  gameState.decks.level1 = shuffle(byLevel[1]);
  gameState.decks.level2 = shuffle(byLevel[2]);
  gameState.decks.level3 = shuffle(byLevel[3]);
};

const initializeRoyalCards = () => {
  // The 4 royal cards as specified
  gameState.royalCards = [
    { id: 'royal-1', points: 2, ability: 'scroll', taken: false },
    { id: 'royal-2', points: 2, ability: 'steal', taken: false },
    { id: 'royal-4', points: 2, ability: 'again', taken: false },
    { id: 'royal-3', points: 3, ability: null, taken: false },
  ];
};

const initializePyramid = () => {
  // Deal visible cards to pyramid
  // Level 1 (top row): 3 cards
  // Level 2 (middle row): 4 cards
  // Level 3 (bottom row): 5 cards
  gameState.pyramid.level1 = gameState.decks.level1.splice(0, 3);
  gameState.pyramid.level2 = gameState.decks.level2.splice(0, 4);
  gameState.pyramid.level3 = gameState.decks.level3.splice(0, 5);
  
  // Record the initial deck sizes after dealing to pyramid
  gameState.initialDeckSizes.level1 = gameState.decks.level1.length;
  gameState.initialDeckSizes.level2 = gameState.decks.level2.length;
  gameState.initialDeckSizes.level3 = gameState.decks.level3.length;
};

const getSpiralOrder = (size) => {
  // Calculate spiral order for a size×size grid
  // Starting at center and spiraling outward in clockwise direction
  const order = [];
  const center = Math.floor(size / 2);
  let direction = 'right'; // Start going right from center
  let steps = 1;
  let currentSteps = 0;
  let timesUsedDirection = 0;
  
  let row = center;
  let col = center;
  
  // Add center first
  order.push([row, col]);
  
  // Spiral outward
  for (let i = 1; i < size * size; i++) {
    // Move in current direction
    if (direction === 'right') col++;
    else if (direction === 'down') row++;
    else if (direction === 'left') col--;
    else if (direction === 'up') row--;
    
    order.push([row, col]);
    currentSteps++;
    
    // Check if we've used this direction the appropriate number of times
    if (currentSteps === steps) {
      currentSteps = 0;
      timesUsedDirection++;
      
      // Change direction (right → down → left → up → right)
      if (direction === 'right') direction = 'down';
      else if (direction === 'down') direction = 'left';
      else if (direction === 'left') direction = 'up';
      else if (direction === 'up') direction = 'right';
      
      // Increase step count every other direction change
      if (timesUsedDirection === 2) {
        steps++;
        timesUsedDirection = 0;
      }
    }
  }
  
  return order;
};

const placeTokensOnBoard = () => {
  // Build flat array of all tokens
  const tokens = [];
  
  // Add gem colors (4 each)
  const gemColors = ['blue', 'white', 'green', 'black', 'red'];
  gemColors.forEach(color => {
    for (let i = 0; i < 4; i++) {
      tokens.push(color);
    }
  });
  
  // Add pearls (2)
  tokens.push('pearl', 'pearl');
  
  // Add gold (3)
  tokens.push('gold', 'gold', 'gold');
  
  // Shuffle tokens
  const shuffled = shuffle(tokens);
  
  // Place on board following spiral pattern
  const spiralOrder = getSpiralOrder(5);
  shuffled.forEach((token, index) => {
    if (index < 25) {
      const [row, col] = spiralOrder[index];
      gameState.board[row][col] = token;
    }
  });
  
  // Clear the bag since all tokens are now on the board (bag only contains tokens returned from purchases)
  Object.keys(gameState.bag).forEach(color => {
    gameState.bag[color] = 0;
  });
};

// Scroll mechanics
const awardScroll = (playerId) => {
  return awardPrivilege(gameState, playerId);
};

const initializeGame = () => {
  resetGamePieces(gameState);
  resetTransientActionState();

  // Load cards from inlined CSV
  loadCards();
  
  // Initialize game components
  initializeDecks();
  initializeRoyalCards();
  initializePyramid();
  placeTokensOnBoard();
  
  // Randomly choose first player (non-first player gets a scroll)
  gameState.currentPlayer = Math.random() < 0.5 ? 1 : 2;
  resetCurrentTurnState();
  const nonFirstPlayerId = gameState.currentPlayer === 1 ? 'player2' : 'player1';
  awardScroll(nonFirstPlayerId);
  
  // Initialize turn display state to match game state
  turnDisplayState.activePlayerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  turnDisplayState.opponentPlayerId = gameState.currentPlayer === 1 ? 'player2' : 'player1';
  if (vsComputer.enabled) {
    turnDisplayState.activePlayerId = 'player1';
    turnDisplayState.opponentPlayerId = 'player2';
  }
  
  // Initialize previous crown counts
  previousCrownCounts.player1 = 0;
  previousCrownCounts.player2 = 0;
  
  gameState.gameOver = {
    winnerId: null,
    conditions: [],
    winnerStats: null
  };

  // Reset sync assignments for a new local game
  ensureSyncAssignmentsStructure();
  gameState.syncAssignments.player1Id = null;
  gameState.syncAssignments.player2Id = null;
  
  resetTurnHistoryState();
};

// GameSync state serialization
const buildSyncState = () => {
  return {
    gameState: JSON.parse(JSON.stringify(gameState)),
    turnDisplayState: JSON.parse(JSON.stringify(turnDisplayState)),
    previousCrownCounts: JSON.parse(JSON.stringify(previousCrownCounts)),
    turnHistory: JSON.parse(JSON.stringify(turnHistoryState))
  };
};

const encodeSyncState = () => {
  return JSON.stringify(buildSyncState());
};

const applySyncedState = (rawBlob) => {
  try {
    const parsed = JSON.parse(rawBlob);
    
    if (!parsed.gameState || !parsed.turnDisplayState || !parsed.previousCrownCounts) {
      console.error('Invalid sync state: missing required fields');
      return false;
    }
    
    // Deep-mutate gameState
    Object.keys(parsed.gameState).forEach(key => {
      if (key === 'board') {
        // Board is a 2D array, need to handle carefully
        gameState.board = parsed.gameState.board.map(row => [...row]);
      } else if (key === 'players') {
        // Deep copy players
        Object.keys(parsed.gameState.players).forEach(playerId => {
          gameState.players[playerId] = JSON.parse(JSON.stringify(parsed.gameState.players[playerId]));
        });
      } else if (key === 'decks' || key === 'pyramid') {
        // Deep copy nested arrays
        Object.keys(parsed.gameState[key]).forEach(levelKey => {
          gameState[key][levelKey] = JSON.parse(JSON.stringify(parsed.gameState[key][levelKey]));
        });
      } else if (Array.isArray(parsed.gameState[key])) {
        gameState[key] = JSON.parse(JSON.stringify(parsed.gameState[key]));
      } else if (typeof parsed.gameState[key] === 'object' && parsed.gameState[key] !== null) {
        gameState[key] = JSON.parse(JSON.stringify(parsed.gameState[key]));
      } else {
        gameState[key] = parsed.gameState[key];
      }
    });
    
    // Mutate turnDisplayState - BUT preserve our local player view in online mode
    // In online mode, we always want to see our own hand, not what the synced state says
    if (!syncContext.enabled) {
      // Local mode: use synced state
      turnDisplayState.activePlayerId = parsed.turnDisplayState.activePlayerId;
      turnDisplayState.opponentPlayerId = parsed.turnDisplayState.opponentPlayerId;
    } else {
      // Online mode: preserve our view (we see our hand, opponent sees theirs)
      // Don't change turnDisplayState - it should already be set correctly
      // The synced state's turnDisplayState is for the other player's view
    }
    
    // Mutate previousCrownCounts
    previousCrownCounts.player1 = parsed.previousCrownCounts.player1;
    previousCrownCounts.player2 = parsed.previousCrownCounts.player2;
    
    if (parsed.turnHistory) {
      const history = JSON.parse(JSON.stringify(parsed.turnHistory));
      turnHistoryState = {
        turns: Array.isArray(history.turns) ? history.turns : [],
        pendingTurn: history.pendingTurn || null,
        nextTurnId: history.nextTurnId || ((history.turns && history.turns.length) ? history.turns.length + 1 : 1)
      };
    } else {
      resetTurnHistoryState();
    }
    
    ensureSyncAssignmentsStructure();
    ensureCurrentTurnState();
    turnCheckpointCommitted = Boolean(gameState.turnState.actionCompleted);
    if (!gameState.gameOver || typeof gameState.gameOver !== "object") {
      gameState.gameOver = {
        winnerId: null,
        conditions: [],
        winnerStats: null
      };
    } else {
      if (!Array.isArray(gameState.gameOver.conditions)) {
        gameState.gameOver.conditions = [];
      }
      if (!gameState.gameOver.winnerId) {
        gameState.gameOver.winnerId = null;
      }
      if (!gameState.gameOver.winnerStats || typeof gameState.gameOver.winnerStats !== "object") {
        gameState.gameOver.winnerStats = null;
      }
    }
    
    // Re-render the game
    renderGame();
    
    return true;
  } catch (error) {
    console.error('Failed to apply synced state:', error);
    return false;
  }
};

const ensureSyncAssignmentsStructure = () => {
  if (!gameState.syncAssignments) {
    gameState.syncAssignments = { player1Id: null, player2Id: null };
  } else {
    if (typeof gameState.syncAssignments.player1Id === "undefined") {
      gameState.syncAssignments.player1Id = null;
    }
    if (typeof gameState.syncAssignments.player2Id === "undefined") {
      gameState.syncAssignments.player2Id = null;
    }
  }
};

const getLocalPlayerNumericId = () => {
  if (!syncContext.localPlayerId) return null;
  return syncContext.localPlayerId === "player1" ? 1 : 2;
};

const isOnlineOpponentTurn = () => syncContext.enabled && !isLocalPlayersTurn();

const updateTurnGuardMessage = () => {
  const guardEl = document.getElementById("turn-guard-message");
  if (!guardEl) return;
  
  if (isOnlineOpponentTurn()) {
    const message = turnGuardCustomMessage || "Opponent's turn – please wait.";
    guardEl.textContent = message;
    guardEl.classList.add("visible");
  } else {
    guardEl.textContent = "";
    guardEl.classList.remove("visible");
    turnGuardCustomMessage = "";
  }
};

const showTurnBlockedNotice = (reason = "Please wait for your opponent to finish their turn.") => {
  turnGuardCustomMessage = reason;
  updateTurnGuardMessage();
  console.warn(`[Sync Guard] ${reason}`);
};

const clearTurnGuardMessage = () => {
  turnGuardCustomMessage = "";
  updateTurnGuardMessage();
};

const ensureLocalTurn = (reason = "This action is only available on your turn.") => {
  if (isGameOver()) {
    console.warn("Action blocked: game is already over.");
    return false;
  }
  if (isOnlineOpponentTurn()) {
    showTurnBlockedNotice(reason);
    return false;
  }
  if (syncContext.enabled && ensureCurrentTurnState().actionCompleted) {
    showTurnBlockedNotice("This turn is complete. Finish the handoff before taking another action.");
    if (ensureCurrentTurnState().extraTurnsPending > 0) {
      showRepeatTurnModal();
    } else {
      showTurnCompletionDialog("online_end");
    }
    return false;
  }
  return true;
};

const isGameOver = () => Boolean(gameState.gameOver && gameState.gameOver.winnerId);

const canUseSystemNotifications = () => typeof window !== "undefined" && "Notification" in window;

const requestTurnNotificationPermission = async () => {
  if (!canUseSystemNotifications()) {
    return "unsupported";
  }
  if (Notification.permission !== "default") {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch (error) {
    console.warn("Notification permission request failed:", error);
    return "error";
  }
};

const notifyTurnReady = () => {
  if (!syncContext.enabled || !syncContext.localPlayerId) return;
  if (!canUseSystemNotifications()) return;
  if (Notification.permission !== "granted") return;
  if (!document.hidden && document.hasFocus()) return;

  const playerLabel = syncContext.localPlayerId === "player1" ? "Player 1" : "Player 2";
  const sessionText = trimSessionId(syncContext.sessionId) || "current session";
  const notification = new Notification("Splendor Duel", {
    body: `Your turn (${playerLabel}) in ${sessionText}.`,
    tag: `splendor-duel-turn-${syncContext.sessionId || "unknown"}`,
    renotify: true
  });
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
  setTimeout(() => notification.close(), 10000);
};

const getTurnNotificationStatusLabel = () => {
  if (!canUseSystemNotifications()) return "Unsupported";
  if (Notification.permission === "granted") return "Enabled";
  if (Notification.permission === "denied") return "Blocked";
  return "Not enabled";
};

const trimSessionId = (sessionId) => {
  if (!sessionId) return "";
  return sessionId.startsWith(GAME_TYPE_PREFIX)
    ? sessionId.slice(GAME_TYPE_PREFIX.length)
    : sessionId;
};

const normalizeSessionId = (sessionId) => {
  if (!sessionId) return null;
  return sessionId.startsWith(GAME_TYPE_PREFIX)
    ? sessionId
    : `${GAME_TYPE_PREFIX}${sessionId}`;
};

const buildShareUrl = (sessionId) => {
  if (!sessionId) return "";
  const normalized = normalizeSessionId(sessionId) || sessionId;
  const trimmed = trimSessionId(normalized);
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (trimmed) {
    url.searchParams.set("session", trimmed);
  } else {
    url.searchParams.set("session", normalized);
  }
  return url.toString();
};

const buildShareQrUrl = (shareUrl) => {
  if (!shareUrl) return "";
  const encoded = encodeURIComponent(shareUrl);
  return `https://api.qrserver.com/v1/create-qr-code/?size=170x170&data=${encoded}`;
};

const isLocalPlayersTurn = () => {
  if (!syncContext.enabled || !syncContext.localPlayerId) {
    return true;
  }
  const localNumeric = getLocalPlayerNumericId();
  return gameState.currentPlayer === localNumeric;
};

const advanceToNextPlayerOnline = () => {
  if (!syncContext.enabled || !syncContext.localPlayerId) return;
  const nextPlayerNumeric = syncContext.localPlayerId === "player1" ? 2 : 1;
  gameState.currentPlayer = nextPlayerNumeric;
  resetCurrentTurnState();
};

const pushStateUpdate = async (reason = "state update") => {
  if (!syncContext.enabled || !syncContext.sessionId) {
    return null;
  }
  try {
    const stateBlob = encodeSyncState();
    if (!stateBlob || stateBlob.length < 50) {
      console.error(`State blob too small (${stateBlob?.length}) for update (${reason}). Skipping write.`);
      return null;
    }
    const session = await gameSyncClient.updateSession(stateBlob);
    syncContext.version = session.version;
    syncContext.syncStatus = "online";
    console.log(`State pushed (${reason})`, session.version);
    return session;
  } catch (error) {
    console.error(`Failed to push state (${reason})`, error);
    throw error;
  }
};

const commitOnlineCheckpoint = async (reason, rollbackState) => {
  if (!syncContext.enabled) return true;

  try {
    await pushStateUpdate(reason);
    syncContext.syncStatus = "online";
    return true;
  } catch (error) {
    if (error.current) {
      syncContext.version = error.current.version;
      gameSyncClient.version = error.current.version;
      applySyncedState(error.current.state_blob);
    } else if (rollbackState) {
      applySyncedState(rollbackState);
    }
    syncContext.syncStatus = "degraded";
    updateSyncUI();
    return false;
  }
};

let cardIdCounter = 0;

const createCard = (data) => ({
  id: `card-${cardIdCounter++}`,
  level: parseInt(data.level),
  color: data.color,
  points: parseInt(data.points) || 0,
  crowns: parseInt(data.crowns) || 0,
  ability: data.ability || "",
  isDouble: data.is_double === "yes",
  costs: {
    white: parseInt(data.cost_w) || 0,
    blue: parseInt(data.cost_bl) || 0,
    green: parseInt(data.cost_g) || 0,
    red: parseInt(data.cost_r) || 0,
    black: parseInt(data.cost_bk) || 0,
    pearl: parseInt(data.cost_p) || 0,
  },
});

const getColorClass = (color) => {
  const colorMap = {
    blue: 'blue',
    white: 'white',
    green: 'green',
    black: 'black',
    red: 'red',
    wild: 'wild'
  };
  return colorMap[color] || '';
};

const getColorValue = (color) => {
  const colorValues = {
    blue: '#4a90e2',
    white: '#f0f0f0',
    green: '#7ed321',
    black: '#2c3e50',
    red: '#e74c3c',
  };
  return colorValues[color] || '#999';
};

const generateCrownIcon = (size = 20) => {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" role="img" aria-label="crown">
    <path d="M3 17 L3 8.5 L7 12.2 L10.6 7.2 L12 4.8 L13.4 7.2 L17 12.2 L21 8.5 L21 17 Z" fill="#ffd700" stroke="#c68c00" stroke-width="1" stroke-linejoin="round"/>
    <rect x="4" y="16.5" width="16" height="4" rx="1" fill="#f7d251" stroke="#c68c00" stroke-width="1"/>
    <circle cx="5.2" cy="9" r="1.5" fill="#ffe680" stroke="#c68c00" stroke-width="0.8"/>
    <circle cx="18.8" cy="9" r="1.5" fill="#ffe680" stroke="#c68c00" stroke-width="0.8"/>
    <polygon points="12,6.2 13.4,7.9 12,9.6 10.6,7.9" fill="#d1495b" stroke="#8d2336" stroke-width="0.7" stroke-linejoin="round"/>
  </svg>`;
};

let pearlIdCounter = 0;

const generatePearlIcon = (size = 24) => {
  const id = pearlIdCounter++;
  const gradientId = `pearlGradient${id}`;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" role="img" aria-label="pearl">
    <defs>
      <radialGradient id="${gradientId}" cx="35%" cy="30%" r="65%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="45%" stop-color="#ffe6f0"/>
        <stop offset="75%" stop-color="#f6d1e8"/>
        <stop offset="100%" stop-color="#d7a8d6"/>
      </radialGradient>
    </defs>
    <circle cx="12" cy="12" r="12" fill="url(#${gradientId})" stroke="none"/>
  </svg>`;
};

let gemTokenIdCounter = 0;

const generateGemTokenIcon = (color, size = 24) => {
  const id = gemTokenIdCounter++;
  const gradientId = `${color}Gradient${id}`;
  const innerGradientId = `${color}InnerGradient${id}`;
  
  const colorConfig = {
    blue: { 
      gradient: ['#6bb4ff', '#4a90e2', '#357abd', '#2c5aa0'],
      stroke: '#1f3f6e',
      innerGradient: ['#3a6ab8', '#4490d5', '#4f9ee0', '#5aace8']
    },
    white: { 
      gradient: ['#ffffff', '#f5f5f5', '#e5e5e5', '#cccccc'],
      stroke: '#999999',
      innerGradient: ['#e8e8e8', '#ebebeb', '#efefef', '#f2f2f2']
    },
    green: { 
      gradient: ['#9ee65b', '#7ed321', '#6bb018', '#5a9f1f'],
      stroke: '#3d7215',
      innerGradient: ['#6eb539', '#72ba3f', '#79c148', '#7fc850']
    },
    black: { 
      gradient: ['#4d5a6b', '#2c3e50', '#1f2a36', '#1a1f2e'],
      stroke: '#0f1419',
      innerGradient: ['#1f2732', '#202835', '#232a39', '#252d3d']
    },
    red: { 
      gradient: ['#ff6b6b', '#e74c3c', '#c9332a', '#c0392b'],
      stroke: '#a02824',
      innerGradient: ['#d14a41', '#d9554c', '#e16057', '#e96b62']
    }
  };
  
  const config = colorConfig[color] || colorConfig.blue;
  
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" role="img" aria-label="${color} gem">
    <defs>
      <radialGradient id="${gradientId}" cx="40%" cy="30%" r="70%">
        <stop offset="0%" stop-color="${config.gradient[0]}"/>
        <stop offset="40%" stop-color="${config.gradient[1]}"/>
        <stop offset="70%" stop-color="${config.gradient[2]}"/>
        <stop offset="100%" stop-color="${config.gradient[3]}"/>
      </radialGradient>
      <linearGradient id="${innerGradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${config.innerGradient[0]}"/>
        <stop offset="40%" stop-color="${config.innerGradient[1]}"/>
        <stop offset="70%" stop-color="${config.innerGradient[2]}"/>
        <stop offset="100%" stop-color="${config.innerGradient[3]}"/>
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="12" fill="url(#${gradientId})" stroke="${config.stroke}" stroke-width="0.5"/>
    <circle cx="12" cy="12" r="8" fill="url(#${innerGradientId})" stroke="${config.stroke}" stroke-width="0.5"/>
  </svg>`;
};

let goldIdCounter = 0;

// Generate stacked icons for scrolls, pearls, or gold
// Icons stack with topmost on right, duplicates peeking from underneath and to the right
const generateStackedIcons = (type, count, size = 24) => {
  if (count === 0) return '';
  
  // Icons overlap by 40%, so 60% is visible
  const overlapPercent = 0.4;
  const visibleWidth = size * (1 - overlapPercent);
  
  const icons = [];
  for (let i = 0; i < count; i++) {
    let iconSvg = '';
    if (type === 'scroll') {
      iconSvg = `<span class="privilege-scroll-emoji" style="font-size: ${size}px;">🗞️</span>`;
    } else if (type === 'pearl') {
      iconSvg = generatePearlIcon(size);
    } else if (type === 'gold') {
      iconSvg = generateGoldIcon(size);
    }
    
    // Topmost icon (last one, i = count - 1) is on the right
    // Earlier icons peek from underneath and to the left
    // First icon (i=0) is leftmost, last icon (i=count-1) is rightmost and on top
    // Horizontal only, no vertical offset
    const offsetX = i * visibleWidth;
    const zIndex = i + 1; // Later icons (rightmost) have higher z-index (on top)
    
    // White glow: thin, starting opaque and quickly dissipating
    // Use multiple shadows for a more visible glow effect
    const glowFilter = 'drop-shadow(0 0 1px rgba(255, 255, 255, 1)) drop-shadow(0 0 2px rgba(255, 255, 255, 0.8)) drop-shadow(0 0 3px rgba(255, 255, 255, 0.4))';
    
    icons.push(`
      <div style="
        position: absolute;
        display: inline-block;
        left: ${offsetX}px;
        top: 0px;
        z-index: ${zIndex};
        filter: ${glowFilter};
      ">
        ${iconSvg}
      </div>
    `);
  }
  
  // Container needs enough width to show all stacked icons
  // Last icon is at offsetX = (count-1) * visibleWidth, plus its full size
  const containerWidth = (count - 1) * visibleWidth + size;
  const containerHeight = size;
  
  return `<div style="display: inline-block; position: relative; width: ${containerWidth}px; height: ${containerHeight}px; vertical-align: middle;">${icons.join('')}</div>`;
};

// Generate the resource icons section (scrolls, pearls, gold)
// Returns HTML for right-aligned icons with proper stacking
const generateResourceIcons = (playerId, iconSize = 24) => {
  const player = gameState.players[playerId];
  const scrolls = player.privileges || 0;
  const pearls = player.tokens.pearl || 0;
  const gold = player.tokens.gold || 0;
  
  // Only show if at least one resource exists
  if (scrolls === 0 && pearls === 0 && gold === 0) {
    return '';
  }
  
  const icons = [];
  
  // Order: scrolls (leftmost), pearls (middle), gold (rightmost)
  if (scrolls > 0) {
    icons.push(generateStackedIcons('scroll', scrolls, iconSize));
  }
  if (pearls > 0) {
    icons.push(generateStackedIcons('pearl', pearls, iconSize));
  }
  if (gold > 0) {
    icons.push(generateStackedIcons('gold', gold, iconSize));
  }
  
  return `<div style="display: flex; align-items: center; gap: 6px; justify-content: flex-end;">${icons.join('')}</div>`;
};

const generateGoldIcon = (size = 24) => {
  const id = goldIdCounter++;
  const gradientId = `goldGradient${id}`;
  const innerGradientId = `goldInnerGradient${id}`;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" role="img" aria-label="gold coin">
    <defs>
      <radialGradient id="${gradientId}" cx="40%" cy="30%" r="70%">
        <stop offset="0%" stop-color="#fff6a3"/>
        <stop offset="40%" stop-color="#ffd85c"/>
        <stop offset="70%" stop-color="#f4b41a"/>
        <stop offset="100%" stop-color="#c78100"/>
      </radialGradient>
      <linearGradient id="${innerGradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#e09a28"/>
        <stop offset="40%" stop-color="#e8a53c"/>
        <stop offset="70%" stop-color="#f0b050"/>
        <stop offset="100%" stop-color="#f8bb64"/>
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="12" fill="url(#${gradientId})" stroke="#a86b00" stroke-width="0.5"/>
    <circle cx="12" cy="12" r="8" fill="url(#${innerGradientId})" stroke="#a86b00" stroke-width="0.5"/>
  </svg>`;
};

const generateWildIconSvg = (size = 28) => `
  <svg viewBox="0 0 24 24" width="${size}" height="${size}" role="img" aria-label="wild gem">
    <polygon points="12,12 12,2 21.6,8.6" fill="#2c3e50"></polygon>
    <polygon points="12,12 21.6,8.6 18.1,20.3" fill="#f0f0f0" stroke="#ccc"></polygon>
    <polygon points="12,12 18.1,20.3 5.9,20.3" fill="#e74c3c"></polygon>
    <polygon points="12,12 5.9,20.3 2.4,8.6" fill="#7ed321"></polygon>
    <polygon points="12,12 2.4,8.6 12,2" fill="#4a90e2"></polygon>
    <polygon points="12,2 21.6,8.6 18.1,20.3 5.9,20.3 2.4,8.6" fill="none" stroke="#333" stroke-width="0.6"></polygon>
  </svg>
`;

const generateAbilityIcon = (card) => {
  const icons = {
    'again': '🔄', // repeat icon
    'token': '💎', // token picker - we can discuss this
    'steal': '✋', // hand/steal
    'scroll': '🗞️', // scroll
  };
  
  if (card.ability === 'wild') {
    return `<span class="ability-icon">${generateWildIconSvg(18)}</span>`;
  }

  if (card.ability && icons[card.ability]) {
    return `<span class="ability-icon">${icons[card.ability]}</span>`;
  }
  
  return '';
};

const generateDoubleIndicator = (card) => {
  if (!card.isDouble || !card.color || card.color === 'none' || card.color === 'wild') {
    return '';
  }
  
  const colorClass = getColorClass(card.color);
  const colorValue = getColorValue(card.color);
  const borderColor = card.color === 'white' ? '#999' : 'white';
  
  // Two overlapping colored circles, styled like cost circles
  return `<div class="double-indicator">
    <div class="double-circle double-circle-back ${colorClass}" style="background-color: ${colorValue}; border-color: ${borderColor};"></div>
    <div class="double-circle double-circle-front ${colorClass}" style="background-color: ${colorValue}; border-color: ${borderColor};"></div>
  </div>`;
};

const generateCostDisplay = (costs) => {
  // Filter out zero costs
  const nonZeroCosts = Object.entries(costs)
    .filter(([_, value]) => value > 0);
  
  if (nonZeroCosts.length === 0) return '';
  
  // Separate pearl from other costs
  const pearlCost = nonZeroCosts.find(([color]) => color === 'pearl');
  const otherCosts = nonZeroCosts.filter(([color]) => color !== 'pearl')
    .sort((a, b) => b[1] - a[1]); // Sort by amount descending
  
  // Quadrants numbered as:
  // 3 4
  // 1 2
  // In CSS Grid: row 1 = top, row 2 = bottom, col 1 = left, col 2 = right
  // So: 1=bottom-left (2,1), 2=bottom-right (2,2), 3=top-left (1,1), 4=top-right (1,2)
  const positions = [
    { name: 'bottom-left', row: 2, col: 1 },
    { name: 'bottom-right', row: 2, col: 2 },
    { name: 'top-left', row: 1, col: 1 },
    { name: 'top-right', row: 1, col: 2 }
  ];
  const getQuadrantClasses = (row, col) => {
    const classes = [];
    if (row === 1) classes.push('cost-top');
    if (col === 2) classes.push('cost-right');
    return classes.join(' ');
  };
  
  // Build the final layout: fill all 4 positions
  const layout = [];
  let otherCostIndex = 0;
  
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const posNumber = i + 1; // 1, 2, 3, 4
    
    // Position 2 is reserved for pearl (bottom-right quadrant)
    if (posNumber === 2 && pearlCost) {
      layout.push({ 
        cost: pearlCost, 
        class: getQuadrantClasses(pos.row, pos.col)
      });
    } else if (otherCostIndex < otherCosts.length) {
      // Fill with next other cost
      layout.push({ 
        cost: otherCosts[otherCostIndex++], 
        class: getQuadrantClasses(pos.row, pos.col)
      });
    } else {
      // Position is empty - push null placeholder
      layout.push(null);
    }
  }
  
  return layout
    .filter(item => item !== null)
    .map(({ cost, class: className }) => {
      const [color, amount] = cost;
      if (color === 'pearl') {
        // Generate pearl without fixed size so CSS can control it
        const pearlSvg = generatePearlIcon(24).replace(/width="\d+"/, '').replace(/height="\d+"/, '');
        return `<div class="cost-item pearl ${className}"><div class="cost-token pearl">${pearlSvg}</div></div>`;
      }
      return `<div class="cost-item ${color} ${className}"><div class="cost-token"><span class="cost-number">${amount}</span></div></div>`;
    }).join('');
};

const renderCardV2 = (card, levelClass, isAffordable = false) => {
  const hasColor = card.color && card.color !== 'none';
  const isWild = card.color === 'wild';
  const isGrey = card.color === 'none';
  
  // Determine stripe classes
  let stripeClass = '';
  if (isWild || isGrey) {
    stripeClass = isGrey ? 'grey-card' : 'wild-card';
  } else if (hasColor) {
    stripeClass = `colored-card ${getColorClass(card.color)}`;
  }
  
  // Add affordable class if the card can be purchased
  const affordableClass = isAffordable ? ' affordable' : '';
  
  // Build card HTML with data attributes for tracking - using card-v2 class
  let cardHTML = `<div class="card card-v2 ${levelClass}${affordableClass}" data-clickable="card" data-popover="card-detail-popover" data-card-level="${card.level}" data-card-index="${card._pyramidIndex ?? ''}" data-card-id="${card.id ?? ''}">`;
  
  // Render base first (stripes in background)
  // Top stripe (thick)
  if (hasColor && !isWild) {
    cardHTML += `<div class="card-stripe-top ${getColorClass(card.color)}" style="background-color: ${getColorValue(card.color)}"></div>`;
  } else if (isWild || isGrey) {
    const stripeColor = isGrey ? '#000' : '#999';
    cardHTML += `<div class="card-stripe-top grey" style="background-color: ${stripeColor}"></div>`;
  }
  
  // Bottom stripe (thin)
  if (hasColor && !isWild) {
    cardHTML += `<div class="card-stripe-bottom ${getColorClass(card.color)}" style="background-color: ${getColorValue(card.color)}"></div>`;
  } else if (isWild || isGrey) {
    const stripeColor = isGrey ? '#000' : '#999';
    cardHTML += `<div class="card-stripe-bottom grey" style="background-color: ${stripeColor}"></div>`;
  }
  
  // Card header (no level display)
  cardHTML += '<div class="card-header">';
  cardHTML += '</div>';
  
  // Upper left section: points (no colored circle for normal colored cards)
  if (card.points > 0) {
    if (isWild) {
      cardHTML += `<div class="prestige-points wild-points">${card.points}</div>`;
    } else if (isGrey) {
      cardHTML += '<div class="points-corner"></div>';
      cardHTML += `<div class="prestige-points">${card.points}</div>`;
    } else {
      // For colored cards (including white), show points without circle
      const whiteClass = card.color === 'white' ? ' white-points' : '';
      cardHTML += `<div class="prestige-points${whiteClass}">${card.points}</div>`;
    }
  }
  
  // Upper right section: ability icons and crowns
  if (card.ability || card.isDouble || card.crowns > 0) {
    cardHTML += '<div class="card-ability-container">';
    
    // Render crowns with special layout
    if (card.crowns > 0) {
      const crownSize = 16; // Slightly smaller than color circle to fit multiple
      if (card.crowns === 1) {
        cardHTML += `<div class="card-crowns crown-single">${generateCrownIcon(crownSize)}</div>`;
      } else if (card.crowns === 2) {
        // Stack vertically
        cardHTML += `<div class="card-crowns crown-stack">${generateCrownIcon(crownSize)}${generateCrownIcon(crownSize)}</div>`;
      } else if (card.crowns === 3) {
        // Form L-shape: top row has 2, bottom row has 1 on right
        cardHTML += `<div class="card-crowns crown-grid">
          ${generateCrownIcon(crownSize)}${generateCrownIcon(crownSize)}
          <span></span>${generateCrownIcon(crownSize)}
        </div>`;
      }
    }
    
    // Render ability icons (non-crown)
    if (card.ability) {
      cardHTML += '<span class="card-ability">';
      cardHTML += generateAbilityIcon(card);
      cardHTML += '</span>';
    }
    
    // Render double indicator (separate from ability icons)
    if (card.isDouble) {
      cardHTML += generateDoubleIndicator(card);
    }
    
    cardHTML += '</div>';
  }
  
  // Costs at bottom
  cardHTML += '<div class="card-costs">';
  cardHTML += generateCostDisplay(card.costs);
  cardHTML += '</div>';
  
  // Wild icon for wild cards - centered above costs
  if (isWild) {
    cardHTML += `<div class="wild-icon-positioned">${generateWildIconSvg(28)}</div>`;
  }
  
  cardHTML += '</div>';
  
  return cardHTML;
};

const renderCard = (card, levelClass) => {
  const hasColor = card.color && card.color !== 'none';
  const isWild = card.color === 'wild';
  const isGrey = card.color === 'none';
  
  // Determine stripe classes
  let stripeClass = '';
  if (isWild || isGrey) {
    stripeClass = isGrey ? 'grey-card' : 'wild-card';
  } else if (hasColor) {
    stripeClass = `colored-card ${getColorClass(card.color)}`;
  }
  
  // Build card HTML with data attributes for tracking
  let cardHTML = `<div class="card ${levelClass}" data-clickable="card" data-popover="card-detail-popover" data-card-level="${card.level}" data-card-index="${card._pyramidIndex || ''}" data-card-id="${card.id || ''}">`;
  
  // Render base first (stripes in background)
  // Top stripe (thick)
  if (hasColor && !isWild) {
    cardHTML += `<div class="card-stripe-top ${getColorClass(card.color)}" style="background-color: ${getColorValue(card.color)}"></div>`;
  } else if (isWild || isGrey) {
    const stripeColor = isGrey ? '#000' : '#999';
    cardHTML += `<div class="card-stripe-top grey" style="background-color: ${stripeColor}"></div>`;
  }
  
  // Bottom stripe (thin)
  if (hasColor && !isWild) {
    cardHTML += `<div class="card-stripe-bottom ${getColorClass(card.color)}" style="background-color: ${getColorValue(card.color)}"></div>`;
  } else if (isWild || isGrey) {
    const stripeColor = isGrey ? '#000' : '#999';
    cardHTML += `<div class="card-stripe-bottom grey" style="background-color: ${stripeColor}"></div>`;
  }
  
  // Card header (no level display)
  cardHTML += '<div class="card-header">';
  cardHTML += '</div>';
  
  // Upper left section: points (no colored circle for normal colored cards)
  if (card.points > 0) {
    if (isWild) {
      cardHTML += `<div class="prestige-points wild-points">${card.points}</div>`;
    } else if (isGrey) {
      cardHTML += '<div class="points-corner"></div>';
      cardHTML += `<div class="prestige-points">${card.points}</div>`;
    } else {
      const whiteClass = card.color === 'white' ? ' white-points' : '';
      cardHTML += `<div class="prestige-points${whiteClass}">${card.points}</div>`;
    }
  }
  
  // Upper right section: ability icons and crowns
  if (card.ability || card.isDouble || card.crowns > 0) {
    cardHTML += '<div class="card-ability-container">';
    
    // Render crowns with special layout
    if (card.crowns > 0) {
      const crownSize = 16; // Slightly smaller than color circle to fit multiple
      if (card.crowns === 1) {
        cardHTML += `<div class="card-crowns crown-single">${generateCrownIcon(crownSize)}</div>`;
      } else if (card.crowns === 2) {
        // Stack vertically
        cardHTML += `<div class="card-crowns crown-stack">${generateCrownIcon(crownSize)}${generateCrownIcon(crownSize)}</div>`;
      } else if (card.crowns === 3) {
        // Form L-shape: top row has 2, bottom row has 1 on right
        cardHTML += `<div class="card-crowns crown-grid">
          ${generateCrownIcon(crownSize)}${generateCrownIcon(crownSize)}
          <span></span>${generateCrownIcon(crownSize)}
        </div>`;
      }
    }
    
    // Render ability icons (non-crown)
    if (card.ability) {
      cardHTML += '<span class="card-ability">';
      cardHTML += generateAbilityIcon(card);
      cardHTML += '</span>';
    }
    
    // Render double indicator (separate from ability icons)
    if (card.isDouble) {
      cardHTML += generateDoubleIndicator(card);
    }
    
    cardHTML += '</div>';
  }
  
  // Costs at bottom
  cardHTML += '<div class="card-costs">';
  cardHTML += generateCostDisplay(card.costs);
  cardHTML += '</div>';
  
  // Wild icon for wild cards - centered above costs
  if (isWild) {
    cardHTML += `<div class="wild-icon-positioned">${generateWildIconSvg(28)}</div>`;
  }
  
  cardHTML += '</div>';
  
  return cardHTML;
};

const getDeckTotal = (level) => {
  // Return total number of cards in this level
  // Level 1: 13 cards, Level 2: 24 cards, Level 3: 30 cards
  const totals = { 1: 13, 2: 24, 3: 30 };
  return totals[level] || 0;
};

const getDeckMeterHeight = (level) => {
  const deck = gameState.decks[`level${level}`];
  const initialSize = gameState.initialDeckSizes[`level${level}`];
  const remaining = deck.length;
  const percentage = initialSize > 0 ? (remaining / initialSize) * 100 : 0;
  return Math.max(0, Math.min(100, percentage));
};

const generateTokenBoard = (size = 100) => {
  // Calculate cell size (relative to board size)
  const cellSize = size / 5;
  const strokeWidth = size * 0.006; // Subtle grid lines
  const borderWidth = size * 0.02; // Border width
  const marginWidth = size * 0.03; // Margin between grid and border
  const roundedRadius = size * 0.04; // Rounded corner radius
  
  let html = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="token-board-svg" preserveAspectRatio="none">`;
  
  // Outer border with rounded corners (darker frame)
  html += `<rect x="0" y="0" width="${size}" height="${size}" fill="#8b7765" stroke="#6b5e4a" stroke-width="${borderWidth}" rx="${roundedRadius}" ry="${roundedRadius}"/>`;
  
  // Margin area with rounded corners (slightly darker than grid)
  const marginInnerSize = size - marginWidth * 2;
  html += `<rect x="${marginWidth}" y="${marginWidth}" width="${marginInnerSize}" height="${marginInnerSize}" fill="#c7b69a" rx="${roundedRadius}" ry="${roundedRadius}"/>`;
  
  // Grid area with square corners
  const gridSize = marginInnerSize;
  
  // Add radial gradient definition (centered in upper left quadrant)
  html += `<defs>
    <radialGradient id="boardGradient" cx="25%" cy="25%" r="120%">
      <stop offset="0%" stop-color="#d9cbb3" stop-opacity="0.6"/>
      <stop offset="50%" stop-color="#d6c7b0" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#d4c4a8" stop-opacity="0"/>
    </radialGradient>
    <style>
      .token-board-grid { stroke: rgba(139, 119, 101, 0.3); stroke-width: ${strokeWidth}; fill: none; }
    </style>
  </defs>`;
  
  // Base grid area
  html += `<rect x="${marginWidth}" y="${marginWidth}" width="${gridSize}" height="${gridSize}" fill="#d4c4a8"/>`;
  
  // Radial gradient overlay for depth
  html += `<rect x="${marginWidth}" y="${marginWidth}" width="${gridSize}" height="${gridSize}" fill="url(#boardGradient)"/>`;
  
  // Adjusted cell size for grid within margin
  const gridCellSize = gridSize / 5;
  
  // Horizontal grid lines (within margin area, square corners)
  for (let i = 1; i < 5; i++) {
    const y = marginWidth + i * gridCellSize;
    html += `<line class="token-board-grid" x1="${marginWidth}" y1="${y}" x2="${marginWidth + gridSize}" y2="${y}"/>`;
  }
  
  // Vertical grid lines (within margin area, square corners)
  for (let i = 1; i < 5; i++) {
    const x = marginWidth + i * gridCellSize;
    html += `<line class="token-board-grid" x1="${x}" y1="${marginWidth}" x2="${x}" y2="${marginWidth + gridSize}"/>`;
  }
  
  // Draw tokens
  const tokenRadius = gridCellSize * 0.35; // Tokens take up about 70% of cell
  
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const token = gameState.board[row][col];
      const cellX = marginWidth + col * gridCellSize;
      const cellY = marginWidth + row * gridCellSize;
      
      // Check if this token is selected
      const isSelected = selectedTokens.some(t => t.row === row && t.col === col);
      
      // Clickable area for each cell
      html += `<rect x="${cellX}" y="${cellY}" width="${gridCellSize}" height="${gridCellSize}" fill="transparent" class="token-cell" data-row="${row}" data-col="${col}" style="cursor: ${token && token !== 'gold' ? 'pointer' : 'default'};"/>`;
      
      if (!token) continue;
      
      const centerX = marginWidth + (col + 0.5) * gridCellSize;
      const centerY = marginWidth + (row + 0.5) * gridCellSize;
      
      // Calculate common dimensions for all token types
      const adjustedRadius = tokenRadius + strokeWidth;
      const iconSize = adjustedRadius * 2;
      const shadowPadding = 4; // Space for CSS drop shadow
      const foreignObjectSize = iconSize + shadowPadding * 2;
      
      // Position foreignObject with extra space for shadows
      const foreignObjectX = centerX - adjustedRadius - shadowPadding;
      const foreignObjectY = centerY - adjustedRadius - shadowPadding;
      
      // Generate token SVG based on type
      let tokenSvg;
      if (token === 'pearl') {
        tokenSvg = generatePearlIcon(iconSize).replace(/width="\d+"/, `width="${iconSize}"`).replace(/height="\d+"/, `height="${iconSize}"`);
      } else if (token === 'gold') {
        tokenSvg = generateGoldIcon(iconSize).replace(/width="\d+"/, `width="${iconSize}"`).replace(/height="\d+"/, `height="${iconSize}"`);
      } else {
        tokenSvg = generateGemTokenIcon(token, iconSize).replace(/width="\d+"/, `width="${iconSize}"`).replace(/height="\d+"/, `height="${iconSize}"`);
      }
      
      // Add selection ring if selected
      let selectionRing = '';
      if (isSelected && token !== 'gold') {
        const ringRadius = adjustedRadius + 3;
        selectionRing = `<circle cx="${centerX}" cy="${centerY}" r="${ringRadius}" fill="none" stroke="#4a90e2" stroke-width="3" opacity="0.8"/>`;
      }
      
      // Wrap in foreignObject with shadow space and CSS drop-shadow filter
      html += `${selectionRing}<foreignObject x="${foreignObjectX}" y="${foreignObjectY}" width="${foreignObjectSize}" height="${foreignObjectSize}">` +
        `<div style="width: ${iconSize}px; height: ${iconSize}px; margin: ${shadowPadding}px; filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));">${tokenSvg}</div>` +
        `</foreignObject>`;
    }
  }
  
  html += '</svg>';
  return html;
};

const getPlayerCards = (playerId) => {
  const player = gameState.players[playerId];
  // Count cards by color
  const cards = {
    blue: 0,
    white: 0,
    green: 0,
    black: 0,
    red: 0,
    wild: 0
  };
  const points = { blue: 0, white: 0, green: 0, black: 0, red: 0, wild: 0 };
  const cardCounts = { blue: 0, white: 0, green: 0, black: 0, red: 0 };
  const wildStacks = { blue: false, white: false, green: false, black: false, red: false };
  const lastCardByColor = { blue: null, white: null, green: null, black: null, red: null };
  
  // Process cards in order to find the last card in each color stack
  player.cards.forEach(card => {
    // Count double cards as 2 resources instead of 1
    const cardValue = card.isDouble ? 2 : 1;
    
    if (card.color === 'wild' && card.wildColorStack) {
      // Wild card belongs to a specific color stack
      const stackColor = card.wildColorStack;
      cards[stackColor] = (cards[stackColor] || 0) + cardValue;
      cardCounts[stackColor] += 1;
      points[stackColor] = (points[stackColor] || 0) + card.points;
      lastCardByColor[stackColor] = card; // Track last card in this stack
    } else if (card.color && card.color !== 'none' && card.color !== 'wild') {
      cards[card.color] = (cards[card.color] || 0) + cardValue;
      cardCounts[card.color] += 1;
      points[card.color] = (points[card.color] || 0) + card.points;
      lastCardByColor[card.color] = card; // Track last card in this stack
    }
  });
  
  // Check if the top card (last added) in each stack is a wild
  Object.keys(lastCardByColor).forEach(color => {
    const lastCard = lastCardByColor[color];
    if (lastCard && lastCard.color === 'wild') {
      wildStacks[color] = true;
    }
  });
  
  return { cards, points, cardCounts, wildStacks };
};

// Get "misc" cards for a player (grey point-only cards and royal cards)
const getPlayerMiscCards = (playerId) => {
  const player = gameState.players[playerId];
  const greyCards = [];
  const royalCards = [];
  
  // Single-pass split prevents royals from being duplicated in both lists.
  player.cards.forEach(card => {
    if (card.id && card.id.startsWith('royal-')) {
      royalCards.push(card);
    } else if (card.color === 'none') {
      greyCards.push(card);
    }
  });
  
  return { greyCards, royalCards };
};

// Calculate player victory stats
const getPlayerVictoryStats = (playerId) => {
  const player = gameState.players[playerId];
  
  // Sum all points
  let totalPoints = 0;
  // Sum all crowns
  let totalCrowns = 0;
  // Points per color
  const colorPoints = { blue: 0, white: 0, green: 0, red: 0, black: 0 };
  
  player.cards.forEach(card => {
    totalPoints += card.points || 0;
    totalCrowns += card.crowns || 0;
    if (card.color === "wild" && card.wildColorStack && colorPoints[card.wildColorStack] !== undefined) {
      colorPoints[card.wildColorStack] += card.points || 0;
    } else if (card.color && card.color !== 'none' && card.color !== 'wild') {
      colorPoints[card.color] += card.points || 0;
    }
  });
  
  // Find color with most points (leftmost if tie)
  const colorOrder = ['blue', 'white', 'green', 'red', 'black'];
  let maxPoints = 0;
  let maxColor = colorOrder[0]; // Default to first color
  
  colorOrder.forEach(color => {
    if (colorPoints[color] > maxPoints) {
      maxPoints = colorPoints[color];
      maxColor = color;
    }
  });
  
  return {
    totalPoints,
    totalCrowns,
    colorPoints,
    maxColor,
    maxPoints
  };
};

const getVictoryConditions = (playerId) => {
  const stats = getPlayerVictoryStats(playerId);
  const conditions = [];

  if (stats.totalPoints >= 20) {
    conditions.push({
      key: "points_20",
      label: "20+ total prestige points"
    });
  }

  if (stats.totalCrowns >= 10) {
    conditions.push({
      key: "crowns_10",
      label: "10+ crowns"
    });
  }

  if (stats.maxPoints >= 10) {
    conditions.push({
      key: "color_points_10",
      label: `10+ prestige points in ${stats.maxColor}`
    });
  }

  return { conditions, stats };
};

const getPlayerLabel = (playerId) => (playerId === "player1" ? "Player 1" : "Player 2");

// --- Purchasing helpers ---
const purchaseColors = ['blue', 'white', 'green', 'red', 'black'];

const getAffordability = (card, playerId) => {
  const player = gameState.players[playerId];
  const { cards } = getPlayerCards(playerId);
  const deficits = {};
  let remainingAfterColorTokens = 0;
  
  // Colored costs after discounts (cards act as permanent discounts)
  purchaseColors.forEach(color => {
    const cost = card.costs[color] || 0;
    const discount = cards[color] || 0;
    const need = Math.max(0, cost - discount);
    deficits[color] = need;
    const payWithTokens = Math.min(need, player.tokens[color] || 0);
    remainingAfterColorTokens += (need - payWithTokens);
  });
  
  // Pearl costs (no discounts), cover with pearl tokens first
  const pearlCost = card.costs.pearl || 0;
  deficits.pearl = pearlCost;
  const pearlCovered = Math.min(pearlCost, player.tokens.pearl || 0);
  remainingAfterColorTokens += (pearlCost - pearlCovered);
  
  const affordable = remainingAfterColorTokens <= (player.tokens.gold || 0);
  return { affordable, deficits };
};

// Check if a wild card can be placed on any valid color stack
const canPlaceWildCard = (playerId) => {
  const { cards, wildStacks } = getPlayerCards(playerId);
  const colors = ['blue', 'white', 'green', 'red', 'black'];
  
  // Get valid color stacks based on rules:
  // 1. Pile must have at least one card (wild can't be first)
  // 2. Wild can't be placed on top of another wild
  const validColors = colors.filter(color => {
    const cardCount = cards[color] || 0;
    // Must have at least one card already
    if (cardCount === 0) return false;
    // Can't place on top of another wild
    if (wildStacks[color]) return false;
    return true;
  });
  
  return validColors.length > 0;
};

const formatDeficits = (deficits) => {
  const order = ['pearl', ...purchaseColors];
  const label = (c) => c.charAt(0).toUpperCase() + c.slice(1);
  const parts = [];
  order.forEach(c => {
    const n = deficits[c] || 0;
    if (n > 0) parts.push(`${label(c)} ×${n}`);
  });
  return parts.join(', ');
};

let paymentState = null;

// Compute if a purchase is possible given explicit gold assignments.
// Gold assignments: array of 'blue'|'white'|'green'|'red'|'black'|'pearl'|null
// Returns { valid, spend, message }
const computePaymentPlanWithGold = (card, playerId, goldAssignments = []) => {
  const player = gameState.players[playerId];
  const { cards } = getPlayerCards(playerId);
  const spend = { gold: 0, pearl: 0, blue: 0, white: 0, green: 0, red: 0, black: 0 };

  // Total costs (before discounts)
  const totalCosts = { pearl: card.costs.pearl || 0 };
  purchaseColors.forEach(color => {
    totalCosts[color] = card.costs[color] || 0;
  });

  // Needs after permanent card discounts
  const needs = { pearl: totalCosts.pearl };
  purchaseColors.forEach(color => {
    needs[color] = Math.max(0, totalCosts[color] - (cards[color] || 0));
  });

  // Count gold assignments per kind
  const assigned = { pearl: 0, blue: 0, white: 0, green: 0, red: 0, black: 0 };
  (goldAssignments || []).forEach(kind => {
    if (kind && assigned.hasOwnProperty(kind)) assigned[kind]++;
  });

  // Apply gold to cover assigned kinds
  // Allow gold to be used for any color with a cost
  // This lets users choose gold over tokens even when they have enough tokens/cards
  Object.keys(assigned).forEach(kind => {
    if (assigned[kind] > 0 && totalCosts[kind] > 0) {
      // Use gold for this kind only when the discounted cost still requires payment.
      const currentNeed = needs[kind] || 0;
      const goldToUse = Math.min(assigned[kind], currentNeed);
      if (goldToUse > 0) {
        needs[kind] = Math.max(0, currentNeed - goldToUse);
        spend.gold += goldToUse;
      }
    }
  });

  // Cover remaining needs with player's matching tokens
  const cover = (kind, available) => {
    const need = needs[kind] || 0;
    const use = Math.min(need, available);
    spend[kind] = use;
    needs[kind] = Math.max(0, need - use);
  };
  cover('pearl', player.tokens.pearl || 0);
  purchaseColors.forEach(color => cover(color, player.tokens[color] || 0));

  // Any residual means invalid with the chosen assignments
  const residual = (needs.pearl || 0) + purchaseColors.reduce((s, c) => s + (needs[c] || 0), 0);
  if (residual > 0) {
    return { valid: false, spend, message: 'Selection does not fully cover the cost.' };
  }

  return { valid: true, spend };
};

const buildDefaultPayment = (card, playerId) => {
  const player = gameState.players[playerId];
  const { cards } = getPlayerCards(playerId);
  const selection = { gold: 0, pearl: 0, blue: 0, white: 0, green: 0, red: 0, black: 0 };
  const caps = { ...selection };
  
  // Determine per-color needs after discounts
  purchaseColors.forEach(color => {
    const need = Math.max(0, (card.costs[color] || 0) - (cards[color] || 0));
    const payColor = Math.min(need, player.tokens[color] || 0);
    selection[color] = payColor; // spend exact color first
    caps[color] = need; // cannot exceed need
  });
  
  // Pearl: no discounts
  const pearlNeed = card.costs.pearl || 0;
  const payPearl = Math.min(pearlNeed, player.tokens.pearl || 0);
  selection.pearl = payPearl;
  caps.pearl = pearlNeed;
  
  // Remaining owed becomes gold
  let remaining = 0;
  purchaseColors.forEach(color => {
    remaining += Math.max(0, caps[color] - selection[color]);
  });
  remaining += Math.max(0, caps.pearl - selection.pearl);
  selection.gold = Math.min(remaining, player.tokens.gold || 0);
  caps.gold = remaining; // maximum useful gold to complete payment
  
  return { selection, caps };
};

const isSelectionValid = (selection, caps) => {
  // Each color cannot exceed cap
  for (const key in caps) {
    if ((selection[key] || 0) > (caps[key] || 0)) return false;
  }
  // Check total coverage equals total caps across non-gold, with gold covering remainder exactly
  let remaining = 0;
  ['pearl', ...purchaseColors].forEach(c => {
    remaining += Math.max(0, (caps[c] || 0) - (selection[c] || 0));
  });
  return (selection.gold || 0) >= remaining;
};

const enterPaymentMode = () => {
  if (!selectedCard) return;
  const playerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const { selection, caps } = buildDefaultPayment(selectedCard, playerId);
  paymentState = { playerId, selection, caps };
  renderPaymentPane();
};

const renderPaymentContent = () => {
  const pane = document.getElementById('payment-pane');
  if (!pane || !paymentState) return;
  const player = gameState.players[paymentState.playerId];

  // Helper to reproduce the cost display ordering (left-to-right, top-to-bottom)
  const getCostOrder = (costs) => {
    const nonZero = Object.entries(costs).filter(([c, n]) => n && n > 0);
    const pearl = nonZero.find(([c]) => c === 'pearl');
    const others = nonZero.filter(([c]) => c !== 'pearl');
    // Up to four positions on cards: 1,2 on top row; 3,4 bottom row. Pearl takes pos 2 if present.
    const slots = [null, null, null, null];
    if (pearl) slots[1] = pearl; // position index 1 represents the second slot
    let oi = 0;
    for (let i = 0; i < 4; i++) {
      if (!slots[i] && oi < others.length) slots[i] = others[oi++];
    }
    return slots.filter(Boolean).map(([c]) => c);
  };

  const costs = selectedCard ? selectedCard.costs || {} : {};
  const order = getCostOrder(costs);
  const { cards } = getPlayerCards(paymentState.playerId);

  // Build "You have:" icons (up to 8), only for applicable resources
  const haveIcons = [];
  const maxIcons = 8;
  order.forEach(color => {
    if (color === 'pearl') {
      const need = costs.pearl || 0;
      const canUsePearl = Math.min(need, player.tokens.pearl || 0);
      for (let i = 0; i < canUsePearl && haveIcons.length < maxIcons; i++) {
        haveIcons.push(`<span style="display:inline-flex; width:22px; height:22px; align-items:center; justify-content:center; margin:2px;">${generatePearlIcon(18)}</span>`);
      }
    } else {
      const need = costs[color] || 0;
      const cardUnits = Math.min(need, cards[color] || 0);
      const tokenUnits = Math.min(Math.max(0, need - cardUnits), player.tokens[color] || 0);
      // Card rectangles first
      for (let i = 0; i < cardUnits && haveIcons.length < maxIcons; i++) {
        haveIcons.push(`<span title="${color} card" style="display:inline-block; width:22px; height:14px; border-radius:3px; background:${getColorValue(color)}; margin:4px 3px; box-shadow:0 1px 2px rgba(0,0,0,.3);"></span>`);
      }
      // Then tokens (add a light ring for black to improve contrast)
      for (let i = 0; i < tokenUnits && haveIcons.length < maxIcons; i++) {
        const ringStyle = color === 'black' ? 'outline: 2px solid rgba(255,255,255,.85); border-radius: 50%;' : '';
        haveIcons.push(`<span style="display:inline-flex; width:22px; height:22px; align-items:center; justify-content:center; margin:2px; ${ringStyle}">${generateGemTokenIcon(color, 18)}</span>`);
      }
    }
  });

  // Determine affordability and remaining deficits after applying non-gold
  const colorNeed = {};
  purchaseColors.forEach(c => {
    const need = Math.max(0, (costs[c] || 0) - (cards[c] || 0));
    const remaining = Math.max(0, need - (player.tokens[c] || 0));
    colorNeed[c] = remaining;
  });
  const pearlRemaining = Math.max(0, (costs.pearl || 0) - (player.tokens.pearl || 0));
  
  // Gold may replace a matching token, but cannot overpay a cost already covered by card bonuses.
  const kindsWithCosts = [
    ...purchaseColors.filter(c => Math.max(0, (costs[c] || 0) - (cards[c] || 0)) > 0),
    ...((costs.pearl || 0) > 0 ? ['pearl'] : [])
  ];
  
  const kindsNeeded = [
    ...purchaseColors.filter(c => colorNeed[c] > 0),
    ...(pearlRemaining > 0 ? ['pearl'] : [])
  ];
  const totalRemaining = kindsNeeded.reduce((sum, c) => sum + (c === 'pearl' ? pearlRemaining : colorNeed[c]), 0);
  const affordable = totalRemaining <= (player.tokens.gold || 0);

  // Persist gold assignment state
  if (!paymentState.goldAssignments) {
    const count = player.tokens.gold || 0;
    paymentState.goldAssignments = Array.from({ length: count }, () => null);
  } else if (paymentState.goldAssignments.length !== (player.tokens.gold || 0)) {
    const count = player.tokens.gold || 0;
    paymentState.goldAssignments = Array.from({ length: count }, (_, i) => paymentState.goldAssignments[i] || null);
  }

  // Build HTML
  const sections = [];

  // Check if this is a wild card that can't be placed
  const isWild = selectedCard && selectedCard.color === 'wild';
  const canPlace = isWild ? canPlaceWildCard(paymentState.playerId) : true;

  // Show resources section if available
  if (haveIcons.length > 0) {
    sections.push(`
      <div style="background:#ffffff; color:#222; padding:8px 10px; border-radius:8px; display:block; box-shadow:0 1px 2px rgba(0,0,0,.1);">
        <div style="font-weight:800; margin-bottom:6px;">You have:</div>
        <div style="display:flex; flex-wrap:wrap; align-items:center; gap:4px;">${haveIcons.join('')}</div>
      </div>
    `);
  }

  // Show only ONE error message with priority:
  // 1. No resources at all (highest priority)
  // 2. Can't afford it (medium priority - only if have some resources)
  // 3. Wild card can't be placed (lowest priority - only if affordable)
  if (haveIcons.length === 0) {
    sections.push(`<div style="margin-top:8px; color:#ff8a80;">You have no resources to buy this card.</div>`);
  } else if (!affordable) {
    sections.push(`<div style="margin-top:8px; color:#ff8a80;">You cannot buy this card with your current resources.</div>`);
  } else if (isWild && !canPlace) {
    sections.push(`<div style="margin-top:8px; color:#ff8a80; font-weight:600;">You must have a non-wild color card to place this on to.</div>`);
  }

  if (affordable && (player.tokens.gold || 0) > 0) {
    const goldCount = player.tokens.gold || 0;
    const headerText = goldCount > 1 ? 'Use your gold tokens:' : 'Use your gold token:';
    const rows = [];
    // Options per row are ALL kinds with costs (not just those with deficits)
    // This allows using gold even when you have enough cards/tokens
    const optionIcon = (kind) => kind === 'pearl' ? generatePearlIcon(18) : generateGemTokenIcon(kind, 18);
    for (let i = 0; i < goldCount; i++) {
      const current = paymentState.goldAssignments[i];
      const options = kindsWithCosts.map(kind => {
        const isSelected = current === kind;
        const style = isSelected ? 'outline: 2px solid #4a90e2; box-shadow: 0 0 6px rgba(74,144,226,.6); background: rgba(255,255,255,.06);' : 'opacity:.7;';
        return `<span class="gold-option" data-row="${i}" data-kind="${kind}" style="display:inline-flex; width:24px; height:24px; margin:2px; align-items:center; justify-content:center; border-radius:6px; cursor:pointer; ${style}">${optionIcon(kind)}</span>`;
      }).join('');
      rows.push(`
        <div class="gold-row" data-row="${i}" style="display:flex; align-items:center; gap:8px; margin-top:6px;">
          <span style="display:inline-flex; width:24px; height:24px; align-items:center; justify-content:center;">${generateGoldIcon(18)}</span>
          <div style="display:flex; flex-wrap:wrap;">${options}</div>
        </div>
      `);
    }
    // Wrap header + rows in a white box
    sections.push(`
      <div style="background:#ffffff; color:#222; padding:8px 10px; border-radius:8px; display:block; box-shadow:0 1px 2px rgba(0,0,0,.1); margin-top:10px;">
        <div style="font-weight:800; margin-bottom:6px;">${headerText}</div>
        ${rows.join('')}
      </div>
    `);
    // Validate the current assignments and optionally show a message
    const plan = computePaymentPlanWithGold(selectedCard, paymentState.playerId, paymentState.goldAssignments);
    if (!plan.valid) {
      sections.push(`<div style="margin-top:6px; color:#ff8a80;">${plan.message}</div>`);
    }
  }

  // Reservation eligibility message (always last in pane) unless buying from reserve
  const currentPlayerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const reserveCount = gameState.players[currentPlayerId].reserves.length;
  const fromReserve = paymentState && paymentState.context && paymentState.context.fromReserve;
  if (!fromReserve && reserveCount >= 3) {
    sections.push(`<div style="margin-top:10px; color:#ffcc80;">You already have 3 reserved cards and cannot reserve another.</div>`);
  }

  // Render container
  pane.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:6px; padding:8px 8px 8px 28px; box-sizing:border-box;">
      ${sections.join('')}
    </div>
  `;

  // Attach listeners for gold selection
  document.querySelectorAll('.gold-option').forEach(el => {
    el.addEventListener('click', () => {
      const row = parseInt(el.getAttribute('data-row'), 10);
      const kind = el.getAttribute('data-kind');
      if (paymentState.goldAssignments[row] === kind) {
        paymentState.goldAssignments[row] = null; // toggle off
      } else {
        paymentState.goldAssignments[row] = kind; // select
      }
      renderPaymentContent();
    });
  });

  // Ensure Buy button state mirrors affordability/validity using gold assignments when present
  const buyBtn = document.getElementById('buy-button');
  if (buyBtn) {
    const plan = computePaymentPlanWithGold(selectedCard, paymentState.playerId, paymentState.goldAssignments);
    const isWild = selectedCard && selectedCard.color === 'wild';
    const canPlace = isWild ? canPlaceWildCard(paymentState.playerId) : true;
    buyBtn.disabled = !plan.valid || !canPlace;
    buyBtn.onclick = () => finalizePurchaseWithSelection();
  }
  // Update reserve button disabled state
  const reserveBtn = document.querySelector('.reserve-button');
  if (reserveBtn) {
    const rpId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
    const hideReserve = paymentState && paymentState.context && paymentState.context.fromReserve;
    if (hideReserve) {
      reserveBtn.style.display = 'none';
    } else {
      const hasGold = hasGoldOnBoard();
      const canReserve = gameState.players[rpId].reserves.length < 3;
      reserveBtn.disabled = !canReserve || !hasGold;
      reserveBtn.title = !hasGold ? 'Cannot reserve: no gold on board' : (!canReserve ? 'Cannot reserve: already have 3 reserved cards' : '');
    }
  }
};

// Process card abilities after acquisition
const processCardAbilities = (card, playerId) => {
  if (!card) return;
  
  const currentPlayer = playerId;
  const otherPlayer = currentPlayer === 'player1' ? 'player2' : 'player1';
  
  // Check for repeat turn ability (again)
  if (card.ability === 'again') {
    logTurnEvent('repeat_turn_awarded', { card: summarizeCard(card) });
    queueExtraTurn(ensureCurrentTurnState());
    checkAndShowRoyalCardSelection();
    return;
  }
  
  // Check for bonus token ability (token/diamond)
  if (card.ability === 'token') {
    // Check if board has token of card's color
    const requiredColor = card.color;
    if (requiredColor && requiredColor !== 'none' && requiredColor !== 'wild') {
      // Check if board has any token of this color
      let hasToken = false;
      for (let r = 0; r < gameState.board.length; r++) {
        for (let c = 0; c < gameState.board[r].length; c++) {
          if (gameState.board[r][c] === requiredColor) {
            hasToken = true;
            break;
          }
        }
        if (hasToken) break;
      }
      
      if (hasToken) {
        bonusTokenMode = true;
        bonusTokenRequiredColor = requiredColor;
        // Show token board modal with bonus token mode
        showTokenSelectionModal(true);
        return;
      }
    }
  }
  
  // Check for steal token ability (steal/hand)
  if (card.ability === 'steal') {
    // Check if opponent has any tokens (excluding gold)
    const opponent = gameState.players[otherPlayer];
    const stealableColors = ['blue', 'white', 'green', 'red', 'black', 'pearl'];
    const hasStealableTokens = stealableColors.some(color => (opponent.tokens[color] || 0) > 0);
    
    if (hasStealableTokens) {
      stealTokenMode = true;
      showStealTokenModal();
      return;
    }
  }

  // Check for privilege/scroll ability
  if (card.ability === 'scroll') {
    const scrollAwarded = awardScroll(currentPlayer);
    logTurnEvent(scrollAwarded ? 'scroll_gained' : 'scroll_unavailable', {
      card: summarizeCard(card)
    });
  }
  
  // No special abilities or abilities already processed
  checkAndShowRoyalCardSelection();
};

// Show repeat turn modal
const showRepeatTurnModal = () => {
  const dialog = document.getElementById('repeat-turn-dialog');
  if (!dialog) return;

  const turnState = ensureCurrentTurnState();
  if (turnState.extraTurnsPending <= 0) return;
  if (!turnState.actionCompleted) {
    turnState.actionCompleted = true;
    turnCheckpointCommitted = false;
  }

  // Add class to game container to block interactions
  const gameContainer = document.querySelector('.game-container');
  if (gameContainer) {
    gameContainer.classList.add('dialog-blocking');
  }
  
  dialog.style.display = 'flex';
  dialog.classList.toggle("checkpoint-pending", syncContext.enabled && !turnCheckpointCommitted);

  clearTurnSummarySection();

  const button = document.getElementById("repeat-turn-btn");
  if (button) {
    button.disabled = syncContext.enabled && !turnCheckpointCommitted;
    button.textContent = turnCheckpointCommitted || !syncContext.enabled ? "Start Extra Turn" : "Saving turn...";
  }

  if (syncContext.enabled && !turnCheckpointCommitted) {
    persistCompletedTurnCheckpoint("repeat-turn-btn", "Start Extra Turn");
  }
};

const closeRepeatTurnModal = async () => {
  if (syncContext.enabled && !(await persistCompletedTurnCheckpoint("repeat-turn-btn", "Start Extra Turn"))) {
    return;
  }

  const completedTurnState = ensureCurrentTurnState();
  const nextTurnState = consumeExtraTurn(completedTurnState);
  if (!nextTurnState) return;

  const rollbackState = syncContext.enabled ? encodeSyncState() : null;
  finalizePendingTurn("extra_turn");
  gameState.turnState = nextTurnState;
  turnCheckpointCommitted = false;
  turnCheckpointPromise = null;

  if (syncContext.enabled) {
    const committed = await commitOnlineCheckpoint("extra turn boundary", rollbackState);
    if (!committed) {
      showRepeatTurnModal();
      alert("The extra turn could not be started safely. Your completed turn is preserved; please retry.");
      return;
    }
  }

  const dialog = document.getElementById('repeat-turn-dialog');
  if (dialog) {
    dialog.style.display = 'none';
  }
  
  // Remove blocking class from game container
  const gameContainer = document.querySelector('.game-container');
  if (gameContainer) {
    gameContainer.classList.remove('dialog-blocking');
  }

  renderGame();
};

// Show token selection modal (optionally in bonus token mode)
const showTokenSelectionModal = (isBonusMode = false) => {
  const modal = document.getElementById('token-selection-modal');
  if (!modal) return;
  
  const modalBody = modal.querySelector('.modal-body');
  const layout = document.getElementById('token-modal-layout');
  const tokenBoardSection = layout?.querySelector('.token-board-section');
  const tokenActions = modal.querySelector('.token-modal-actions');
  
  // Handle bonus token mode
  if (isBonusMode && modalBody && layout) {
    // Remove existing message if any
    const existing = modalBody.querySelector('#bonus-token-message');
    if (existing) existing.remove();
    
    // Create message div on the right side
    const messageDiv = document.createElement('div');
    messageDiv.id = 'bonus-token-message';
    const colorName = bonusTokenRequiredColor || 'this color';
    messageDiv.innerHTML = `
      <div style="
        background: rgba(74, 144, 226, 0.95);
        color: white;
        padding: 16px 20px;
        border-radius: 8px;
        font-weight: bold;
        text-align: center;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        max-width: 200px;
      ">
        <div style="font-size: 1.1em; margin-bottom: 8px;">Bonus Token</div>
        <div style="font-size: 0.9em;">Select ONE ${colorName} token</div>
      </div>
    `;
    
    // Add message section to layout (on the right)
    const messageSection = document.createElement('div');
    messageSection.id = 'bonus-token-message-section';
    messageSection.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 20px;
    `;
    messageSection.appendChild(messageDiv);
    
    // Update layout to show message on right, board on left
    layout.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 20px;
      width: 100%;
    `;
    
    // Shift board section to the left
    if (tokenBoardSection) {
      tokenBoardSection.style.cssText = `
        flex: 0 0 auto;
        display: flex;
        justify-content: flex-start;
      `;
    }
    
    // Add message section to layout
    layout.appendChild(messageSection);
    
    // Hide Cancel and Refill buttons, keep only Confirm
    if (tokenActions) {
      const cancelBtn = tokenActions.querySelector('.btn-cancel');
      const refillBtn = tokenActions.querySelector('.btn-refill');
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (refillBtn) refillBtn.style.display = 'none';
    }
    
    // Hide scroll usage section in bonus token mode
    const scrollSection = document.getElementById('scroll-usage-section');
    if (scrollSection) {
      scrollSection.style.display = 'none';
    }
  } else {
    // Normal mode - restore layout
    if (layout) {
      layout.style.cssText = '';
      const messageSection = layout.querySelector('#bonus-token-message-section');
      if (messageSection) messageSection.remove();
    }
    if (tokenBoardSection) {
      tokenBoardSection.style.cssText = '';
    }
    if (tokenActions) {
      const cancelBtn = tokenActions.querySelector('.btn-cancel');
      const refillBtn = tokenActions.querySelector('.btn-refill');
      if (cancelBtn) cancelBtn.style.display = '';
      if (refillBtn) refillBtn.style.display = '';
    }
    
    // Show scroll usage section in normal mode
    const scrollSection = document.getElementById('scroll-usage-section');
    if (scrollSection) {
      scrollSection.style.display = '';
    }
  }
  
  renderTokenBoard();
  attachTokenBoardListeners();
  updateRefillButtonState();
  renderScrollUsageSection();
  openPopover('token-selection-modal');
};

// Show steal token modal
const showStealTokenModal = () => {
  selectedStealColor = null;
  const currentPlayer = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const otherPlayer = currentPlayer === 'player1' ? 'player2' : 'player1';
  const opponent = gameState.players[otherPlayer];
  
  const stealableColors = ['blue', 'white', 'green', 'red', 'black', 'pearl'];
  const availableColors = stealableColors.filter(color => (opponent.tokens[color] || 0) > 0);
  
  if (availableColors.length === 0) {
    // No tokens to steal, skip ability
    stealTokenMode = false;
    checkAndShowRoyalCardSelection();
    return;
  }
  
  // Create modal HTML
  const modalHTML = `
    <div class="modal-overlay card-modal-overlay" id="steal-token-modal" style="display: flex;">
      <div class="modal-content card-detail-content">
        <div class="modal-body" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; padding: 24px;">
          <h3 style="margin: 0; color: #333; font-size: 1.3em;">Steal a Token</h3>
          <p style="margin: 0; color: #666; text-align: center;">Select a token color to steal from your opponent:</p>
          <div style="display: flex; gap: 12px; flex-wrap: wrap; justify-content: center;">
            ${availableColors.map(color => {
              const tokenSvg = color === 'pearl' 
                ? generatePearlIcon(40) 
                : generateGemTokenIcon(color, 40);
              return `
                <div class="steal-token-option" data-color="${color}" style="
                  width: 60px;
                  height: 60px;
                  border-radius: 50%;
                  border: 3px solid #333;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  cursor: pointer;
                  transition: all 0.2s;
                  background: ${getColorValue(color)};
                  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                ">
                  ${tokenSvg}
                </div>
              `;
            }).join('')}
          </div>
          <p class="required-action-note">This card ability must be resolved before the turn can continue.</p>
          <button class="action-button buy-button" id="confirm-steal-token-btn" disabled>Confirm Steal</button>
        </div>
      </div>
    </div>
  `;
  
  // Remove existing modal if any
  const existing = document.getElementById('steal-token-modal');
  if (existing) existing.remove();
  
  // Add modal to body
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  // Attach click handlers
  document.querySelectorAll('.steal-token-option').forEach(option => {
    option.addEventListener('click', () => {
      selectedStealColor = option.getAttribute('data-color');
      document.querySelectorAll('.steal-token-option').forEach(candidate => {
        candidate.classList.toggle('selected', candidate === option);
      });
      const confirmButton = document.getElementById('confirm-steal-token-btn');
      if (confirmButton) confirmButton.disabled = false;
    });
    option.addEventListener('mouseenter', () => {
      option.style.transform = 'scale(1.1)';
      option.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
    });
    option.addEventListener('mouseleave', () => {
      if (!option.classList.contains('selected')) {
        option.style.transform = 'scale(1)';
        option.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
      }
    });
  });

  const confirmButton = document.getElementById('confirm-steal-token-btn');
  if (confirmButton) {
    confirmButton.addEventListener('click', () => confirmStealToken(selectedStealColor));
  }
};

const closeStealTokenModal = () => {
  const modal = document.getElementById('steal-token-modal');
  if (modal) {
    modal.remove();
  }
  stealTokenMode = false;
  selectedStealColor = null;
};

const confirmStealToken = (color) => {
  if (!ensureLocalTurn("Token stealing abilities resolve on your turn.")) return;
  if (!color || color !== selectedStealColor) return;
  const currentPlayer = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const otherPlayer = currentPlayer === 'player1' ? 'player2' : 'player1';
  
  // Transfer one token from opponent to player
  // (Warning was already shown at card purchase time)
  if (gameState.players[otherPlayer].tokens[color] > 0) {
    gameState.players[otherPlayer].tokens[color]--;
    gameState.players[currentPlayer].tokens[color]++;
  }
  
  logTurnEvent('token_stolen', { color });
  
  closeStealTokenModal();
  renderGame();

  checkAndShowRoyalCardSelection();
};

const finalizePurchaseWithSelection = () => {
  if (!ensureLocalTurn("Purchasing cards is only allowed on your turn.")) return;
  if (!paymentState || !selectedCard) return;
  const { playerId } = paymentState;
  const plan = computePaymentPlanWithGold(selectedCard, playerId, paymentState.goldAssignments);
  if (!plan.valid) return;
  const fromReservePurchase = paymentState && paymentState.context && paymentState.context.fromReserve;
  const reserveIndex = fromReservePurchase && paymentState.context ? paymentState.context.reserveIndex : null;
  
  // Check if this card has an ability that grants tokens (steal or bonus token)
  // Warn before purchase so player can decide if they want the card
  if (selectedCard.ability === 'steal' || selectedCard.ability === 'token') {
    const tokenCheck = willExceedTokenLimit(playerId, 1);
    if (tokenCheck.willExceed) {
      const abilityDesc = selectedCard.ability === 'steal' ? 'stealing a token' : 'taking a bonus token';
      const confirmMsg = `This card's ability (${abilityDesc}) will give you ${tokenCheck.after} tokens (limit is 10). You'll need to discard ${tokenCheck.excessCount} token${tokenCheck.excessCount > 1 ? 's' : ''} after using the ability.<br><br>Purchase this card?`;
      showConfirmationModal(confirmMsg, () => {
        proceedWithPurchase();
      });
      return;
    }
  }
  
  // No warning needed, proceed directly
  proceedWithPurchase();
};

const proceedWithPurchase = () => {
  if (!paymentState || !selectedCard) return;
  const { playerId } = paymentState;
  const plan = computePaymentPlanWithGold(selectedCard, playerId, paymentState.goldAssignments);
  if (!plan.valid) return;
  const fromReservePurchase = paymentState && paymentState.context && paymentState.context.fromReserve;
  const reserveIndex = fromReservePurchase && paymentState.context ? paymentState.context.reserveIndex : null;
  
  // Check if this is a wild card - if so, show placement modal WITHOUT deducting resources yet
  const isWild = selectedCard.color === 'wild';
  if (isWild) {
    // Store the card, payment plan, and context for later placement
    // Resources will only be deducted when placement is confirmed
    pendingWildCard = {
      card: selectedCard,
      fromReserve: paymentState.context && paymentState.context.fromReserve,
      reserveIndex: paymentState.context ? paymentState.context.reserveIndex : null,
      playerId: playerId,
      paymentPlan: plan // Store the payment plan for later deduction
    };
    paymentState = null;
    purchaseContext = null;
    closePopover('card-detail-popover');
    showWildPlacementModal();
    return;
  }
  
  // For non-wild cards, deduct resources immediately
  const player = gameState.players[playerId];
  ['gold', 'pearl', ...purchaseColors].forEach(color => {
    const spend = plan.spend[color] || 0;
    if (spend > 0) {
      player.tokens[color] = Math.max(0, (player.tokens[color] || 0) - spend);
      // Return spent tokens to the bag
      gameState.bag[color] = (gameState.bag[color] || 0) + spend;
    }
  });
  
  // Grant card: handle reserve vs pyramid source
  if (fromReservePurchase) {
    if (typeof reserveIndex === 'number' && reserveIndex >= 0) {
      const card = gameState.players[playerId].reserves.splice(reserveIndex, 1)[0];
      if (card) player.cards.push(card);
    } else {
      // Fallback if index missing: just push selectedCard
      player.cards.push(selectedCard);
    }
  } else {
    const level = selectedCard.level;
    const levelKey = `level${level}`;
    const index = selectedCard._pyramidIndex;
    player.cards.push(selectedCard);
    gameState.pyramid[levelKey].splice(index, 1);
    if (gameState.decks[levelKey].length > 0) {
      gameState.pyramid[levelKey].splice(index, 0, gameState.decks[levelKey].shift());
    }
  }
  paymentState = null;
  purchaseContext = null;
  closePopover('card-detail-popover');
  renderGame();
  
  // Process card abilities after acquisition
  const acquiredCard = player.cards[player.cards.length - 1];
  logTurnEvent('card_purchased', {
    card: summarizeCard(acquiredCard),
    fromReserve: !!fromReservePurchase,
    tokensSpent: summarizeSpend(plan.spend),
    ability: acquiredCard.ability || null
  });
  processCardAbilities(acquiredCard, playerId);
};

const renderPlayerColorCard = (
  color,
  cardBonus,
  tokenCount,
  points,
  cardCount,
  hasWild = false
) => {
  const colorClasses = {
    blue: 'blue',
    white: 'white',
    green: 'green',
    black: 'black',
    red: 'red'
  };
  
  // Calculate total buying power (tokens + cards)
  const buyingPower = cardBonus + tokenCount;
  
  // Generate token SVGs in 2x2 grid (max 4 tokens)
  let tokensHTML = '';
  if (tokenCount > 0) {
    const tokensToShow = Math.min(tokenCount, 4);
    const tokenSize = 24; // Size for each token SVG
    const tokens = [];
    
    for (let i = 0; i < tokensToShow; i++) {
      const tokenSvg = generateGemTokenIcon(color, tokenSize);
      tokens.push(`<div class="hand-token" style="filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));">${tokenSvg}</div>`);
    }
    
    tokensHTML = `<div class="hand-tokens-grid">${tokens.join('')}</div>`;
  }
  
  // Show dotted border when no cards
  const emptyStyle = cardCount === 0 ? 'style="border: 2px dashed #ccc; background: transparent;"' : '';
  
  // Add card-style stripes when we have cards
  let stripeTopHTML = '';
  let stripeBottomHTML = '';
  let wildIconHTML = '';
  if (cardCount > 0) {
    const colorValue = getColorValue(color);
    const colorClass = getColorClass(color);
    stripeTopHTML = `<div class="card-stripe-top ${colorClass}" style="background-color: ${colorValue}"></div>`;
    stripeBottomHTML = `<div class="card-stripe-bottom ${colorClass}" style="background-color: ${colorValue}"></div>`;
    wildIconHTML = hasWild ? `<div class="wild-token-icon">${generateWildIconSvg(22)}</div>` : '';
  }
  
  const emptyClass = cardCount === 0 ? 'color-card-empty' : '';
  
  const pointsHTML = cardCount > 0 ? `<div class="points-value ${color}">${points}</div>` : '';
  const wildClass = hasWild ? "wild-topped" : "";
  
  return `
    <div class="color-card ${color} ${emptyClass} ${wildClass}" ${emptyStyle}>
      ${stripeTopHTML}
      ${stripeBottomHTML}
      ${wildIconHTML}
      ${tokensHTML}
      <div class="power-circle ${color}">${buyingPower}</div>
      ${pointsHTML}
    </div>
  `;
};

// Render inline misc cards fan (compact version for header strip)
const renderMiscCardsFanInline = (playerId) => {
  const { greyCards, royalCards } = getPlayerMiscCards(playerId);
  const allMiscCards = [...greyCards, ...royalCards];
  
  // Always render the container for consistent centering
  if (allMiscCards.length === 0) {
    return '<div class="misc-cards-fan-inline"></div>';
  }
  
  // Calculate width needed for the fan
  const fanWidth = 18 + (allMiscCards.length - 1) * 10; // base card width + offsets
  
  let html = '<div class="misc-cards-fan-inline"><div class="misc-cards-fan-inner" style="width: ' + fanWidth + 'px;">';
  
  allMiscCards.forEach((card, index) => {
    const offsetX = index * 10; // Tighter fan offset
    const isRoyal = card.id && card.id.startsWith('royal-');
    const bgColor = isRoyal ? 'linear-gradient(135deg, #d4af37 0%, #f7e98e 100%)' : '#888';
    const borderColor = isRoyal ? '#b8941c' : '#666';
    const points = card.points || 0;
    
    html += `
      <div class="misc-card-tiny" style="left: ${offsetX}px; background: ${bgColor}; border-color: ${borderColor};" title="${isRoyal ? 'Royal' : 'Point'} Card: ${points} pts">
        <span class="misc-card-pts">${points}</span>
      </div>
    `;
  });
  
  html += '</div></div>';
  return html;
};

const renderPlayerHand = (playerId) => {
  const { cards, points, cardCounts, wildStacks } = getPlayerCards(playerId);
  const player = gameState.players[playerId];
  const colors = ['blue', 'white', 'green', 'red', 'black'];
  const stats = getPlayerVictoryStats(playerId);
  
  // Build compact header strip: stats | misc fan | resources+reserve
  const reserveCount = player.reserves.length;
  const hasGoldAvailable = hasGoldOnBoard();
  const reserveDisabled = reserveMode || reserveCount >= 3 || !hasGoldAvailable;
  const reserveTooltip = reserveCount >= 3
    ? 'You already have 3 reserved cards.'
    : (!hasGoldAvailable ? 'Cannot reserve: no gold on the board.' : 'Reserve a card.');
  
  let html = `
    <div class="hand-header-strip">
      <div class="hand-stats-group">
        <div class="hand-stat score">${stats.totalPoints}</div>
        <div class="hand-stat crown">${generateCrownIcon(14)}<span>${stats.totalCrowns}</span></div>
        <div class="hand-stat color-pip ${stats.maxColor} ${stats.maxPoints === 0 ? 'empty' : ''}"><span>${stats.maxPoints}</span></div>
      </div>
      ${renderMiscCardsFanInline(playerId)}
      <div class="hand-resources-group">
        ${generateResourceIcons(playerId, 20)}
        <button onclick="enterReserveMode()" class="hand-reserve-btn-compact" ${reserveDisabled ? 'disabled' : ''} title="${reserveTooltip}">Reserve</button>
      </div>
    </div>
  `;
  
  html += '<div class="color-cards-row">';
  
  colors.forEach(color => {
    const cardBonus = cards[color] || 0;
    const cardCount = cardCounts[color] || 0;
    const tokenCount = player.tokens[color] || 0;
    const hasWild = wildStacks[color] || false;
    html += renderPlayerColorCard(color, cardBonus, tokenCount, points[color] || 0, cardCount, hasWild);
  });
  
  // Add reserved cards section - check if any reserved card is affordable
  const reservedEmptyClass = reserveCount === 0 ? 'reserved-section-empty' : 'reserved-section-filled';
  let canAffordReserved = false;
  if (reserveCount > 0) {
    canAffordReserved = player.reserves.some(card => {
      const afford = getAffordability(card, playerId);
      return afford.affordable;
    });
  }
  const affordableClass = canAffordReserved ? 'reserved-affordable' : '';
  html += `
    <div class="reserved-section ${reservedEmptyClass} ${affordableClass}" id="show-reserved" data-clickable="popover" data-popover="reserved-modal">
      <div class="reserved-count">${reserveCount}</div>
      <div class="reserved-label">Reserved</div>
    </div>
  `;
  
  html += '</div>';
  
  return html;
};

const renderHandDisplay = () => {
  const handDisplay = document.getElementById('player-hand');
  if (handDisplay) {
    handDisplay.innerHTML = renderPlayerHand(turnDisplayState.activePlayerId);
    attachReservedSectionDelegation();
  }
};

// Render opponent stats for the top bar
const renderOpponentStats = () => {
  const opponentId = turnDisplayState.opponentPlayerId;
  const { cards, points, cardCounts, wildStacks } = getPlayerCards(opponentId);
  const player = gameState.players[opponentId];
  const stats = getPlayerVictoryStats(opponentId);
  const colors = ['blue', 'white', 'green', 'red', 'black'];
  
  let colorCardsHtml = '';
  colors.forEach(color => {
    const cardBonus = cards[color] || 0;
    const cardCount = cardCounts[color] || 0;
    const tokenCount = player.tokens[color] || 0;
    const pointValue = points[color] || 0;
    const hasWild = wildStacks[color] || false;
    
    // Calculate total buying power (tokens + cards)
    const buyingPower = cardBonus + tokenCount;
    
    // Generate token SVGs in 2x2 grid (max 4 tokens)
    let tokensHTML = '';
    if (tokenCount > 0) {
      const tokensToShow = Math.min(tokenCount, 4);
      const tokenSize = 20; // Slightly smaller for opponent cards
      const tokens = [];
      
      for (let i = 0; i < tokensToShow; i++) {
        const tokenSvg = generateGemTokenIcon(color, tokenSize);
        tokens.push(`<div class="hand-token" style="filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));">${tokenSvg}</div>`);
      }
      
      tokensHTML = `<div class="hand-tokens-grid">${tokens.join('')}</div>`;
    }
    
    // Add card-style stripes when we have cards
    let stripeTopHTML = '';
    let stripeBottomHTML = '';
    if (cardCount > 0) {
      const colorValue = getColorValue(color);
      const colorClass = getColorClass(color);
      stripeTopHTML = `<div class="card-stripe-top ${colorClass}" style="background-color: ${colorValue}"></div>`;
      stripeBottomHTML = `<div class="card-stripe-bottom ${colorClass}" style="background-color: ${colorValue}"></div>`;
    }

    const wildIconHTML = hasWild
      ? `<div class="opponent-wild-token-icon">${generateWildIconSvg(16)}</div>`
      : '';
    
    const emptyClass = cardCount === 0 ? 'opponent-color-card-empty' : '';
    const emptyStyle = cardCount === 0 ? 'style="border: 2px dashed #ccc; background: transparent;"' : '';
    
    const pointsHTML = cardCount > 0
      ? `<div class="opponent-points-value ${color}">${pointValue}</div>`
      : '';
    const wildClass = hasWild ? "wild-topped" : "";
    
    colorCardsHtml += `
      <div class="opponent-color-card ${color} ${emptyClass} ${wildClass}" ${emptyStyle}>
        ${stripeTopHTML}
        ${stripeBottomHTML}
        ${wildIconHTML}
        ${tokensHTML}
        <div class="opponent-power-circle ${color}">${buyingPower}</div>
        ${pointsHTML}
      </div>
    `;
  });
  
  const reserveCount = player.reserves.length;
  const opponentReservedEmptyClass = reserveCount === 0 ? 'opponent-reserved-section-empty' : 'opponent-reserved-section-filled';
  
  return `
    <div class="opponent-header-strip">
      <div class="opponent-stats-group">
        <div class="hand-stat score">${stats.totalPoints}</div>
        <div class="hand-stat crown">${generateCrownIcon(14)}<span>${stats.totalCrowns}</span></div>
        <div class="hand-stat color-pip ${stats.maxColor} ${stats.maxPoints === 0 ? 'empty' : ''}"><span>${stats.maxPoints}</span></div>
      </div>
      ${renderMiscCardsFanInline(opponentId)}
      <div class="opponent-resources-group">
        ${generateResourceIcons(opponentId, 20)}
      </div>
    </div>
    <div class="opponent-color-cards-row">
      ${colorCardsHtml}
      <div class="opponent-reserved-section ${opponentReservedEmptyClass}">
        <div class="opponent-reserved-count">${reserveCount}</div>
        <div class="opponent-reserved-label">Res</div>
      </div>
    </div>
  `;
};

const getHandDetailStackColor = (card) => {
  if (card.color === "wild" && card.wildColorStack) return card.wildColorStack;
  if (purchaseColors.includes(card.color)) return card.color;
  return null;
};

const renderHandDetailCard = (card) => {
  if (card.id?.startsWith("royal-")) {
    const abilityIcon = card.ability ? generateAbilityIcon({ ability: card.ability }) : "";
    return `
      <div class="hand-detail-card" title="Royal: ${card.points || 0} prestige points">
        <div class="card royal-card-large hand-detail-royal-card">
          <div class="royal-card-arch"></div>
          <div class="royal-card-arch-dark"></div>
          <div class="royal-card-stripe-bottom"></div>
          <div class="royal-card-points">${card.points || 0}</div>
          ${card.ability ? `<div class="royal-card-ability">${abilityIcon}</div>` : ""}
          <div class="royal-card-crown">${generateCrownIcon(40)}</div>
        </div>
      </div>
    `;
  }

  const normalizedCard = {
    ...card,
    level: card.level || 1,
    color: card.color || "none",
    costs: card.costs || {},
    crowns: card.crowns || 0
  };
  const cardHtml = renderCardV2(normalizedCard, "hand-detail-card-face")
    .replace('data-clickable="card" data-popover="card-detail-popover"', '');
  return `<div class="hand-detail-card">${cardHtml}</div>`;
};

const renderHandDetailCardFan = (cards, emptyLabel = "No cards") => {
  if (!cards.length) {
    return `<div class="hand-detail-empty">${emptyLabel}</div>`;
  }

  return `
    <div class="hand-detail-card-scroller">
      <div class="hand-detail-card-fan">${cards.map(renderHandDetailCard).join("")}</div>
    </div>
  `;
};

const renderHandDetailTokens = (color, count) => {
  if (count <= 0) return "";
  return Array.from({ length: count }, () => `
    <span class="hand-detail-token">${renderTokenIcon(color, 17)}</span>
  `).join("");
};

const renderHandDetails = (playerId) => {
  const player = gameState.players[playerId];
  const colors = ["blue", "white", "green", "red", "black"];
  const title = syncContext.enabled
    ? (playerId === syncContext.localPlayerId ? "Your Hand" : "Opponent Hand")
    : `${getPlayerLabel(playerId)} Hand`;
  const otherCards = player.cards.filter(card => !getHandDetailStackColor(card));

  const colorRows = colors.map(color => {
    const cards = player.cards.filter(card => getHandDetailStackColor(card) === color);
    return `
      <section class="hand-detail-color-row ${color}" aria-label="${formatColorLabel(color)} cards and tokens">
        <div class="hand-detail-row-content">
          <div class="hand-detail-row-tokens">${renderHandDetailTokens(color, player.tokens[color] || 0)}</div>
          ${renderHandDetailCardFan(cards)}
        </div>
      </section>
    `;
  }).join("");

  const headerResources = [
    ...Array.from({ length: player.tokens.pearl || 0 }, () => `
      <span class="hand-detail-header-token">${renderTokenIcon("pearl", 21)}</span>
    `),
    ...Array.from({ length: player.tokens.gold || 0 }, () => `
      <span class="hand-detail-header-token">${renderTokenIcon("gold", 21)}</span>
    `)
  ].join("");

  return `
    <div class="hand-details-header">
      <h3>${title}</h3>
      <div class="hand-details-header-actions">
        <div class="hand-detail-header-resources" aria-label="Pearl and gold tokens">${headerResources}</div>
        <button class="hand-details-close" onclick="closePopover('hand-details-modal')" aria-label="Close">×</button>
      </div>
    </div>
    <div class="hand-details-scroll-area">
      <div class="hand-detail-card-rows">
        ${colorRows}
        <section class="hand-detail-color-row hand-detail-other-row" aria-label="Other cards">
          <div class="hand-detail-row-content hand-detail-other-content">
            ${renderHandDetailCardFan(otherCards)}
          </div>
        </section>
      </div>
    </div>
  `;
};

const showHandDetails = (playerId) => {
  if (!gameState.players[playerId]) return;
  const content = document.getElementById("hand-details-content");
  if (!content) return;
  content.innerHTML = renderHandDetails(playerId);
  openPopover("hand-details-modal");
};

let handDetailsListenerAttached = false;
const attachHandDetailsDelegation = () => {
  if (handDetailsListenerAttached) return;
  document.addEventListener("click", event => {
    const handContainer = event.target.closest("#player-hand, #opponent-stats");
    if (!handContainer) return;

    const interactiveTarget = event.target.closest(
      "button, a, input, select, textarea, [data-clickable], [role='button']"
    );
    if (interactiveTarget && handContainer.contains(interactiveTarget)) return;

    const playerId = handContainer.id === "player-hand"
      ? turnDisplayState.activePlayerId
      : turnDisplayState.opponentPlayerId;
    showHandDetails(playerId);
  });
  handDetailsListenerAttached = true;
};

const generateResourceSummary = () => {
  const currentPlayer = gameState.players.player1; // For now, always player 1
  return `
    <div class="resource-summary">
      <div class="resource-summary-item">
        <span class="token-mini blue"></span><span>${currentPlayer.tokens.blue}</span>
      </div>
      <div class="resource-summary-item">
        <span class="token-mini white"></span><span>${currentPlayer.tokens.white}</span>
      </div>
      <div class="resource-summary-item">
        <span class="token-mini green"></span><span>${currentPlayer.tokens.green}</span>
      </div>
      <div class="resource-summary-item">
        <span class="token-mini black"></span><span>${currentPlayer.tokens.black}</span>
      </div>
      <div class="resource-summary-item">
        <span class="token-mini red"></span><span>${currentPlayer.tokens.red}</span>
      </div>
      <div class="resource-summary-item">
        <span class="token-mini gold"></span><span>${currentPlayer.tokens.gold}</span>
      </div>
      <div class="resource-summary-item">
        <span class="token-mini pearl"></span><span>${currentPlayer.tokens.pearl}</span>
      </div>
    </div>
  `;
};

const finalizeGameOverState = (winnerId, conditions, stats) => {
  if (isGameOver()) return;

  gameState.gameOver = {
    winnerId,
    conditions: [...conditions],
    winnerStats: {
      totalPoints: stats.totalPoints,
      totalCrowns: stats.totalCrowns,
      maxColor: stats.maxColor,
      maxPoints: stats.maxPoints
    }
  };
};

const openVictoryModal = () => {
  const modal = document.getElementById("victory-modal");
  if (modal) {
    modal.style.display = "flex";
  }
  const gameContainer = document.querySelector(".game-container");
  if (gameContainer) {
    gameContainer.classList.add("dialog-blocking");
  }
};

const closeVictoryModal = () => {
  const modal = document.getElementById("victory-modal");
  if (modal) {
    modal.style.display = "none";
  }
  const gameContainer = document.querySelector(".game-container");
  if (gameContainer) {
    gameContainer.classList.remove("dialog-blocking");
  }
};

const reopenVictoryModal = () => {
  if (!isGameOver()) return;
  openVictoryModal();
};

const getVictoryModalMarkup = () => {
  if (!isGameOver()) {
    return "";
  }

  const winnerId = gameState.gameOver.winnerId;
  const winnerLabel = getPlayerLabel(winnerId);
  const conditions = gameState.gameOver.conditions || [];
  const winnerStats = gameState.gameOver.winnerStats || getPlayerVictoryStats(winnerId);
  const restartLabel = syncContext.enabled ? "New Game (Same Session)" : "New Local Game";
  const conditionItems = conditions.length
    ? conditions.map(condition => `<li>${condition.label}</li>`).join("")
    : "<li>Victory condition met.</li>";

  return `
    <div class="modal-overlay card-modal-overlay" id="victory-modal" style="display: flex;">
      <div class="modal-content turn-completion-content">
        <div class="turn-completion-message">
          <h3>${winnerLabel} Wins!</h3>
        </div>
        <div style="text-align: left; margin: 4px 0 14px;">
          <div style="font-weight: 700; margin-bottom: 6px;">Winning condition(s)</div>
          <ul style="margin: 0; padding-left: 20px; line-height: 1.4;">
            ${conditionItems}
          </ul>
        </div>
        <div style="font-size: 0.92em; color: #555; margin-bottom: 12px;">
          Final stats: ${winnerStats.totalPoints} points, ${winnerStats.totalCrowns} crowns, ${winnerStats.maxPoints}
          points in ${winnerStats.maxColor}.
        </div>
        <div class="victory-actions">
          <button class="action-button victory-primary-button"
            onclick="window.confirmNewGameFromGameOver()">${restartLabel}</button>
          <button class="action-button cancel-button victory-secondary-button" id="close-victory-btn">Close</button>
        </div>
      </div>
    </div>
  `;
};

const startNewGameFromGameOver = async () => {
  if (vsComputer.enabled) {
    window.startVsComputer(vsComputer.level);
    return;
  }
  if (rematchInProgress) return;
  rematchInProgress = true;

  const isOnlineRematch = syncContext.enabled && !!syncContext.sessionId;
  const previousAssignments = gameState.syncAssignments
    ? { ...gameState.syncAssignments }
    : { player1Id: null, player2Id: null };
  const localPlayerId = syncContext.localPlayerId;

  try {
    initializeGame();
    turnDialogMode = null;

    if (isOnlineRematch) {
      ensureSyncAssignmentsStructure();
      gameState.syncAssignments.player1Id = previousAssignments.player1Id;
      gameState.syncAssignments.player2Id = previousAssignments.player2Id;

      if (localPlayerId) {
        turnDisplayState.activePlayerId = localPlayerId;
        turnDisplayState.opponentPlayerId = localPlayerId === "player1" ? "player2" : "player1";
      }

      renderGame();
      await pushStateUpdate("rematch restart");
      syncContext.syncStatus = "online";
      maybeAdjustPollingCadence();
      updateSyncUI();
      return;
    }

    renderGame();
    updateSyncUI();
  } catch (error) {
    console.error("Failed to start rematch:", error);
    alert("Couldn't start a rematch cleanly. Please refresh and try again.");
    syncContext.syncStatus = "degraded";
    updateSyncUI();
  } finally {
    rematchInProgress = false;
  }
};

const confirmNewGameFromGameOver = () => {
  const onlineCopy = syncContext.enabled ? " for both players in this session" : "";
  closeVictoryModal();
  showConfirmationModal(
    `Start a new game${onlineCopy}?<br><br>This permanently clears the board, hands, points, and turn history.`,
    () => startNewGameFromGameOver(),
    () => openVictoryModal()
  );
};

const generateGameLayout = () => {
  const currentSessionId = syncContext.sessionId;
  const trimmedSessionId = trimSessionId(currentSessionId);
  const shareUrl = buildShareUrl(currentSessionId);
  const shareQrSrc = buildShareQrUrl(shareUrl);
  const viewerPlayerId = getViewedPlayerId();
  return `
    <div class="game-container">
      <!-- Sync Status Indicator and Settings -->
      <div class="sync-controls-bar">
        <div class="sync-status" id="sync-status">
          <span class="sync-indicator" id="sync-indicator" title="Sync status"></span>
          <span class="sync-mode" id="sync-mode">Local</span>
          <span class="sync-session-id" id="sync-session-id" style="display: none;"></span>
          <span class="sync-turn-indicator" id="sync-turn-indicator"></span>
        </div>
        <button class="settings-btn" id="settings-btn" title="Game settings" onclick="window.showSettings()">⚙</button>
      </div>
      ${vsComputer.enabled ? summaryBannerHtml(vsComputer.summary) : ''}
      ${vsComputer.enabled && (vsComputer.busy || vsComputer.error) ? `<div class="ai-thinking" role="status" aria-live="polite"><div>${vsComputer.error || 'Computer is thinking...'}${vsComputer.error ? '<button class="action-button" data-ai-retry onclick="window.retryComputerTurn()">Retry computer turn</button>' : ''}</div></div>` : ''}
      <div class="sync-turn-warning" id="turn-guard-message" aria-live="polite"></div>
      <!-- Top Bar: Token Board (left) and Opponent Stats (right) -->
      <div class="top-bar">
        <div class="token-board-container" id="token-board-top">
          <div class="token-board" data-clickable="popover" data-popover="token-selection-modal">
            ${generateTokenBoard()}
          </div>
        </div>
        <div class="opponent-stats-container" id="opponent-stats">
          ${renderOpponentStats()}
        </div>
      </div>

      <!-- Main Pyramid Area -->
      <div class="pyramid-container">
          <!-- Royal Cards Modal -->
          <div class="modal-overlay card-modal-overlay" id="royal-modal" style="display: none;">
            <div class="modal-content">
              <div class="modal-body" id="royal-modal-body">
                <!-- Content will be populated dynamically -->
              </div>
            </div>
          </div>

          <!-- Card Detail Popover -->
          <div class="modal-overlay card-modal-overlay" id="card-detail-popover" style="display: none;">
            <div class="modal-content card-detail-content">
              <div class="modal-body">
                <!-- Content will go here -->
              </div>
            </div>
          </div>

          <!-- Token Selection Modal -->
          <div class="modal-overlay card-modal-overlay" id="token-selection-modal" style="display: none;">
            <div class="modal-content card-detail-content">
              <div class="modal-body">
                <div class="token-modal-layout" id="token-modal-layout">
                  <div class="token-board-section">
                    <div class="token-board-wrapper">
                      <div class="token-selection-content" id="token-board-container">
                        ${generateTokenBoard(220)}
                        <div id="token-click-overlays">${generateTokenOverlays()}</div>
                      </div>
                    </div>
                  </div>
                  <div class="scroll-usage-section" id="scroll-usage-section">
                    <!-- Scroll display will be rendered here -->
                  </div>
                </div>
                <div class="token-modal-actions">
                  <button class="btn-cancel" onclick="closePopover('token-selection-modal')">Cancel</button>
                  <button class="btn-confirm" onclick="confirmTokenSelection()">Confirm</button>
                  <button id="refill-board-btn" class="btn-refill" onclick="refillBoard()" title="Refill board from bag">Refill</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Reserved Cards Modal -->
          <div class="modal-overlay card-modal-overlay" id="reserved-modal" style="display: none;">
            <div class="modal-content card-detail-content">
              <div class="modal-body">
                <!-- Content will be injected -->
              </div>
            </div>
          </div>

          <!-- Wild Card Placement Modal -->
          <div class="modal-overlay card-modal-overlay" id="wild-placement-modal" style="display: none;">
            <div class="modal-content card-detail-content">
              <div class="modal-body">
                <!-- Content will be injected -->
              </div>
            </div>
          </div>

          <!-- Turn Completion Dialog -->
          <div class="modal-overlay card-modal-overlay" id="turn-completion-dialog" style="display: none;">
            <div class="modal-content turn-completion-content">
              <div class="turn-completion-message">
                <h3>Your turn has been completed</h3>
                <p>Click below to switch players</p>
              </div>
              <div class="turn-summary-container" id="turn-summary-container" style="display: none;">
                <div class="turn-summary-list" id="turn-summary-list"></div>
              </div>
              <button class="action-button switch-players-button" id="switch-players-btn">Switch Players</button>
            </div>
          </div>

          ${getVictoryModalMarkup()}

          <!-- Repeat Turn Dialog -->
          <div class="modal-overlay card-modal-overlay" id="repeat-turn-dialog" style="display: none;">
            <div class="modal-content turn-completion-content">
              <div class="turn-completion-message">
                <h3>Extra Turn Earned</h3>
                <p>Your completed turn is locked in. Start a fresh turn with the revealed board.</p>
              </div>
              <button class="action-button switch-players-button" id="repeat-turn-btn"
                onclick="closeRepeatTurnModal()">Start Extra Turn</button>
            </div>
          </div>

          <!-- Token Discard Modal -->
          <div class="modal-overlay card-modal-overlay" id="token-discard-modal" style="display: none;">
            <div class="modal-content token-discard-content">
              <div class="token-discard-message" id="token-discard-message">
                <!-- Message will be populated dynamically -->
              </div>
              <div class="token-discard-grid" id="token-discard-grid">
                <!-- Tokens will be populated dynamically -->
              </div>
              <div class="token-discard-actions">
                <button class="btn-minimize" id="minimize-discard-btn" onclick="minimizeDiscardModal()">Minimize</button>
                <button class="btn-confirm" id="confirm-discard-btn" onclick="confirmTokenDiscard()">Confirm</button>
              </div>
            </div>
          </div>

          <!-- Generic Confirmation Modal -->
          <div class="modal-overlay card-modal-overlay" id="confirmation-modal" style="display: none;">
            <div class="modal-content confirmation-content">
              <div class="confirmation-message" id="confirmation-message">
                <!-- Message will be populated dynamically -->
              </div>
              <div class="confirmation-actions">
                <button class="btn-cancel" id="confirmation-cancel-btn">Cancel</button>
                <button class="btn-confirm" id="confirmation-confirm-btn">Confirm</button>
              </div>
            </div>
          </div>

          
          <div class="card-pyramid ${reserveMode ? 'reserve-mode' : ''}">
            <div class="pyramid-row">
              ${reserveMode ? `
                <div class="deck-meter-container" data-clickable="reserve-deck" data-deck-level="1">
                  <div class="deck-placeholder">?</div>
                </div>
              ` : `
                <div class="deck-meter-container">
                  <div class="deck-meter">
                    <div class="meter-fill level-1" style="height: ${getDeckMeterHeight(1)}%"></div>
                  </div>
                </div>
              `}
              ${gameState.pyramid.level1.map((card, idx) => {
                card._pyramidIndex = idx;
                const afford = getAffordability(card, viewerPlayerId);
                // In reserve mode, everything is clickable for reserve unless reserved (not possible here since pyramid)
                // We use a special data attribute to intercept clicks
                const clickableData = reserveMode 
                  ? 'data-clickable="reserve-target"' 
                  : 'data-clickable="card" data-popover="card-detail-popover"';
                
                return renderCardV2(card, 'level-1-card', afford.affordable).replace('data-clickable="card" data-popover="card-detail-popover"', clickableData);
              }).join('')}
              
              <div class="card-spacer"></div>
              ${(() => {
                const availableCount = gameState.royalCards.filter(card => !card.taken).length;
                const isEmpty = availableCount === 0;
                const clickableAttr = isEmpty ? '' : 'data-clickable="popover" data-popover="royal-modal"';
                const emptyClass = isEmpty ? 'royal-cards-empty' : '';
                if (reserveMode) {
                  return `
                    <div class="reserve-royal-group reserve-mode-active">
                      <div class="reserve-mode-panel">
                        <div class="reserve-mode-title">Select a Card</div>
                        <button onclick="exitReserveMode()" class="action-button cancel-button reserve-mode-cancel">Cancel</button>
                      </div>
                    </div>
                  `;
                }
                return `
                  <div class="royal-cards-summary card-shaped ${emptyClass}" id="royal-cards-trigger" ${clickableAttr}>
                    <div class="royal-card-icon-centered ${isEmpty ? 'royal-icon-greyed' : ''}">${generateCrownIcon(32)}</div>
                    <div class="royal-card-label">${availableCount}</div>
                  </div>
                `;
              })()}
            </div>

            <div class="pyramid-row">
              ${reserveMode ? `
                <div class="deck-meter-container" data-clickable="reserve-deck" data-deck-level="2">
                  <div class="deck-placeholder">?</div>
                </div>
              ` : `
                <div class="deck-meter-container">
                  <div class="deck-meter">
                    <div class="meter-fill level-2" style="height: ${getDeckMeterHeight(2)}%"></div>
                  </div>
                </div>
              `}
              ${gameState.pyramid.level2.map((card, idx) => {
                card._pyramidIndex = idx;
                const afford = getAffordability(card, viewerPlayerId);
                const clickableData = reserveMode 
                  ? 'data-clickable="reserve-target"' 
                  : 'data-clickable="card" data-popover="card-detail-popover"';
                return renderCardV2(card, 'level-2-card', afford.affordable).replace('data-clickable="card" data-popover="card-detail-popover"', clickableData);
              }).join('')}
            </div>

            <div class="pyramid-row">
              ${reserveMode ? `
                <div class="deck-meter-container" data-clickable="reserve-deck" data-deck-level="3">
                  <div class="deck-placeholder">?</div>
                </div>
              ` : `
                <div class="deck-meter-container">
                  <div class="deck-meter">
                    <div class="meter-fill level-3" style="height: ${getDeckMeterHeight(3)}%"></div>
                  </div>
                </div>
              `}
              ${gameState.pyramid.level3.map((card, idx) => {
                card._pyramidIndex = idx;
                const afford = getAffordability(card, viewerPlayerId);
                const clickableData = reserveMode 
                  ? 'data-clickable="reserve-target"' 
                  : 'data-clickable="card" data-popover="card-detail-popover"';
                return renderCardV2(card, 'level-3-card', afford.affordable).replace('data-clickable="card" data-popover="card-detail-popover"', clickableData);
              }).join('')}
              <div class="card-spacer"></div>
              <div class="card-spacer"></div>
            </div>
          </div>
        </div>


      <!-- Global Hand Display (always at bottom) -->
      <div class="global-hand-display" id="player-hand">
        ${renderPlayerHand(turnDisplayState.activePlayerId)}
      </div>

      <div class="modal-overlay card-modal-overlay" id="hand-details-modal" style="display: none;">
        <div class="modal-content hand-details-content" id="hand-details-content"></div>
      </div>

      <!-- Mode Selection Modal -->
      <div class="modal-overlay card-modal-overlay" id="mode-selection-modal" style="display: none;">
        <div class="modal-content turn-completion-content">
          <div class="turn-completion-message">
            <h3>Choose Game Mode</h3>
            <p>How would you like to play?</p>
          </div>
          <div class="mode-selection-buttons">
            <button class="action-button" onclick="window.selectLocalMode()">Local Hotseat</button>
            <button class="action-button" onclick="window.hostOnlineGame()">Online – Host New Game</button>
            <button class="action-button" onclick="window.showJoinDialog()">Online – Join Game</button>${aiModeAvailable() ? '<button class="action-button" onclick="window.showComputerLevelPicker()">Play vs Computer</button><div id="ai-level-picker" hidden></div>' : ''}
          </div>
          <div style="margin-top: 15px; text-align: center;">
            <button class="btn-cancel" onclick="window.closeModeSelection()" style="font-size: 12px; padding: 6px 12px;">Close</button>
          </div>
        </div>
      </div>

      <!-- Join Game Modal -->
      <div class="modal-overlay card-modal-overlay" id="join-game-modal" style="display: none;">
        <div class="modal-content turn-completion-content">
          <div class="turn-completion-message">
            <h3>Join Online Game</h3>
            <p>Enter the session ID to join:</p>
            <input type="text" id="join-session-input" placeholder="Session ID" style="width: 100%; padding: 8px; margin: 10px 0; font-size: 14px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
            <p style="font-size: 12px; color: #666; margin-top: 5px;">Warning: This will replace your current game state.</p>
          </div>
          <div class="mode-selection-buttons">
            <button class="action-button" onclick="window.confirmJoinGame()">Join</button>
          </div>
          <div style="margin-top: 10px; text-align: center;">
            <button class="btn-cancel" onclick="window.closeJoinDialog()" style="font-size: 12px; padding: 6px 12px;">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Settings Modal -->
      <div class="modal-overlay card-modal-overlay" id="settings-modal" style="display: none;">
        <div class="modal-content turn-completion-content">
          <div class="turn-completion-message">
            <h3>Game Settings</h3>
            <div id="settings-content">
              <!-- Content populated dynamically -->
            </div>
          </div>
          <div class="settings-modal-footer">
            <button class="btn-cancel" onclick="window.closeSettings()" style="font-size: 12px; padding: 6px 12px;">Close</button>
          </div>
        </div>
      </div>

      <!-- Session Info Modal (for host) -->
      <div class="modal-overlay card-modal-overlay" id="session-info-modal" style="display: none;">
        <div class="modal-content turn-completion-content">
          <div class="turn-completion-message">
            <h3>Game Session Created</h3>
            <p>Share this session ID with your opponent:</p>
            <div class="session-id-display" id="session-id-display">${trimmedSessionId || ''}</div>
            <p style="font-size: 12px; color: #666; margin-top: 10px;">Or share this link:</p>
            <div class="session-link-display" id="session-link-display">${shareUrl || ''}</div>
            <div class="qr-wrapper" id="session-qr-wrapper">
              <img id="session-qr-image" src="${shareQrSrc || ''}" alt="Session QR code" style="${shareQrSrc ? '' : 'display:none;'}" />
            </div>
            <button class="action-button" onclick="window.copySessionInfo()" style="margin-top: 10px; width: 100%;">Copy Link</button>
          </div>
          <div style="margin-top: 15px; text-align: center;">
            <button class="btn-cancel" onclick="window.closeSessionInfo()" style="font-size: 12px; padding: 6px 12px;">Start Game</button>
          </div>
        </div>
      </div>
  </div>
  `;
};

// Track selected card
let selectedCard = null;
let selectedCardElement = null;
let purchaseContext = null; // { source: 'pyramid'|'reserve', reserveIndex?: number, playerId?: string }
let pendingWildCard = null; // Card waiting for color stack selection
let selectedWildColor = null;
let reservedSectionListenerAttached = false;

const attachReservedSectionDelegation = () => {
  if (reservedSectionListenerAttached) return;
  document.addEventListener('click', (event) => {
    const reservedTrigger = event.target.closest('#show-reserved');
    if (reservedTrigger) {
      event.preventDefault();
      openPopover('reserved-modal');
    }
  });
  reservedSectionListenerAttached = true;
};

// Popover management functions
const openPopover = (id, cardData = null, cardElement = null) => {
  if (isGameOver() && id !== "victory-modal" && id !== "hand-details-modal") {
    return;
  }

  const popover = document.getElementById(id);
  if (popover) {
    // Don't allow opening other modals if royal card selection is active
    if (royalCardSelectionMode && id !== 'royal-modal') {
      return;
    }
    
    closeOtherPopovers(id);
    
    if (id === 'card-detail-popover' && cardData) {
      selectedCard = cardData;
      selectedCardElement = cardElement;
      populateCardDetailPopover(cardData);
    } else if (id === 'reserved-modal') {
      populateReservedModal();
    } else if (id === 'royal-modal') {
      populateRoyalCardsModal(royalCardSelectionMode);
    } else if (id === 'wild-placement-modal') {
      // Modal content is populated by showWildPlacementModal
    }
    popover.style.display = "flex";
  }
};

const closePopover = (id) => {
  const popover = document.getElementById(id);
  if (popover) {
    popover.style.display = "none";
  }
  if (id === 'card-detail-popover') {
    selectedCard = null;
    selectedCardElement = null;
  }
  if (id === 'token-selection-modal') {
    // Clear selection when closing modal
    selectedTokens = [];
    selectionError = null;
    hideSelectionError();
    scrollSelectionMode = false;
    scrollSelectedToken = null;
    // Clear bonus token mode
    bonusTokenMode = false;
    bonusTokenRequiredColor = null;
    // Remove bonus token message and restore layout
    const modal = document.getElementById('token-selection-modal');
    if (modal) {
      const message = modal.querySelector('#bonus-token-message');
      if (message) message.remove();
      const messageSection = modal.querySelector('#bonus-token-message-section');
      if (messageSection) messageSection.remove();
      const layout = document.getElementById('token-modal-layout');
      if (layout) {
        layout.style.cssText = '';
      }
      const tokenBoardSection = layout?.querySelector('.token-board-section');
      if (tokenBoardSection) {
        tokenBoardSection.style.cssText = '';
      }
      const tokenActions = modal.querySelector('.token-modal-actions');
      if (tokenActions) {
        const cancelBtn = tokenActions.querySelector('.btn-cancel');
        const refillBtn = tokenActions.querySelector('.btn-refill');
        if (cancelBtn) cancelBtn.style.display = '';
        if (refillBtn) refillBtn.style.display = '';
      }
      // Restore scroll usage section
      const scrollSection = document.getElementById('scroll-usage-section');
      if (scrollSection) {
        scrollSection.style.display = '';
      }
    }
  }
  if (id === 'wild-placement-modal') {
    // Clear pending wild card if modal is closed without placement
    // This ensures resources aren't lost if user cancels or closes modal
    pendingWildCard = null;
    selectedWildColor = null;
  }
  if (id === 'royal-modal' && !royalCardSelectionMode) {
    // If closing royal modal in non-selection mode, make sure blocking is removed
    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
      gameContainer.classList.remove('dialog-blocking');
    }
  }
};

const closeOtherPopovers = (exceptId) => {
  const overlays = document.querySelectorAll('.modal-overlay');
  overlays.forEach(pop => {
    const modalId = pop.id;
    if (modalId && modalId !== exceptId && pop.style.display !== 'none') {
      closePopover(modalId);
    }
  });
};

// Reserved cards modal rendering
const populateReservedModal = () => {
  const modalBody = document.querySelector('#reserved-modal .modal-body');
  if (!modalBody) return;
  const reservedViewerId = (syncContext.enabled && syncContext.localPlayerId)
    ? syncContext.localPlayerId
    : getViewedPlayerId();
  const reserves = gameState.players[reservedViewerId].reserves || [];

  if (reserves.length === 0) {
    modalBody.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:20px;">
        <div style="color:#ddd; font-style:italic;">You have no reserved cards.</div>
        <button onclick="closePopover('reserved-modal')" class="action-button cancel-button">Close</button>
      </div>
    `;
    return;
  }

  const cardsHtml = reserves.map((card, idx) => {
    const afford = getAffordability(card, reservedViewerId);
    const isWild = card.color === 'wild';
    const canPlace = isWild ? canPlaceWildCard(reservedViewerId) : true;
    const canBuy = afford.affordable && canPlace;
    const cardHtml = renderCardV2(card, `level-${card.level}-card`);
    return `
      <div class="reserved-card-wrapper" style="flex:0 0 30%; max-width:30%; display:flex; flex-direction:column; align-items:center; gap:10px; padding-bottom:14px;">
        <div style="display:flex; justify-content:center; align-items:center; transform: scale(1.4); transform-origin: top center; margin-bottom:30px;">
          ${cardHtml}
        </div>
        <button class="action-button buy-button" ${canBuy ? '' : 'disabled'} data-reserve-index="${idx}">Buy</button>
      </div>
    `;
  }).join('');

  modalBody.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:12px; padding:12px; height:100%; box-sizing:border-box;">
      <div style="display:flex; justify-content:center; gap:16px; align-items:flex-start; flex-wrap:nowrap; width:100%;">
        ${cardsHtml}
      </div>
      <div style="display:flex; justify-content:center; margin-top:auto;">
        <button onclick="closePopover('reserved-modal')" class="action-button cancel-button">Close</button>
      </div>
    </div>
  `;

  // Attach buy handlers
  modalBody.querySelectorAll('.buy-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-reserve-index'), 10);
      const card = reserves[idx];
      if (!card) return;
      purchaseContext = { source: 'reserve', reserveIndex: idx, playerId: reservedViewerId };
      // Close the reserved modal first to prevent overlapping overlays
      closePopover('reserved-modal');
      openPopover('card-detail-popover', card, null);
    });
  });
};

// Wild card placement modal
const showWildPlacementModal = () => {
  if (!pendingWildCard) return;
  selectedWildColor = null;
  
  const modalBody = document.querySelector('#wild-placement-modal .modal-body');
  if (!modalBody) return;
  
  const { playerId } = pendingWildCard;
  const { cards, wildStacks } = getPlayerCards(playerId);
  const colors = ['blue', 'white', 'green', 'red', 'black'];
  
  // Get valid color stacks based on rules:
  // 1. Pile must have at least one card (wild can't be first)
  // 2. Wild can't be placed on top of another wild
  const validColors = colors.filter(color => {
    const cardCount = cards[color] || 0;
    // Must have at least one card already
    if (cardCount === 0) return false;
    // Can't place on top of another wild
    if (wildStacks[color]) return false;
    return true;
  });
  
  if (validColors.length === 0) {
    modalBody.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:20px; padding:20px;">
        <div style="color:#ff8a80; font-weight:600; text-align:center;">
          You must have a non-wild color card to place this on to.
        </div>
        <button onclick="closePopover('wild-placement-modal')" class="action-button cancel-button">Close</button>
      </div>
    `;
    openPopover('wild-placement-modal');
    return;
  }
  
  const colorOptions = validColors.map(color => {
    const cardCount = cards[color] || 0;
    const colorValue = getColorValue(color);
    const colorName = color.charAt(0).toUpperCase() + color.slice(1);
    return `
      <div class="wild-color-option" data-color="${color}" style="
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 16px;
        border: 2px solid ${colorValue};
        border-radius: 8px;
        background: white;
        cursor: pointer;
        transition: all 0.2s;
      ">
        <div style="
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: ${colorValue};
          border: 3px solid #333;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.5em;
          font-weight: bold;
          color: white;
          text-shadow: 0 0 3px rgba(0,0,0,0.5);
        ">${cardCount}</div>
        <div style="font-weight: 600; color: #333;">${colorName}</div>
      </div>
    `;
  }).join('');
  
  modalBody.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:20px; padding:20px; height:100%; box-sizing:border-box;">
      <div style="text-align:center;">
        <h3 style="margin-bottom:8px; color:#f5f5f5;">Select a Color Stack</h3>
        <p style="color:#e0e6ff; font-size:0.9em;">Choose which color stack to place this wild card in</p>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:12px; justify-content:center; flex:1; align-items:center;">
        ${colorOptions}
      </div>
      <div style="display:flex; justify-content:center; gap:12px; margin-top:auto;">
        <button onclick="closePopover('wild-placement-modal')" class="action-button cancel-button">Cancel</button>
        <button onclick="confirmWildCardPlacement()" class="action-button buy-button"
          id="confirm-wild-placement-btn" disabled>Place Wild Card</button>
      </div>
    </div>
  `;
  
  // Attach click handlers
  modalBody.querySelectorAll('.wild-color-option').forEach(option => {
    option.addEventListener('click', () => {
      selectedWildColor = option.getAttribute('data-color');
      modalBody.querySelectorAll('.wild-color-option').forEach(candidate => {
        candidate.classList.toggle('selected', candidate === option);
      });
      const confirmButton = document.getElementById('confirm-wild-placement-btn');
      if (confirmButton) confirmButton.disabled = false;
    });
    option.addEventListener('mouseenter', () => {
      option.style.transform = 'scale(1.05)';
      option.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    });
    option.addEventListener('mouseleave', () => {
      if (!option.classList.contains('selected')) {
        option.style.transform = 'scale(1)';
        option.style.boxShadow = 'none';
      }
    });
  });
  
  openPopover('wild-placement-modal');
};

const confirmWildCardPlacement = () => {
  if (!pendingWildCard || !selectedWildColor) return;
  const { playerId } = pendingWildCard;
  const { cards, wildStacks } = getPlayerCards(playerId);
  if ((cards[selectedWildColor] || 0) <= 0 || wildStacks[selectedWildColor]) return;

  placeWildCard(selectedWildColor);
};

const placeWildCard = (color) => {
  if (!pendingWildCard) return;
  
  const { card, fromReserve, reserveIndex, playerId, paymentPlan } = pendingWildCard;
  const player = gameState.players[playerId];
  
  // NOW deduct resources - only when placement is confirmed
  if (paymentPlan) {
    ['gold', 'pearl', ...purchaseColors].forEach(colorToken => {
      const spend = paymentPlan.spend[colorToken] || 0;
      if (spend > 0) {
        player.tokens[colorToken] = Math.max(0, (player.tokens[colorToken] || 0) - spend);
        // Return spent tokens to the bag
        gameState.bag[colorToken] = (gameState.bag[colorToken] || 0) + spend;
      }
    });
  }
  
  // Mark the wild card with its color stack
  card.wildColorStack = color;
  
  // Add card to player's collection
  if (fromReserve && typeof reserveIndex === 'number' && reserveIndex >= 0) {
    const reservedCard = player.reserves.splice(reserveIndex, 1)[0];
    if (reservedCard) {
      reservedCard.wildColorStack = color;
      player.cards.push(reservedCard);
    }
  } else {
    const level = card.level;
    const levelKey = `level${level}`;
    const index = card._pyramidIndex;
    player.cards.push(card);
    gameState.pyramid[levelKey].splice(index, 1);
    if (gameState.decks[levelKey].length > 0) {
      gameState.pyramid[levelKey].splice(index, 0, gameState.decks[levelKey].shift());
    }
  }
  
  pendingWildCard = null;
  selectedWildColor = null;
  closePopover('wild-placement-modal');
  renderGame();
  
  // Process card abilities after acquisition
  const acquiredCard = player.cards[player.cards.length - 1];
  logTurnEvent('card_purchased', {
    card: summarizeCard(acquiredCard),
    fromReserve: !!fromReserve,
    tokensSpent: summarizeSpend(paymentPlan?.spend || {}),
    ability: acquiredCard.ability || null
  });
  processCardAbilities(acquiredCard, playerId);
};

const showRoyalCardSelection = () => {
  royalCardSelectionMode = true;
  selectedRoyalCard = null;
  
  // Block interactions with rest of app
  const gameContainer = document.querySelector('.game-container');
  if (gameContainer) {
    gameContainer.classList.add('dialog-blocking');
  }
  
  populateRoyalCardsModal(true);
  openPopover('royal-modal');
};

const populateRoyalCardsModal = (selectionMode = false) => {
  const modalBody = document.querySelector('#royal-modal-body');
  if (!modalBody) return;

  const availableCards = gameState.royalCards.filter(card => !card.taken);
  const count = availableCards.length;
  
  // In selection mode, we need to maintain positions even for taken cards
  // So we'll show all 4 positions, with gaps for taken cards
  const allCards = gameState.royalCards; // All cards including taken ones

  if (selectionMode) {
    // Selection mode: always show 2x2 grid with gaps for taken cards
    const cardsHTML = allCards.map((card, index) => {
      if (card.taken) {
        // Show empty space
        return `<div class="royal-card-view royal-card-empty"></div>`;
      }
      
      const abilityIcon = card.ability ? generateAbilityIcon({ ability: card.ability }) : '';
      const isSelected = selectedRoyalCard && selectedRoyalCard.id === card.id;
      const selectedClass = isSelected ? 'royal-card-selected' : '';
      
      return `
        <div class="royal-card-view royal-card-clickable" data-card-id="${card.id}">
          <div class="card royal-card-large ${selectedClass}" onclick="selectRoyalCard('${card.id}')" style="cursor: pointer;">
            <!-- Gold arch background in upper right -->
            <div class="royal-card-arch"></div>
            
            <!-- Darker gold arch in upper right (smaller, higher) -->
            <div class="royal-card-arch-dark"></div>
            
            <!-- Gold bottom stripe -->
            <div class="royal-card-stripe-bottom"></div>
            
            <!-- Points in upper left -->
            <div class="royal-card-points">${card.points}</div>
            
            <!-- Ability icon in upper right -->
            ${card.ability ? `<div class="royal-card-ability">${abilityIcon}</div>` : ''}
            
            <!-- Crown in center -->
            <div class="royal-card-crown">${generateCrownIcon(40)}</div>
          </div>
        </div>
      `;
    }).join('');

    const confirmDisabled = selectedRoyalCard ? '' : 'disabled';
    
    modalBody.innerHTML = `
      <div style="display: flex; flex-direction: row; height: 100%; padding: 10px; box-sizing: border-box; gap: 10px;">
        <div class="royal-cards-view royal-grid-4" style="flex: 1; height: 100%; align-items: center; justify-content: center;">
          ${cardsHTML}
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: space-between; flex-shrink: 0; width: 120px; padding: 10px 0;">
          <div style="text-align: center; font-size: 0.95em; color: #f0f0f0; font-weight: 500; line-height: 1.4; margin-bottom: 20px;">
            You've earned a royal card! Select one to add to your hand.
          </div>
          <button onclick="confirmRoyalCardSelection()" class="action-button cancel-button" ${confirmDisabled} style="${confirmDisabled ? 'opacity: 0.5; cursor: not-allowed;' : ''}">Confirm</button>
        </div>
      </div>
    `;
    return;
  }

  // Normal view mode
  if (count === 0) {
    modalBody.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%; padding: 10px; box-sizing: border-box;">
        <div style="display: flex; justify-content: center; align-items: center; flex: 1; margin-bottom: 10px;">
          <div style="text-align: center; color: #666;">
            <div style="font-size: 1.2em; margin-bottom: 10px;">No Royal Cards Available</div>
            <div style="font-size: 0.9em;">All royal cards have been taken.</div>
          </div>
        </div>
        <div style="display: flex; gap: 10px; justify-content: center; padding-top: 6px; margin-top: auto;">
          <button onclick="closePopover('royal-modal')" class="action-button cancel-button">Close</button>
        </div>
      </div>
    `;
    return;
  }

  // Determine grid layout based on count
  let gridClass = '';
  if (count === 4) {
    gridClass = 'royal-grid-4'; // 2x2 grid
  } else if (count === 3) {
    gridClass = 'royal-grid-3'; // 2 top, 1 bottom
  } else if (count === 2) {
    gridClass = 'royal-grid-2'; // 2 in top row
  } else {
    gridClass = 'royal-grid-1'; // single card
  }

  const cardsHTML = availableCards.map(card => {
    const abilityIcon = card.ability ? generateAbilityIcon({ ability: card.ability }) : '';
    
    return `
      <div class="royal-card-view">
        <div class="card royal-card-large">
          <!-- Gold arch background in upper right -->
          <div class="royal-card-arch"></div>
          
          <!-- Darker gold arch in upper right (smaller, higher) -->
          <div class="royal-card-arch-dark"></div>
          
          <!-- Gold bottom stripe -->
          <div class="royal-card-stripe-bottom"></div>
          
          <!-- Points in upper left -->
          <div class="royal-card-points">${card.points}</div>
          
          <!-- Ability icon in upper right -->
          ${card.ability ? `<div class="royal-card-ability">${abilityIcon}</div>` : ''}
          
          <!-- Crown in center -->
          <div class="royal-card-crown">${generateCrownIcon(40)}</div>
        </div>
      </div>
    `;
  }).join('');

  modalBody.innerHTML = `
    <div style="display: flex; flex-direction: row; height: 100%; padding: 10px; box-sizing: border-box; gap: 10px;">
      <div class="royal-cards-view ${gridClass}" style="flex: 1; height: 100%; align-items: center; justify-content: center;">
        ${cardsHTML}
      </div>
      <div style="display: flex; align-items: flex-end; justify-content: center; flex-shrink: 0; width: 100px;">
        <button onclick="closePopover('royal-modal')" class="action-button cancel-button">Close</button>
      </div>
    </div>
  `;
};

const populateCardDetailPopover = (card) => {
  const modalBody = document.querySelector('#card-detail-popover .modal-body');
  if (!modalBody) return;
  
  // Render using card-v2 with large class for 3x scale
  const levelClass = `level-${card.level}-card`;
  const cardHTML = renderCardV2(card, levelClass).replace('card-v2', 'card-v2');
  
  const currentPlayerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const afford = getAffordability(card, currentPlayerId);
  const isWild = card.color === 'wild';
  const canPlace = isWild ? canPlaceWildCard(currentPlayerId) : true;
  const canBuy = afford.affordable && canPlace;

  const fromReserve = purchaseContext && purchaseContext.source === 'reserve';
  modalBody.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:10px; padding:12px; height:100%; box-sizing:border-box; position:relative;">
      ${fromReserve ? '' : ''}
      <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:flex-start; flex:1 1 auto; overflow:hidden;">
        <div style="display:flex; justify-content:center; align-items:center; transform: scale(2); transform-origin: top left; position: relative; z-index: 1;">
          ${cardHTML}
        </div>
        <div id="payment-pane-wrapper" style="flex:1 1 260px; min-width:260px; margin-left:24px; height:100%; overflow:auto; position:relative; z-index:2;">
          <div id="payment-pane"></div>
        </div>
      </div>
      <div style="display:flex; gap:10px; justify-content:center; padding-top:6px; margin-top:auto;">
        <button id="buy-button" class="action-button buy-button" ${canBuy ? '' : 'disabled'}>Buy</button>
        <button onclick="closePopover('card-detail-popover')" class="action-button cancel-button">Close</button>
      </div>
    </div>
  `;
  // Always show picker; Buy will remain disabled if invalid
  const playerId = currentPlayerId;
  const init = buildDefaultPayment(card, playerId);
  paymentState = { playerId, selection: init.selection, caps: init.caps, context: { fromReserve, reserveIndex: fromReserve ? purchaseContext.reserveIndex : null } };
  renderPaymentContent();
};

// Helper function to check if there's gold on the board
const hasGoldOnBoard = () => {
  for (let r = 0; r < gameState.board.length; r++) {
    for (let c = 0; c < gameState.board[r].length; c++) {
      if (gameState.board[r][c] === 'gold') return true;
    }
  }
  return false;
};

// Helper function to award a random gold token from the board
const awardGoldFromBoard = (player) => {
  const goldCells = [];
  for (let r = 0; r < gameState.board.length; r++) {
    for (let c = 0; c < gameState.board[r].length; c++) {
      if (gameState.board[r][c] === 'gold') goldCells.push([r, c]);
    }
  }
  if (goldCells.length > 0) {
    const [gr, gc] = goldCells[Math.floor(Math.random() * goldCells.length)];
    gameState.board[gr][gc] = null;
    player.tokens.gold = (player.tokens.gold || 0) + 1;
    return true;
  }
  return false;
};

const reserveSelectedCard = () => {
  if (!ensureLocalTurn("Reserving cards is only allowed on your turn.")) return;
  if (!selectedCard) return;
  const actionPlayerId = getActionPlayerId();
  const player = gameState.players[actionPlayerId];
  // Guard: max 3 reserves
  if (player.reserves.length >= 3) return;
  
  // Guard: must have gold on board to reserve (per official rules)
  if (!hasGoldOnBoard()) {
    alert("You cannot reserve a card when there is no gold on the board.");
    return;
  }
  
  // Check if this action will exceed token limit (reserving grants a gold token)
  const tokenCheck = willExceedTokenLimit(actionPlayerId, 1);
  if (tokenCheck.willExceed) {
    const confirmMsg = `Reserving this card will give you ${tokenCheck.after} tokens (limit is 10). You'll need to discard ${tokenCheck.excessCount} token${tokenCheck.excessCount > 1 ? 's' : ''} after this action.<br><br>Continue?`;
    showConfirmationModal(confirmMsg, () => {
      proceedWithReserveSelected();
    });
    return;
  }

  proceedWithReserveSelected();
};

const proceedWithReserveSelected = () => {
  const actionPlayerId = getActionPlayerId();
  const player = gameState.players[actionPlayerId];
  reserveMode = false;

  const reservedCardSnapshot = selectedCard ? { ...selectedCard } : null;
  const level = selectedCard.level;
  const levelKey = `level${level}`;
  const index = selectedCard._pyramidIndex;

  // Add to player reserves
  player.reserves.push(selectedCard);

  // Award a random gold token from the board
  const goldAwarded = awardGoldFromBoard(player);

  // Remove from pyramid
  gameState.pyramid[levelKey].splice(index, 1);

  // Draw new card from deck if available
  if (gameState.decks[levelKey].length > 0) {
    gameState.pyramid[levelKey].splice(index, 0, gameState.decks[levelKey].shift());
  }

  // Close popover before re-render
  closePopover('card-detail-popover');
  logTurnEvent('card_reserved', {
    card: reservedCardSnapshot ? summarizeCard(reservedCardSnapshot) : null,
    goldAwarded: goldAwarded,
    source: 'pyramid'
  });
  // Re-render the game
  renderGame();
  checkAndShowRoyalCardSelection();
};

// State for pending deck reserve
let pendingReserveDeckLevel = null;

// Reserve the top card from a deck
const reserveFromDeck = (level) => {
  if (!ensureLocalTurn("Reserving cards is only allowed on your turn.")) return;
  const actionPlayerId = getActionPlayerId();
  const player = gameState.players[actionPlayerId];
  // Guard: max 3 reserves
  if (player.reserves.length >= 3) {
    alert("You already have 3 reserved cards and cannot reserve another.");
    return;
  }
  
  // Guard: must have gold on board to reserve (per official rules)
  if (!hasGoldOnBoard()) {
    alert("You cannot reserve a card when there is no gold on the board.");
    return;
  }
  
  // Check if this action will exceed token limit (reserving grants a gold token)
  const tokenCheck = willExceedTokenLimit(actionPlayerId, 1);
  if (tokenCheck.willExceed) {
    pendingReserveDeckLevel = level;
    const confirmMsg = `Reserving this card will give you ${tokenCheck.after} tokens (limit is 10). You'll need to discard ${tokenCheck.excessCount} token${tokenCheck.excessCount > 1 ? 's' : ''} after this action.<br><br>Continue?`;
    showConfirmationModal(confirmMsg, () => {
      proceedWithReserveFromDeck(pendingReserveDeckLevel);
      pendingReserveDeckLevel = null;
    }, () => {
      pendingReserveDeckLevel = null;
    });
    return;
  }

  proceedWithReserveFromDeck(level);
};

const proceedWithReserveFromDeck = async (level) => {
  const actionPlayerId = getActionPlayerId();
  const player = gameState.players[actionPlayerId];
  reserveMode = false;
  const rollbackState = syncContext.enabled ? encodeSyncState() : null;
  
  const levelKey = `level${level}`;
  // Guard: deck must have cards
  if (gameState.decks[levelKey].length === 0) {
    alert(`The level ${level} deck is empty.`);
    return;
  }

  // Draw the top card from the deck
  const card = gameState.decks[levelKey].shift();
  
  // Add to player reserves
  player.reserves.push(card);

  // Award a random gold token from the board
  const goldAwarded = awardGoldFromBoard(player);

  closePopover('card-detail-popover');

  logTurnEvent('card_reserved', {
    card: summarizeCard(card),
    goldAwarded: goldAwarded,
    source: 'deck',
    level: level
  });

  if (syncContext.enabled) {
    const gameContainer = document.querySelector(".game-container");
    if (gameContainer) gameContainer.classList.add("dialog-blocking");
    const committed = await commitOnlineCheckpoint("reserve from hidden deck", rollbackState);
    const currentContainer = document.querySelector(".game-container");
    if (currentContainer) currentContainer.classList.remove("dialog-blocking");
    if (!committed) {
      alert("The reservation could not be saved, so the hidden card was not revealed. Please reconnect and try again.");
      return;
    }
  }
  
  // Show the reserved card before turn completion
  showReservedCardReveal(card);
};

let reserveMode = false;

// Reserve Mode Helpers
const enterReserveMode = () => {
  if (!ensureLocalTurn("Reserving cards is only allowed on your turn.")) return;
  
  const actionPlayerId = getActionPlayerId();
  const player = gameState.players[actionPlayerId];
  if (player.reserves.length >= 3) {
    alert("You already have 3 reserved cards and cannot reserve another.");
    return;
  }
  if (!hasGoldOnBoard()) {
    alert("You cannot reserve a card when there is no gold on the board.");
    return;
  }

  reserveMode = true;
  renderGame();
};

const exitReserveMode = () => {
  reserveMode = false;
  renderGame();
};

const confirmReserveFromPyramid = (card) => {
  selectedCard = card; // Set global selection for the action
  const modalBody = document.querySelector('#card-detail-popover .modal-body');
  if (modalBody) {
    const cardHTML = renderCardV2(card, `level-${card.level}-card`);
    modalBody.innerHTML = `
      <div class="reserve-confirm-modal">
        <h3>Reserve this card?</h3>
        <div class="reserve-confirm-card-wrapper">
          <div class="reserve-confirm-card-container">
            ${cardHTML}
          </div>
        </div>
        <div class="reserve-confirm-actions">
          <button onclick="reserveSelectedCard()" class="action-button reserve-button">Confirm Reserve</button>
          <button onclick="closePopover('card-detail-popover')" class="action-button cancel-button">Cancel</button>
        </div>
      </div>
    `;
    openPopover('card-detail-popover');
  }
};

const confirmReserveFromDeck = (level) => {
  const modalBody = document.querySelector('#card-detail-popover .modal-body');
  if (modalBody) {
    modalBody.innerHTML = `
      <div class="reserve-confirm-modal">
        <h3 class="reserve-confirm-title">Reserve from Level ${level} Deck?</h3>
        <div class="reserve-confirm-card-wrapper">
          <div class="reserve-confirm-card-container">
            <div class="face-down-card">?</div>
          </div>
        </div>
        <div class="reserve-confirm-actions">
          <button onclick="reserveFromDeck(${level})" class="action-button reserve-button">Confirm Reserve</button>
          <button onclick="closePopover('card-detail-popover')" class="action-button cancel-button">Cancel</button>
        </div>
      </div>
    `;
    openPopover('card-detail-popover');
  }
};

const handleReserveRevealContinue = () => {
  closePopover('card-detail-popover');
  setTimeout(() => {
    renderGame();
    setTimeout(() => checkAndShowRoyalCardSelection(), 50);
  }, 50);
};

// Show the reserved card after deck reserve
const showReservedCardReveal = (card) => {
  const modalBody = document.querySelector('#card-detail-popover .modal-body');
  if (modalBody) {
    const cardHTML = renderCardV2(card, `level-${card.level}-card`);
    modalBody.innerHTML = `
      <div class="reserve-confirm-modal">
        <h3 class="reserve-confirm-title">You Reserved</h3>
        <div class="reserve-confirm-card-wrapper">
          <div class="reserve-confirm-card-container">
            ${cardHTML}
          </div>
        </div>
        <div class="reserve-confirm-actions">
          <button onclick="handleReserveRevealContinue()" class="action-button reserve-button">Continue</button>
        </div>
      </div>
    `;
    openPopover('card-detail-popover');
  } else {
    // Fallback if modal not available
    renderGame();
    checkAndShowRoyalCardSelection();
  }
};

// Token selection state
let selectedTokens = [];
let selectionError = null;
let scrollSelectionMode = false;
let scrollSelectedToken = null;

const resetTransientActionState = () => {
  selectedCard = null;
  selectedCardElement = null;
  purchaseContext = null;
  pendingWildCard = null;
  paymentState = null;
  pendingReserveDeckLevel = null;
  reserveMode = false;
  selectedTokens = [];
  selectionError = null;
  scrollSelectionMode = false;
  scrollSelectedToken = null;
  selectedRoyalCard = null;
  royalCardSelectionMode = false;
  bonusTokenMode = false;
  bonusTokenRequiredColor = null;
  stealTokenMode = false;
  selectedStealColor = null;
  selectedWildColor = null;
  tokensToDiscard = [];
  tokenDiscardMode = false;
  requiredDiscardCount = 0;
  discardModalMinimized = false;
  turnDialogMode = null;
  turnCheckpointCommitted = false;
  turnCheckpointPromise = null;
  turnHandoffInProgress = false;
};

// Toggle token selection
const toggleTokenSelection = (row, col) => {
  if (!ensureLocalTurn("Token selection is only available on your turn.")) return;
  const token = gameState.board[row][col];
  
  // Gold tokens can never be selected
  if (token === 'gold') {
    return;
  }
  
  // Empty spaces can't be selected
  if (!token) {
    return;
  }
  
  // Handle scroll selection mode
  if (scrollSelectionMode) {
    // In scroll mode, select a single token
    scrollSelectedToken = { row, col, token };
    renderScrollUsageSection();
    renderTokenBoard();
    return;
  }
  
  // Bonus token mode: only allow ONE token of the required color
  if (bonusTokenMode) {
    // If clicking the same token, deselect it
    const index = selectedTokens.findIndex(t => t.row === row && t.col === col);
    if (index !== -1) {
      selectedTokens.splice(index, 1);
    } else {
      // Check if token matches required color
      if (token !== bonusTokenRequiredColor) {
        showSelectionError(`You must select a ${bonusTokenRequiredColor} token`);
        return;
      }
      // Clear any existing selection and select this one
      selectedTokens = [{ row, col, token }];
    }
    // Clear error message
    selectionError = null;
    hideSelectionError();
    // Re-render the token board to show selection state
    renderTokenBoard();
    return;
  }
  
  // Normal token selection mode
  // Toggle selection
  const index = selectedTokens.findIndex(t => t.row === row && t.col === col);
  if (index !== -1) {
    selectedTokens.splice(index, 1);
  } else {
    selectedTokens.push({ row, col, token });
  }
  
  // Clear error message
  selectionError = null;
  hideSelectionError();
  
  // Re-render the token board to show selection state
  renderTokenBoard();
  // Partial selections stay editable (players may pick the ends of a line before the middle);
  // a full set of three that is not a straight line is flagged immediately, anything else at Confirm.
  if (selectedTokens.length === 3) {
    const validation = validateTokenSelection();
    if (!validation.valid) showSelectionError(validation.message);
  }
};

// Validate token selection
const validateTokenSelection = () => {
  // Bonus token mode: only allow ONE token of the required color
  if (bonusTokenMode) {
    if (selectedTokens.length === 0) {
      return { valid: false, message: `You must select ONE ${bonusTokenRequiredColor} token` };
    }
    if (selectedTokens.length > 1) {
      return { valid: false, message: 'You can only select ONE token as bonus' };
    }
    // Check if the selected token matches the required color
    const selectedToken = selectedTokens[0];
    const token = gameState.board[selectedToken.row][selectedToken.col];
    if (token !== bonusTokenRequiredColor) {
      return { valid: false, message: `You must select a ${bonusTokenRequiredColor} token` };
    }
    return { valid: true };
  }
  
  // Normal token selection mode
  if (selectedTokens.length === 0 || selectedTokens.length > 3) {
    return { valid: false, message: 'You must select between 1 and 3 tokens' };
  }
  
  const positions = selectedTokens.map(t => [t.row, t.col]);
  if (!isStraightLine(positions)) {
    return { valid: false, message: 'Tokens must be adjacent and in a straight line' };
  }
  return checkLineForGoldOrEmpty(positions);
};

// Check if line contains gold or empty spaces
const checkLineForGoldOrEmpty = (positions) => {
  for (const [row, col] of positions) {
    const token = gameState.board[row][col];
    if (!token || token === 'gold') {
      return { 
        valid: false, 
        message: 'A straight line of tokens may not include gold tokens or empty spaces' 
      };
    }
  }
  return { valid: true };
};

// Show selection error
const showSelectionError = (message) => {
  const modal = document.getElementById('token-selection-modal');
  if (!modal) return;
  
  // Create error overlay above modal
  let errorDiv = document.getElementById('token-selection-error');
  if (!errorDiv) {
    errorDiv = document.createElement('div');
    errorDiv.id = 'token-selection-error';
    errorDiv.style.cssText = `
      position: absolute;
      top: -80px;
      left: 50%;
      transform: translateX(-50%);
      background: #e74c3c;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      white-space: nowrap;
      z-index: 130;
      font-weight: bold;
      animation: slideIn 0.2s ease;
    `;
    
    // Add animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }
    `;
    document.head.appendChild(style);
    
    modal.parentElement.style.position = 'relative';
    modal.parentElement.appendChild(errorDiv);
  }
  
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
};

// Hide selection error
const hideSelectionError = () => {
  const errorDiv = document.getElementById('token-selection-error');
  if (errorDiv) {
    errorDiv.style.display = 'none';
  }
};

// Generate clickable overlay divs for each token space
const generateTokenOverlays = () => {
  const size = 220;
  
  // Match the SVG calculation from generateTokenBoard
  const marginWidth = size * 0.03;
  const marginInnerSize = size - marginWidth * 2;
  const gridSize = marginInnerSize;
  const gridCellSize = gridSize / 5;
  
  let html = '';
  
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const token = gameState.board[row][col];
      const isSelected = selectedTokens.some(t => t.row === row && t.col === col);
      const isScrollSelected = scrollSelectionMode && scrollSelectedToken && 
                               scrollSelectedToken.row === row && scrollSelectedToken.col === col;
      const isGold = token === 'gold';
      const isEmpty = !token;
      
      // Use the same positioning calculation as the SVG
      const left = marginWidth + col * gridCellSize;
      const top = marginWidth + row * gridCellSize;
      
      let classes = 'token-overlay';
      if (isSelected) classes += ' selected';
      if (isScrollSelected) classes += ' scroll-selected';
      if (isGold) classes += ' gold-token';
      if (isEmpty) classes += ' empty';
      
      const cursorStyle = isGold || isEmpty ? 'default' : 'pointer';
      
      html += `<div class="${classes}" 
                     data-row="${row}" 
                     data-col="${col}"
                     style="position: absolute; 
                            left: ${left}px; 
                            top: ${top}px; 
                            width: ${gridCellSize}px; 
                            height: ${gridCellSize}px;
                            cursor: ${cursorStyle};"></div>`;
    }
  }
  
  return html;
};

// Re-render token board in modal
const renderTokenBoard = () => {
  const tokenContainer = document.getElementById('token-board-container');
  if (tokenContainer) {
    // Render the SVG
    const svg = tokenContainer.querySelector('.token-board-svg');
    if (svg) {
      svg.outerHTML = generateTokenBoard(220);
    }
    
    // Render overlays
    const overlayContainer = document.getElementById('token-click-overlays');
    if (overlayContainer) {
      overlayContainer.innerHTML = generateTokenOverlays();
    }
    
    // Show/hide normal token selection buttons based on scroll mode
    const tokenActions = document.querySelector('.token-modal-actions');
    if (tokenActions) {
      tokenActions.style.display = scrollSelectionMode ? 'none' : 'flex';
    }
    
    attachTokenBoardListeners();
    renderScrollUsageSection();
  }
};

// Attach click listeners to token board
const attachTokenBoardListeners = () => {
  // Remove existing listeners
  const existingOverlays = document.querySelectorAll('.token-overlay');
  existingOverlays.forEach(overlay => {
    const handler = overlay._clickHandler;
    if (handler) {
      overlay.removeEventListener('click', handler);
    }
  });
  
  // Add new listeners
  const overlays = document.querySelectorAll('.token-overlay');
  overlays.forEach(overlay => {
    const handler = (e) => {
      const row = parseInt(overlay.dataset.row);
      const col = parseInt(overlay.dataset.col);
      toggleTokenSelection(row, col);
    };
    overlay._clickHandler = handler;
    overlay.addEventListener('click', handler);
  });
};

// Confirm token selection
const confirmTokenSelection = () => {
  if (!ensureLocalTurn("Token selection is only available on your turn.")) return;
  // Don't allow normal token selection if in scroll mode
  if (scrollSelectionMode) {
    return;
  }
  
  const validation = validateTokenSelection();
  
  if (!validation.valid) {
    showSelectionError(validation.message);
    return;
  }
  
  // Check if this action will exceed token limit
  const currentPlayer = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const tokenCheck = willExceedTokenLimit(currentPlayer, selectedTokens.length);
  if (tokenCheck.willExceed) {
    const confirmMsg = `This will give you ${tokenCheck.after} tokens (limit is 10). You'll need to discard ${tokenCheck.excessCount} token${tokenCheck.excessCount > 1 ? 's' : ''} after this action.<br><br>Continue?`;
    showConfirmationModal(confirmMsg, () => {
      proceedWithTokenSelection();
    });
    return;
  }
  
  // No warning needed, proceed directly
  proceedWithTokenSelection();
};

// Proceed with token selection (after validation and confirmation)
const proceedWithTokenSelection = () => {
  const currentPlayer = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  // Add tokens to player's hand
  const otherPlayer = currentPlayer === 'player1' ? 'player2' : 'player1';
  const selectedColors = selectedTokens.map(({ token }) => token);
  let scrollAwardedTo = null;
  const scrollReasons = [];
  
  // Track token colors for scroll checks
  let pearlCount = 0;
  
  selectedTokens.forEach(({ token }) => {
    gameState.players[currentPlayer].tokens[token]++;
    
    // Count pearls for scroll check
    if (token === 'pearl') {
      pearlCount++;
    }
  });
  
  // Check for scroll conditions
  // 1. Three matching color tokens (exactly 3 tokens, all same color)
  if (selectedTokens.length === 3) {
    const tokenTypes = selectedTokens.map(({ token }) => token).filter(t => t !== 'gold');
    if (tokenTypes.length === 3 && tokenTypes.every(t => t === tokenTypes[0])) {
      awardScroll(otherPlayer);
      scrollAwardedTo = otherPlayer;
      scrollReasons.push('three_match');
    }
  }
  
  // 2. Two pearls
  if (pearlCount === 2) {
    awardScroll(otherPlayer);
    scrollAwardedTo = otherPlayer;
    scrollReasons.push('two_pearls');
  }
  
  // Remove tokens from board
  selectedTokens.forEach(({ row, col }) => {
    gameState.board[row][col] = null;
  });
  
  // Clear selection
  selectedTokens = [];
  selectionError = null;
  
  const tokensSummary = aggregateTokens(selectedColors);
  if (tokensSummary.length > 0) {
    logTurnEvent(bonusTokenMode ? 'bonus_token_collected' : 'tokens_taken', {
      tokens: tokensSummary,
      scrollAwardedTo,
      scrollReasons,
      bonusColor: bonusTokenMode ? bonusTokenRequiredColor : null
    });
  }
  
  // Close modal before re-rendering
  closePopover('token-selection-modal');
  
  // Clear bonus token mode if active
  if (bonusTokenMode) {
    bonusTokenMode = false;
    bonusTokenRequiredColor = null;
    // Remove bonus token message and restore layout
    const modal = document.getElementById('token-selection-modal');
    if (modal) {
      const message = modal.querySelector('#bonus-token-message');
      if (message) message.remove();
      const messageSection = modal.querySelector('#bonus-token-message-section');
      if (messageSection) messageSection.remove();
      const layout = document.getElementById('token-modal-layout');
      if (layout) {
        layout.style.cssText = '';
      }
      const tokenBoardSection = layout?.querySelector('.token-board-section');
      if (tokenBoardSection) {
        tokenBoardSection.style.cssText = '';
      }
      const tokenActions = modal.querySelector('.token-modal-actions');
      if (tokenActions) {
        const cancelBtn = tokenActions.querySelector('.btn-cancel');
        const refillBtn = tokenActions.querySelector('.btn-refill');
        if (cancelBtn) cancelBtn.style.display = '';
        if (refillBtn) refillBtn.style.display = '';
      }
      // Restore scroll usage section
      const scrollSection = document.getElementById('scroll-usage-section');
      if (scrollSection) {
        scrollSection.style.display = '';
      }
    }
  }
  
  // Re-render game to show updated tokens
  renderGame();
  
  checkAndShowRoyalCardSelection();
};

// Generate spiral positions from center (2,2) outward clockwise for 5x5 board
// Returns array of [row, col] positions in order 1-25
// Uses the same spiral pattern as getSpiralOrder for consistency
const generateSpiralPositions = () => {
  return getSpiralOrder(5);
};

// Check if bag has any tokens
const isBagEmpty = () => {
  return Object.values(gameState.bag).every(count => count === 0);
};

// Convert bag object to flat array of token types
const bagToArray = () => {
  const tokens = [];
  Object.keys(gameState.bag).forEach(color => {
    for (let i = 0; i < (gameState.bag[color] || 0); i++) {
      tokens.push(color);
    }
  });
  return tokens;
};

// Shuffle array using Fisher-Yates algorithm
const shuffleArray = (array) => {
  return shuffle(array);
};

// Refill board from bag in spiral order
const refillBoard = () => {
  if (!ensureLocalTurn("Refilling the board is only possible on your turn.")) return;
  if (isBagEmpty() || hasRefilledBoardThisTurn()) {
    return;
  }
  
  // Show confirmation before refilling
  showConfirmationModal("Are you sure you want to refill the board?<br><br>Your opponent will receive a scroll.", () => {
    proceedWithRefillBoard();
  });
};

const proceedWithRefillBoard = async () => {
  if (!ensureLocalTurn("Refilling the board is only possible on your turn.")) return;
  if (isBagEmpty() || hasRefilledBoardThisTurn()) return;

  const stateBeforeRefill = syncContext.enabled ? encodeSyncState() : null;
  const gameContainer = document.querySelector(".game-container");
  if (gameContainer && syncContext.enabled) {
    gameContainer.classList.add("dialog-blocking");
  }

  // Get all tokens from bag as flat array and shuffle
  const bagTokens = bagToArray();
  const shuffled = shuffleArray(bagTokens);
  
  // Get spiral positions
  const spiralPositions = generateSpiralPositions();
  
  // Clear bag
  Object.keys(gameState.bag).forEach(color => {
    gameState.bag[color] = 0;
  });
  
  // Fill empty spaces on board in spiral order
  let tokenIndex = 0;
  for (const [row, col] of spiralPositions) {
    // Only fill if space is empty and we have tokens
    if (!gameState.board[row][col] && tokenIndex < shuffled.length) {
      gameState.board[row][col] = shuffled[tokenIndex];
      tokenIndex++;
    }
  }
  
  // Award scroll to the other player when board is refilled
  const currentPlayer = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const otherPlayer = currentPlayer === 'player1' ? 'player2' : 'player1';
  const scrollAwarded = awardScroll(otherPlayer);
  logTurnEvent('board_refilled', {
    tokensPlaced: tokenIndex,
    tokens: aggregateTokens(shuffled.slice(0, tokenIndex)),
    scrollAwardedTo: scrollAwarded ? otherPlayer : null
  });
  
  // Mark that board was refilled (disables scroll usage)
  ensureCurrentTurnState().boardRefilled = true;

  if (syncContext.enabled) {
    try {
      await pushStateUpdate("board refill");
      syncContext.syncStatus = "online";
    } catch (error) {
      if (error.current) {
        syncContext.version = error.current.version;
        gameSyncClient.version = error.current.version;
        applySyncedState(error.current.state_blob);
      } else if (stateBeforeRefill) {
        applySyncedState(stateBeforeRefill);
      }
      syncContext.syncStatus = "degraded";
      updateSyncUI();
      alert("The refill could not be saved, so the previous board was restored. Please reconnect and try again.");
      return;
    } finally {
      const currentContainer = document.querySelector(".game-container");
      if (currentContainer) currentContainer.classList.remove("dialog-blocking");
    }
  }
  
  // Re-render token board if modal is open (keep it open)
  const modal = document.getElementById('token-selection-modal');
  const wasOpen = modal && modal.style.display === 'flex';
  
  if (wasOpen) {
    renderTokenBoard();
    updateRefillButtonState();
    renderScrollUsageSection();
  }
  
  // Update the main game display
  // Preserve modal open state
  renderGame();
  
  // Re-open modal if it was open
  if (wasOpen) {
    setTimeout(() => {
      const modalAfter = document.getElementById('token-selection-modal');
      if (modalAfter) {
        modalAfter.style.display = 'flex';
        attachTokenBoardListeners();
        updateRefillButtonState();
        renderScrollUsageSection();
      }
    }, 10);
  }
};

// Render scroll usage section
const renderScrollUsageSection = () => {
  const section = document.getElementById('scroll-usage-section');
  const layout = document.getElementById('token-modal-layout');
  if (!section || !layout) return;
  
  const currentPlayerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const player = gameState.players[currentPlayerId];
  const scrollCount = player.privileges || 0;
  
  const hasScrolls = scrollCount > 0;
  layout.classList.toggle('has-scrolls', hasScrolls);
  
  if (!hasScrolls) {
    section.innerHTML = '';
    section.style.display = 'none';
    return;
  }
  
  section.style.display = 'flex';
  
  if (scrollSelectionMode) {
    // Scroll selection mode
    let html = '<div class="scroll-selection-mode">';
    html += '<div class="scroll-selection-label">Choose your token</div>';
    
    if (scrollSelectedToken) {
      html += '<button class="btn-confirm-scroll" id="confirm-scroll-btn" onclick="confirmScrollSelection()">Confirm</button>';
    }
    
    html += '<button class="btn-cancel-scroll" onclick="cancelScrollSelection()">Cancel</button>';
    html += '</div>';
    section.innerHTML = html;
  } else {
    // Normal scroll display
    let html = '<div class="scroll-display-container">';
    html += '<div class="scroll-display-label">Use a scroll:</div>';
    html += '<div class="scroll-icons-container">';
    const iconSize = scrollCount > 2 ? 24 : 28;
    
    for (let i = 0; i < scrollCount; i++) {
      const disabled = hasRefilledBoardThisTurn() ? 'disabled' : '';
      html += `<div class="scroll-icon ${disabled}" data-scroll-index="${i}" onclick="${disabled ? '' : 'enterScrollSelectionMode()'}">`;
      html += `<span class="privilege-scroll-emoji" style="font-size: ${iconSize}px;">🗞️</span>`;
      html += '</div>';
    }
    
    html += '</div>';
    
    if (hasRefilledBoardThisTurn()) {
      html += '<div class="scroll-disabled-message">You may not use scrolls after refilling the board</div>';
    }
    
    html += '</div>';
    section.innerHTML = html;
  }
};

// Enter scroll selection mode
const enterScrollSelectionMode = () => {
  if (!ensureLocalTurn("Scrolls can only be used during your turn.")) return;
  const player = gameState.players[getCurrentPlayerId()];
  if ((player.privileges || 0) <= 0 || hasRefilledBoardThisTurn()) return;
  scrollSelectionMode = true;
  scrollSelectedToken = null;
  selectedTokens = [];
  selectionError = null;
  hideSelectionError();
  renderScrollUsageSection();
  // Update token overlays to allow single token selection
  renderTokenBoard();
};

// Cancel scroll selection
const cancelScrollSelection = () => {
  scrollSelectionMode = false;
  scrollSelectedToken = null;
  renderScrollUsageSection();
  renderTokenBoard();
};

// Confirm scroll selection
const confirmScrollSelection = () => {
  if (!ensureLocalTurn("Scrolls can only be used during your turn.")) return;
  if (!scrollSelectedToken) return;
  
  const currentPlayerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const selectedBoardToken = gameState.board[scrollSelectedToken.row]?.[scrollSelectedToken.col];
  if ((gameState.players[currentPlayerId].privileges || 0) <= 0 || hasRefilledBoardThisTurn()) return;
  if (!selectedBoardToken || selectedBoardToken === "gold" || selectedBoardToken !== scrollSelectedToken.token) return;
  
  // Check if this action will exceed token limit
  const tokenCheck = willExceedTokenLimit(currentPlayerId, 1);
  if (tokenCheck.willExceed) {
    const confirmMsg = `Using this scroll will give you ${tokenCheck.after} tokens (limit is 10). You'll need to discard ${tokenCheck.excessCount} token${tokenCheck.excessCount > 1 ? 's' : ''} after this action.<br><br>Continue?`;
    showConfirmationModal(confirmMsg, () => {
      proceedWithScrollSelection();
    });
    return;
  }
  
  // No warning needed, proceed directly
  proceedWithScrollSelection();
};

// Proceed with scroll selection (after confirmation)
const proceedWithScrollSelection = async () => {
  const currentPlayerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const player = gameState.players[currentPlayerId];
  if (!scrollSelectedToken || hasRefilledBoardThisTurn()) return;
  const selectedBoardToken = gameState.board[scrollSelectedToken.row]?.[scrollSelectedToken.col];
  if (!selectedBoardToken || selectedBoardToken === "gold" || selectedBoardToken !== scrollSelectedToken.token) return;
  const rollbackState = syncContext.enabled ? encodeSyncState() : null;
  const selectedToken = { ...scrollSelectedToken };
  if (!spendPrivilege(gameState, currentPlayerId)) return;
  
  // Add token to player's hand
  player.tokens[selectedToken.token]++;
  
  // Remove token from board
  gameState.board[selectedToken.row][selectedToken.col] = null;
  
  logTurnEvent('scroll_token', {
    token: selectedToken.token
  });
  
  // Reset scroll selection state
  scrollSelectedToken = null;
  scrollSelectionMode = false;

  if (syncContext.enabled) {
    const gameContainer = document.querySelector(".game-container");
    if (gameContainer) gameContainer.classList.add("dialog-blocking");
    const committed = await commitOnlineCheckpoint("Privilege token taken", rollbackState);
    const currentContainer = document.querySelector(".game-container");
    if (currentContainer) currentContainer.classList.remove("dialog-blocking");
    if (!committed) {
      alert("The Privilege action could not be saved, so it was rolled back. Please reconnect and try again.");
      return;
    }
  }
  
  // Re-render board and scroll section (board stays open)
  renderTokenBoard();
  renderScrollUsageSection();
  
  // Update the main game display to reflect new token count
  // Preserve modal open state
  const modal = document.getElementById('token-selection-modal');
  const wasOpen = modal && modal.style.display === 'flex';
  renderGame();
  
  // Re-open modal if it was open
  if (wasOpen) {
    setTimeout(() => {
      const modalAfter = document.getElementById('token-selection-modal');
      if (modalAfter) {
        modalAfter.style.display = 'flex';
        attachTokenBoardListeners();
        updateRefillButtonState();
        renderScrollUsageSection();
      }
    }, 10);
  }
};

// Update refill button disabled state
const updateRefillButtonState = () => {
  const refillBtn = document.getElementById('refill-board-btn');
  if (refillBtn) {
    refillBtn.disabled = isBagEmpty() || hasRefilledBoardThisTurn();
  }
};

// Royal card selection functions
const selectRoyalCard = (cardId) => {
  if (!ensureLocalTurn("Only the active player can claim a royal card.")) return;
  if (!royalCardSelectionMode) return;
  
  const card = gameState.royalCards.find(c => c.id === cardId && !c.taken);
  if (!card) return;
  
  selectedRoyalCard = card;
  
  // Re-render the modal to update selection state and enable confirm button
  populateRoyalCardsModal(true);
  
  // Update the confirm button state
  const confirmBtn = document.querySelector('#royal-modal-body button');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = '1';
    confirmBtn.style.cursor = 'pointer';
  }
};

const confirmRoyalCardSelection = () => {
  if (!ensureLocalTurn("Only the active player can confirm a royal card.") || !royalCardSelectionMode || !selectedRoyalCard) return;

  const currentPlayerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const player = gameState.players[currentPlayerId];
  
  // Add card to player's hand (points are added automatically via getPlayerVictoryStats)
  // Create a card object that matches the structure
  const royalCard = {
    ...selectedRoyalCard,
    level: 3, // Royal cards are level 3
    color: 'none', // Royal cards don't have a color
    crowns: 0, // Royal cards don't add crowns
    costs: {} // Royal cards have no costs
  };
  player.cards.push(royalCard);
  
  // Mark card as taken
  selectedRoyalCard.taken = true;
  logTurnEvent('royal_acquired', {
    card: summarizeCard(royalCard)
  });
  
  // Reset selection state
  selectedRoyalCard = null;
  royalCardSelectionMode = false;
  
  // Remove blocking class
  const gameContainer = document.querySelector('.game-container');
  if (gameContainer) {
    gameContainer.classList.remove('dialog-blocking');
  }
  
  // Close modal
  closePopover('royal-modal');
  
  // Re-render game
  renderGame();
  
  // Process card abilities after acquisition
  processCardAbilities(royalCard, currentPlayerId);
};

// Expose to global scope for onclick handlers
window.reserveSelectedCard = reserveSelectedCard;
window.reserveFromDeck = reserveFromDeck;
window.enterReserveMode = enterReserveMode;
window.exitReserveMode = exitReserveMode;
window.confirmReserveFromPyramid = confirmReserveFromPyramid;
window.confirmReserveFromDeck = confirmReserveFromDeck;
window.showReservedCardReveal = showReservedCardReveal;
window.handleReserveRevealContinue = handleReserveRevealContinue;
window.confirmTokenSelection = confirmTokenSelection;
window.refillBoard = refillBoard;
window.enterScrollSelectionMode = enterScrollSelectionMode;
window.cancelScrollSelection = cancelScrollSelection;
window.closePopover = closePopover;
window.confirmScrollSelection = confirmScrollSelection;
window.confirmWildCardPlacement = confirmWildCardPlacement;
window.selectRoyalCard = selectRoyalCard;
window.confirmRoyalCardSelection = confirmRoyalCardSelection;
window.confirmStealToken = confirmStealToken;
window.closeRepeatTurnModal = closeRepeatTurnModal;
window.startNewGameFromGameOver = startNewGameFromGameOver;
window.confirmNewGameFromGameOver = confirmNewGameFromGameOver;
window.reopenVictoryModal = reopenVictoryModal;
// Deprecated: payment now renders inline in the same modal

// Close any open popover on escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const openPopovers = document.querySelectorAll(".modal-overlay[style*='flex']");
    openPopovers.forEach(popover => {
      // Don't close turn completion dialog, repeat turn dialog, token discard modal, or royal modal in selection mode with ESC
      if (popover.id !== 'turn-completion-dialog' && 
          popover.id !== 'repeat-turn-dialog' && 
          popover.id !== 'token-discard-modal' &&
          popover.id !== 'victory-modal' &&
          popover.id !== 'steal-token-modal' &&
          !(popover.id === 'token-selection-modal' && bonusTokenMode) &&
          !(popover.id === 'royal-modal' && royalCardSelectionMode)) {
        popover.style.display = "none";
      }
    });
  }
});


// Helper function to count total tokens in player hand (including pearls and golds)
const getTotalTokenCount = (playerId) => {
  const player = gameState.players[playerId];
  const tokenColors = ['blue', 'white', 'green', 'black', 'red', 'pearl', 'gold'];
  return tokenColors.reduce((total, color) => total + (player.tokens[color] || 0), 0);
};

// Helper function to check if gaining tokens will exceed the 10-token limit
const willExceedTokenLimit = (playerId, tokensToGain) => {
  const current = getTotalTokenCount(playerId);
  const after = current + tokensToGain;
  const willExceed = after > 10;
  const excessCount = willExceed ? after - 10 : 0;
  return { willExceed, current, after, excessCount };
};

// Turn switching system functions
// Check if player has earned a royal card and show selection if needed
const checkAndShowRoyalCardSelection = () => {
  if (isGameOver()) {
    openVictoryModal();
    return;
  }

  const currentPlayerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const stats = getPlayerVictoryStats(currentPlayerId);
  const currentCrowns = stats.totalCrowns;
  const previousCrowns = previousCrownCounts[currentPlayerId];
  
  // Check for threshold crossings
  const earnedRoyalCard = 
    (previousCrowns < 3 && currentCrowns >= 3 && currentCrowns <= 5) ||
    (previousCrowns >= 3 && previousCrowns <= 5 && currentCrowns >= 6);
  
  if (earnedRoyalCard) {
    // Update previous count
    previousCrownCounts[currentPlayerId] = currentCrowns;
    
    // Show royal card selection modal
    showRoyalCardSelection();
  } else {
    // Resolve the Royal and its ability before offering a single end-of-turn
    // discard. Ability callbacks return here after all token gains are finished.
    if (getTotalTokenCount(currentPlayerId) > 10) {
      showTokenDiscardModal();
      return;
    }

    // Update previous count and continue with end-of-turn checks.
    previousCrownCounts[currentPlayerId] = currentCrowns;
    const { conditions } = getVictoryConditions(currentPlayerId);
    if (conditions.length > 0) {
      finalizeGameOverState(currentPlayerId, conditions, stats);
      finalizePendingTurn("victory");
      syncAfterTurn();
      renderGame();
      openVictoryModal();
      return;
    }

    if (ensureCurrentTurnState().extraTurnsPending > 0) {
      showRepeatTurnModal();
    } else {
      const dialogMode = syncContext.enabled ? "online_end" : "local_end";
      showTurnCompletionDialog(dialogMode);
    }
  }
};

const persistCompletedTurnCheckpoint = async (
  buttonId = "switch-players-btn",
  readyLabel = "End Turn"
) => {
  if (!syncContext.enabled || turnCheckpointCommitted) return true;
  if (turnCheckpointPromise) return turnCheckpointPromise;

  turnCheckpointPromise = (async () => {
    const button = document.getElementById(buttonId);
    if (button) {
      button.disabled = true;
      button.textContent = "Saving turn...";
    }

    const committed = await commitOnlineCheckpoint("completed mandatory action", null);
    if (committed) turnCheckpointCommitted = true;

    const currentButton = document.getElementById(buttonId);
    if (currentButton && isLocalPlayersTurn() && ensureCurrentTurnState().actionCompleted) {
      currentButton.disabled = false;
      currentButton.textContent = committed ? readyLabel : "Retry Save";
    }
    const dialogId = buttonId === "repeat-turn-btn" ? "repeat-turn-dialog" : "turn-completion-dialog";
    const checkpointDialog = document.getElementById(dialogId);
    if (checkpointDialog) {
      checkpointDialog.classList.toggle("checkpoint-pending", !committed);
    }
    return committed;
  })();

  try {
    return await turnCheckpointPromise;
  } finally {
    turnCheckpointPromise = null;
  }
};

const showTurnCompletionDialog = (mode = (syncContext.enabled ? 'online_end' : 'local_end')) => {
  if (mode === 'online_start') {
    clearTurnGuardMessage();
  }

  if (mode === "online_end") {
    const turnState = ensureCurrentTurnState();
    if (!turnState.actionCompleted) {
      turnState.actionCompleted = true;
      turnCheckpointCommitted = false;
    }
  }
  
  turnDialogMode = mode;
  
  const dialog = document.getElementById('turn-completion-dialog');
  if (!dialog) return;
  
  // Update dialog text based on mode
  const messageEl = dialog.querySelector('.turn-completion-message');
  const buttonEl = dialog.querySelector('#switch-players-btn');
  
  if (messageEl) {
    if (mode === 'online_end') {
      messageEl.querySelector('h3').textContent = 'Your turn has been completed';
      messageEl.querySelector('p').textContent = 'Waiting for your opponent...';
    } else if (mode === 'online_start') {
      messageEl.querySelector('h3').textContent = "It's your turn";
      messageEl.querySelector('p').textContent = 'Your opponent did the following:';
    } else {
      messageEl.querySelector('h3').textContent = 'Your turn has been completed';
      messageEl.querySelector('p').textContent = 'Click below to switch players';
    }
  }
  
  if (buttonEl) {
    if (mode === 'online_end') {
      buttonEl.textContent = 'End Turn';
    } else if (mode === 'online_start') {
      buttonEl.textContent = 'Start Turn';
    } else {
      buttonEl.textContent = 'Switch Players';
    }
  }

  if (mode === 'online_start') {
    updateTurnSummarySection();
  } else {
    clearTurnSummarySection();
  }
  
  // Add class to game container to block interactions
  const gameContainer = document.querySelector('.game-container');
  if (gameContainer) {
    gameContainer.classList.add('dialog-blocking');
  }
  
  dialog.style.display = 'flex';
  dialog.classList.toggle(
    "checkpoint-pending",
    mode === "online_end" && !turnCheckpointCommitted
  );

  if (mode === "online_end" && !turnCheckpointCommitted) {
    persistCompletedTurnCheckpoint();
  }
};

const showWaitingForOpponent = () => {
  if (syncContext.enabled && syncContext.localPlayerId) {
    turnDisplayState.activePlayerId = syncContext.localPlayerId;
    turnDisplayState.opponentPlayerId = syncContext.localPlayerId === 'player1' ? 'player2' : 'player1';
    renderGame();
  }
  updateSyncUI();
  maybeAdjustPollingCadence();
};

const handleTurnCompletionAction = async () => {
  if (vsComputer.enabled && (vsComputer.busy || gameState.currentPlayer !== 1 || isGameOver())) return;
  const mode = turnDialogMode || (syncContext.enabled ? 'online_end' : 'local_end');
  if (mode === 'online_end') {
    if (turnHandoffInProgress) return;
    if (!(await persistCompletedTurnCheckpoint())) return;

    turnHandoffInProgress = true;
    const handoffButton = document.getElementById("switch-players-btn");
    if (handoffButton) {
      handoffButton.disabled = true;
      handoffButton.textContent = "Ending turn...";
    }

    const rollbackState = encodeSyncState();
    finalizePendingTurn();
    advanceToNextPlayerOnline();
    const committed = await commitOnlineCheckpoint("turn handoff", rollbackState);
    if (!committed) {
      turnHandoffInProgress = false;
      alert("The turn handoff could not be saved. Your completed turn is preserved; please retry End Turn.");
      if (isLocalPlayersTurn() && ensureCurrentTurnState().actionCompleted) {
        showTurnCompletionDialog("online_end");
      } else {
        closeTurnCompletionDialog();
        updateSyncUI();
      }
      return;
    }
    turnHandoffInProgress = false;
    closeTurnCompletionDialog();
    showWaitingForOpponent();
  } else if (mode === 'online_start') {
    markOpponentTurnsAsSeen();
    closeTurnCompletionDialog();
    clearTurnSummarySection();
    updateSyncUI();
  } else {
    finalizePendingTurn();
    syncAfterTurn();
    switchPlayers();
    closeTurnCompletionDialog();
  }
};

const closeTurnCompletionDialog = () => {
  const dialog = document.getElementById('turn-completion-dialog');
  if (dialog) {
    dialog.style.display = 'none';
  }
  turnDialogMode = null;
  
  // Remove blocking class from game container
  const gameContainer = document.querySelector('.game-container');
  if (gameContainer) {
    gameContainer.classList.remove('dialog-blocking');
  }
};

// Minimize the discard modal and show restore button
const minimizeDiscardModal = () => {
  discardModalMinimized = true;
  const modal = document.getElementById('token-discard-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  
  // Hide royal cards and show restore button with message
  const royalTrigger = document.getElementById('royal-cards-trigger');
  if (royalTrigger) {
    royalTrigger.style.display = 'none';
  }
  
  // Create message and restore button container in royal card position
  const pyramidRow = document.querySelector('.pyramid-row:first-child');
  if (pyramidRow && !document.getElementById('discard-pending-container')) {
    const container = document.createElement('div');
    container.id = 'discard-pending-container';
    container.className = 'discard-pending-container';
    container.innerHTML = `
      <div class="discard-pending-message">
        <span>Select tokens to discard</span>
      </div>
      <div id="restore-discard-btn" class="royal-cards-summary card-shaped restore-discard-button">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 4px; padding: 8px;">
          <div style="font-size: 1.8em;">📋</div>
          <div style="font-size: 0.65em; text-align: center; line-height: 1.2;">Discard ${requiredDiscardCount}</div>
        </div>
      </div>
    `;
    pyramidRow.appendChild(container);
    
    // Attach click handler
    const restoreBtn = document.getElementById('restore-discard-btn');
    if (restoreBtn) {
      restoreBtn.onclick = maximizeDiscardModal;
    }
  }
  
  // Switch from dialog-blocking to discard-pending (allows viewing, blocks actions)
  const gameContainer = document.querySelector('.game-container');
  if (gameContainer) {
    gameContainer.classList.remove('dialog-blocking');
    gameContainer.classList.add('discard-pending');
  }
};

// Maximize/restore the discard modal
const maximizeDiscardModal = () => {
  discardModalMinimized = false;
  
  // Remove the pending container (includes restore button and message)
  const container = document.getElementById('discard-pending-container');
  if (container) {
    container.remove();
  }
  
  // Show royal cards again
  const royalTrigger = document.getElementById('royal-cards-trigger');
  if (royalTrigger) {
    royalTrigger.style.display = '';
  }
  
  // Show modal
  const modal = document.getElementById('token-discard-modal');
  if (modal) {
    modal.style.display = 'flex';
  }
  
  // Switch from discard-pending back to dialog-blocking
  const gameContainer = document.querySelector('.game-container');
  if (gameContainer) {
    gameContainer.classList.remove('discard-pending');
    gameContainer.classList.add('dialog-blocking');
  }
};

// Generic confirmation modal system
let confirmationCallback = null;

const showConfirmationModal = (message, onConfirm, onCancel = null) => {
  const modal = document.getElementById('confirmation-modal');
  const messageEl = document.getElementById('confirmation-message');
  const confirmBtn = document.getElementById('confirmation-confirm-btn');
  const cancelBtn = document.getElementById('confirmation-cancel-btn');
  
  if (!modal || !messageEl || !confirmBtn || !cancelBtn) return;
  
  // Set message
  messageEl.innerHTML = `<p>${message}</p>`;
  
  // Store callback
  confirmationCallback = onConfirm;
  
  // Setup button handlers
  confirmBtn.onclick = () => {
    const callback = confirmationCallback; // Save before closing clears it
    closeConfirmationModal();
    if (callback) {
      callback();
    }
  };
  
  cancelBtn.onclick = () => {
    const cancelCallback = onCancel; // Save reference
    closeConfirmationModal();
    if (cancelCallback) {
      cancelCallback();
    }
  };
  
  // Add blocking class
  const gameContainer = document.querySelector('.game-container');
  if (gameContainer) {
    gameContainer.classList.add('dialog-blocking');
  }
  
  modal.style.display = 'flex';
};

const closeConfirmationModal = () => {
  const modal = document.getElementById('confirmation-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  
  const gameContainer = document.querySelector('.game-container');
  if (gameContainer) {
    gameContainer.classList.remove('dialog-blocking');
  }
  
  confirmationCallback = null;
};

// Show token discard modal when player has more than 10 tokens
const showTokenDiscardModal = () => {
  const currentPlayerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const player = gameState.players[currentPlayerId];
  const totalTokens = getTotalTokenCount(currentPlayerId);
  const tokensToDiscardCount = totalTokens - 10;
  
  // Reset discard state
  tokensToDiscard = [];
  tokenDiscardMode = true;
  requiredDiscardCount = tokensToDiscardCount;
  discardModalMinimized = false;
  
  // Add blocking class to game container
  const gameContainer = document.querySelector('.game-container');
  if (gameContainer) {
    gameContainer.classList.add('dialog-blocking');
  }
  
  const modal = document.getElementById('token-discard-modal');
  const messageEl = document.getElementById('token-discard-message');
  const gridEl = document.getElementById('token-discard-grid');
  const confirmBtn = document.getElementById('confirm-discard-btn');
  
  if (!modal || !messageEl || !gridEl) return;
  
  // Set message
  messageEl.innerHTML = `
    <p>You may not keep more than 10 tokens. Select ${tokensToDiscardCount} token${tokensToDiscardCount > 1 ? 's' : ''} to discard.</p>
  `;
  
  // Build token grid with dynamic sizing/columns
  const tokenColors = ['blue', 'white', 'green', 'red', 'black', 'pearl', 'gold'];
  const totalTokenItems = tokenColors.reduce((sum, color) => sum + (player.tokens[color] || 0), 0);
  let columns = 4;
  if (totalTokenItems > 15) {
    columns = 6;
  } else if (totalTokenItems > 12) {
    columns = 5;
  }
  const iconSize = columns >= 6 ? 26 : columns === 5 ? 30 : 34;
  gridEl.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  
  let gridHTML = '';
  
  tokenColors.forEach(color => {
    const count = player.tokens[color] || 0;
    for (let i = 0; i < count; i++) {
      const tokenId = `${color}-${i}`;
      let iconSvg;
      if (color === 'pearl') {
        iconSvg = generatePearlIcon(iconSize);
      } else if (color === 'gold') {
        iconSvg = generateGoldIcon(iconSize);
      } else {
        iconSvg = generateGemTokenIcon(color, iconSize);
      }
      
      gridHTML += `
        <div class="token-discard-item" data-token-id="${tokenId}" data-token-color="${color}" onclick="toggleTokenDiscard('${tokenId}', '${color}')">
          ${iconSvg}
        </div>
      `;
    }
  });
  
  gridEl.innerHTML = gridHTML;
  
  // Update confirm button state
  updateDiscardConfirmButton();
  
  // Show modal
  modal.style.display = 'flex';
};

// Toggle token selection for discarding
const toggleTokenDiscard = (tokenId, color) => {
  if (!ensureLocalTurn("Only the active player can discard tokens.")) return;
  if (!tokenDiscardMode) return;
  
  const index = tokensToDiscard.findIndex(t => t.id === tokenId);
  const tokenEl = document.querySelector(`[data-token-id="${tokenId}"]`);
  
  if (index >= 0) {
    // Deselect
    tokensToDiscard.splice(index, 1);
    if (tokenEl) tokenEl.classList.remove('selected');
  } else {
    // Only allow selection if we haven't reached the required count
    if (tokensToDiscard.length < requiredDiscardCount) {
      tokensToDiscard.push({ id: tokenId, color });
      if (tokenEl) tokenEl.classList.add('selected');
    }
  }
  
  updateDiscardConfirmButton();
};

// Update confirm button enabled state
const updateDiscardConfirmButton = () => {
  const confirmBtn = document.getElementById('confirm-discard-btn');
  
  if (confirmBtn) {
    const canConfirm = tokensToDiscard.length === requiredDiscardCount;
    confirmBtn.disabled = !canConfirm;
    confirmBtn.style.opacity = canConfirm ? '1' : '0.5';
    confirmBtn.style.cursor = canConfirm ? 'pointer' : 'not-allowed';
  }
};

// Confirm token discard and return tokens to bag
const confirmTokenDiscard = () => {
  if (!ensureLocalTurn("Only the active player can discard tokens.")) return;
  // Validate selection
  if (tokensToDiscard.length !== requiredDiscardCount) {
    return;
  }
  
  const currentPlayerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  
  const player = gameState.players[currentPlayerId];
  
  // Remove tokens from player and return to bag
  tokensToDiscard.forEach(({ color }) => {
    if (player.tokens[color] > 0) {
      player.tokens[color]--;
      gameState.bag[color] = (gameState.bag[color] || 0) + 1;
    }
  });
  logTurnEvent('tokens_discarded', {
    tokens: aggregateTokens(tokensToDiscard.map(t => t.color))
  });
  
  // Clear discard state
  tokensToDiscard = [];
  tokenDiscardMode = false;
  requiredDiscardCount = 0;
  discardModalMinimized = false;
  
  // Remove pending container if it exists
  const container = document.getElementById('discard-pending-container');
  if (container) {
    container.remove();
  }
  
  // Show royal cards again if they were hidden
  const royalTrigger = document.getElementById('royal-cards-trigger');
  if (royalTrigger) {
    royalTrigger.style.display = '';
  }
  
  // Close modal
  const modal = document.getElementById('token-discard-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  
  // Remove blocking classes
  const gameContainer = document.querySelector('.game-container');
  if (gameContainer) {
    gameContainer.classList.remove('dialog-blocking');
    gameContainer.classList.remove('discard-pending');
  }
  
  // Re-render game
  renderGame();
  
  checkAndShowRoyalCardSelection();
};

// Expose token discard functions to global scope (after they're defined)
window.confirmTokenDiscard = confirmTokenDiscard;
window.toggleTokenDiscard = toggleTokenDiscard;
window.minimizeDiscardModal = minimizeDiscardModal;
window.maximizeDiscardModal = maximizeDiscardModal;

const switchPlayers = () => {
  if (vsComputer.enabled && !syncContext.enabled) {
    if (isGameOver() || vsComputer.busy || gameState.currentPlayer !== 1) return;
    gameState.currentPlayer = 2;
    resetCurrentTurnState();
    runComputerTurn();
    return;
  }
  // Swap the display state
  const temp = turnDisplayState.activePlayerId;
  turnDisplayState.activePlayerId = turnDisplayState.opponentPlayerId;
  turnDisplayState.opponentPlayerId = temp;
  
  // Update gameState.currentPlayer to match (for action consistency)
  // This keeps actions in sync, but display state is separate for future changes
  gameState.currentPlayer = turnDisplayState.activePlayerId === 'player1' ? 1 : 2;
  resetCurrentTurnState();
  
  // Add transition class to elements
  const handDisplay = document.getElementById('player-hand');
  const opponentStats = document.getElementById('opponent-stats');
  
  if (handDisplay) handDisplay.classList.add('switching');
  if (opponentStats) opponentStats.classList.add('switching');
  
  // Wait for transition, then update content
  setTimeout(() => {
    // Update opponent stats
    if (opponentStats) {
      opponentStats.innerHTML = renderOpponentStats();
    }
    
    // Update hand display
    if (handDisplay) {
      handDisplay.innerHTML = renderPlayerHand(turnDisplayState.activePlayerId);
    }
    
    // Update pyramid card highlighting for the new current player
    const viewedPlayerId = getViewedPlayerId();
    const pyramidContainer = document.querySelector('.card-pyramid');
    if (pyramidContainer) {
      // Update all pyramid cards by level
      const allLevels = [
        { key: 'level1', level: 1 },
        { key: 'level2', level: 2 },
        { key: 'level3', level: 3 }
      ];
      
      allLevels.forEach(({ key, level }) => {
        const cards = gameState.pyramid[key];
        // Find all card elements for this level
        const cardElements = Array.from(
          pyramidContainer.querySelectorAll(`.card-v2[data-card-level="${level}"]`)
        );
        
        // Match cards by their index attribute (set during rendering)
        cardElements.forEach(cardElement => {
          const cardIndex = parseInt(cardElement.getAttribute('data-card-index'), 10);
          if (!isNaN(cardIndex) && cardIndex < cards.length) {
            const card = cards[cardIndex];
            const afford = getAffordability(card, viewedPlayerId);
            if (afford.affordable) {
              cardElement.classList.add('affordable');
            } else {
              cardElement.classList.remove('affordable');
            }
          }
        });
      });
    }
    
    // Remove transition class after a brief delay
    setTimeout(() => {
      if (handDisplay) handDisplay.classList.remove('switching');
      if (opponentStats) opponentStats.classList.remove('switching');
    }, 50);
  }, 300); // Match CSS transition duration
};

// Function to attach popover listeners
const attachPopoverListeners = () => {
  // Remove existing listener if any
  const handlers = document.querySelectorAll('[data-popover-handler]');
  handlers.forEach(el => el.removeEventListener('click', el._popoverHandler));
  
  // Find all card elements
  document.querySelectorAll('.card[data-clickable="card"]').forEach(cardEl => {
    cardEl._popoverHandler = (e) => {
      const level = cardEl.dataset.cardLevel;
      const index = parseInt(cardEl.dataset.cardIndex, 10);
      
      // Find the card in game state
      const levelKey = `level${level}`;
      const card = gameState.pyramid[levelKey][index];
      
      openPopover('card-detail-popover', card, cardEl);
    };
    cardEl.addEventListener('click', cardEl._popoverHandler);
  });

  // Find all general popover triggers
  document.querySelectorAll('[data-clickable="popover"]').forEach(triggerEl => {
    triggerEl._popoverHandler = (e) => {
      const modalId = triggerEl.dataset.popover;
      
      // Initialize token selection state when opening token modal
      if (modalId === 'token-selection-modal') {
        selectedTokens = [];
        selectionError = null;
        scrollSelectionMode = false;
        scrollSelectedToken = null;
        openPopover(modalId);
        // Attach token board listeners after modal is shown
        setTimeout(() => {
          attachTokenBoardListeners();
          updateRefillButtonState();
          renderScrollUsageSection();
        }, 100);
      } else {
        openPopover(modalId);
      }
    };
    triggerEl.addEventListener('click', triggerEl._popoverHandler);
  });
  
  // Find all deck reserve triggers
  document.querySelectorAll('[data-clickable="reserve-deck"]').forEach(deckEl => {
    deckEl._deckReserveHandler = (e) => {
      const level = parseInt(deckEl.dataset.deckLevel, 10);
      if (level >= 1 && level <= 3) {
        confirmReserveFromDeck(level);
      }
    };
    deckEl.addEventListener('click', deckEl._deckReserveHandler);
  });

  // Find all reserve target cards
  document.querySelectorAll('[data-clickable="reserve-target"]').forEach(cardEl => {
    cardEl._reserveTargetHandler = (e) => {
      const level = cardEl.dataset.cardLevel;
      const index = parseInt(cardEl.dataset.cardIndex, 10);
      const levelKey = `level${level}`;
      const card = gameState.pyramid[levelKey][index];
      confirmReserveFromPyramid(card);
    };
    cardEl.addEventListener('click', cardEl._reserveTargetHandler);
  });
};

const renderGame = () => {
  document.querySelector("#app").innerHTML = generateGameLayout();
  
  // Re-attach event listeners
  setTimeout(() => {
    attachPopoverListeners();
    attachReservedSectionDelegation();
    attachHandDetailsDelegation();
    // Attach turn completion dialog handler
    const switchBtn = document.getElementById('switch-players-btn');
    if (switchBtn) {
      // Remove old handler if exists
      if (switchBtn._handlerAttached) {
        switchBtn.removeEventListener('click', switchBtn._clickHandler);
      }
      switchBtn._clickHandler = handleTurnCompletionAction;
      switchBtn.addEventListener('click', switchBtn._clickHandler);
      switchBtn._handlerAttached = true;
    }
    const closeVictoryBtn = document.getElementById("close-victory-btn");
    if (closeVictoryBtn) {
      if (closeVictoryBtn._handlerAttached) {
        closeVictoryBtn.removeEventListener("click", closeVictoryBtn._clickHandler);
      }
      closeVictoryBtn._clickHandler = closeVictoryModal;
      closeVictoryBtn.addEventListener("click", closeVictoryBtn._clickHandler);
      closeVictoryBtn._handlerAttached = true;
    }
    if (isGameOver()) {
      openVictoryModal();
    }
    // Update sync UI after render
    updateSyncUI();
  }, 10);
};

// Helper function to start polling
let consecutivePollFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

const startPolling = (forcedIntervalMs = null) => {
  if (!syncContext.enabled || !syncContext.sessionId) {
    return;
  }
  const pollIntervalMs = forcedIntervalMs || getDesiredPollIntervalMs() || POLL_INTERVAL_VISIBLE_WAITING_MS;
  
  consecutivePollFailures = 0;
  
  gameSyncClient.startPolling(pollIntervalMs, (session, error) => {
    if (error) {
      console.error('Poll error:', error);
      
      // If session not found, stop polling
      if (error.type === 'not_found' || error.status === 404) {
        console.warn('Session not found, stopping polling');
        stopPolling();
        syncContext.enabled = false;
        syncContext.syncStatus = 'offline';
        syncContext.pollIntervalMs = null;
        updateSyncUI();
        return;
      }
      
      consecutivePollFailures++;
      
      // After too many failures, mark as degraded but keep trying
      if (consecutivePollFailures >= MAX_CONSECUTIVE_FAILURES) {
        syncContext.syncStatus = 'degraded';
        updateSyncUI();
      }
      return;
    }
    
    // Reset failure count on success
    consecutivePollFailures = 0;
    
    if (session && session.version > syncContext.version) {
      // Apply the update - opponent has made a move
      // IMPORTANT: applySyncedState will call renderGame(), which might reset turnDisplayState
      // So we need to preserve our view settings AFTER applying state
      const preservedLocalPlayerId = syncContext.localPlayerId;
      const wasLocalTurn = isLocalPlayersTurn();
      
      applySyncedState(session.state_blob);
      
      // CRITICAL: Restore our view after state is applied
      // We always want to see our own hand at the bottom
      turnDisplayState.activePlayerId = preservedLocalPlayerId;
      turnDisplayState.opponentPlayerId = preservedLocalPlayerId === 'player1' ? 'player2' : 'player1';
      const nowLocalTurn = isLocalPlayersTurn();
      
      syncContext.version = session.version;
      syncContext.syncStatus = 'online';
      
      // Close turn completion dialog if it's open (opponent's turn is now active)
      closeTurnCompletionDialog();
      
      // Re-render to ensure view is correct
      renderGame();
      updateSyncUI();
      
      if (!wasLocalTurn && nowLocalTurn) {
        notifyTurnReady();
        showTurnCompletionDialog('online_start');
      }
      maybeAdjustPollingCadence();
    } else if (session) {
      // Session loaded but version hasn't changed - still mark as online
      syncContext.syncStatus = 'online';
      updateSyncUI();
      maybeAdjustPollingCadence();
    }
  });
  
  syncContext.pollTimerId = gameSyncClient.pollTimerId;
  syncContext.pollIntervalMs = pollIntervalMs;
};

// Helper function to stop polling
const stopPolling = () => {
  gameSyncClient.stopPolling();
  syncContext.pollTimerId = null;
  syncContext.pollIntervalMs = null;
};

// Sync after turn completion
const syncAfterTurn = async () => {
  if (!syncContext.enabled) {
    // Local mode guard: only allow the active player to end their turn
    const currentPlayerId = gameState.currentPlayer === 1 ? "player1" : "player2";
    if (currentPlayerId !== turnDisplayState.activePlayerId) {
      return;
    }
  }
  
  try {
    console.log('Syncing turn - current player:', gameState.currentPlayer, 'local player:', syncContext.localPlayerId, 'version:', syncContext.version);
    const session = await pushStateUpdate('turn complete');
    if (session) {
      updateSyncUI();
      console.log('Turn synced successfully, new version:', syncContext.version);
    }
  } catch (error) {
    console.error('Failed to sync after turn:', error);
    
    if (error.type === 'version_conflict') {
      // Handle version conflict by applying the current state
      if (error.current) {
        applySyncedState(error.current.state_blob);
        syncContext.version = error.current.version;
        syncContext.syncStatus = 'online';
        updateSyncUI();
        // Show a brief message
        console.warn('Version conflict resolved - remote state applied');
      }
    } else {
      // Network error or other issue - mark as degraded but don't block gameplay
      syncContext.syncStatus = 'degraded';
      updateSyncUI();
      // Don't throw - allow game to continue
    }
  }
};

// Helper function to update sync UI
const updateSyncUI = () => {
  const indicator = document.getElementById("sync-indicator");
  const mode = document.getElementById("sync-mode");
  const sessionIdEl = document.getElementById("sync-session-id");
  const turnIndicator = document.getElementById("sync-turn-indicator");
  
  if (!indicator || !mode) return;
  
  // Update indicator color
  if (syncContext.syncStatus === "online") {
    indicator.style.backgroundColor = "#4caf50";
    indicator.title = "Online - Synced";
  } else if (syncContext.syncStatus === "degraded") {
    indicator.style.backgroundColor = "#ff9800";
    indicator.title = "Degraded - Connection issues";
  } else {
    indicator.style.backgroundColor = "#9e9e9e";
    indicator.title = "Offline - Local mode";
  }
  
  // Update mode text & session ID
  if (syncContext.enabled) {
    const playerLabel = syncContext.localPlayerId
      ? ` (${syncContext.localPlayerId === "player1" ? "P1" : "P2"})`
      : "";
    mode.textContent = `Online${playerLabel}`;
    if (sessionIdEl && syncContext.sessionId) {
      sessionIdEl.textContent = `Session: ${trimSessionId(syncContext.sessionId)}`;
      sessionIdEl.style.display = "inline";
    }
  } else {
    mode.textContent = "Local";
    if (sessionIdEl) {
      sessionIdEl.style.display = "none";
    }
  }
  
  // Turn indicator
  if (turnIndicator) {
    turnIndicator.classList.remove("active", "waiting", "game-over");
    turnIndicator.onclick = null;
    turnIndicator.style.cursor = "default";
    turnIndicator.title = "";
    if (!syncContext.enabled || !syncContext.localPlayerId) {
      turnIndicator.textContent = isGameOver() ? "GAME OVER" : "";
      if (isGameOver()) {
        turnIndicator.classList.add("game-over");
        turnIndicator.onclick = reopenVictoryModal;
        turnIndicator.style.cursor = "pointer";
        turnIndicator.title = "Open game over options";
      }
    } else if (isGameOver()) {
      turnIndicator.textContent = "GAME OVER";
      turnIndicator.classList.add("game-over");
      turnIndicator.onclick = reopenVictoryModal;
      turnIndicator.style.cursor = "pointer";
      turnIndicator.title = "Open game over options";
    } else if (isLocalPlayersTurn()) {
      turnIndicator.textContent = "Your turn";
      turnIndicator.classList.add("active");
    } else {
      turnIndicator.textContent = "Waiting on opponent";
      turnIndicator.classList.add("waiting");
    }
  }
  
  updateTurnGuardMessage();
};

const getRecentOpponentTurns = () => {
  return getOpponentTurnsSinceLastLocalTurn(turnHistoryState, syncContext.localPlayerId);
};

const getLatestOpponentTurnId = () => {
  const turns = getRecentOpponentTurns();
  if (!turns.length) return null;
  return turns[turns.length - 1].id;
};

const hasUnseenOpponentTurn = () => {
  loadTurnSeenAcknowledgement();
  const latestId = getLatestOpponentTurnId();
  return Boolean(latestId && latestId !== syncContext.lastSeenTurnId);
};

const markOpponentTurnsAsSeen = () => {
  loadTurnSeenAcknowledgement();
  const latestId = getLatestOpponentTurnId();
  if (latestId) {
    syncContext.lastSeenTurnId = latestId;
    saveTurnSeenAcknowledgement();
  }
};

const formatColorLabel = (color) => {
  if (!color || color === 'none') return 'Neutral';
  return color.charAt(0).toUpperCase() + color.slice(1);
};

const formatCardLabel = (card) => {
  if (!card) return 'card';
  const colorLabel = formatColorLabel(card.color);
  const crowns = card.crowns ? `, ${card.crowns} crowns` : '';
  const ability = card.ability ? `, ability: ${card.ability}` : '';
  return `Lvl ${card.level} ${colorLabel} (${card.points || 0} pts${crowns}${ability})`;
};

const renderTokenIcon = (color, size = 18) => {
  if (!color) return '';
  if (color === 'gold') return generateGoldIcon(size);
  if (color === 'pearl') return generatePearlIcon(size);
  if (color === 'wild') return generateWildIconSvg(size);
  return generateGemTokenIcon(color, size);
};

const renderTokenIcons = (tokens = []) => {
  if (!tokens || !tokens.length) return '';
  return `<span class="token-icon-row">${
    tokens.map(token => `
      <span class="token-icon-wrapper">
        ${renderTokenIcon(token.color, 20)}
        ${token.count > 1 ? `<span class="token-count">×${token.count}</span>` : ''}
      </span>
    `).join('')
  }</span>`;
};

const renderTurnCardPreview = (card) => {
  if (!card) return '';
  return `
    <div class="turn-event-card-preview" aria-hidden="true">
      ${renderCardV2(card, `level-${card.level || 1}-card`)}
    </div>
  `;
};

const renderTurnCardBack = (level) => `
  <div class="turn-event-card-back" aria-label="Hidden level ${level || '?'} reserved card">
    <span>?</span>
  </div>
`;

const renderTurnEventRow = (event) => {
  const row = (label, content) => `
    <div class="turn-event-row">
      <span class="turn-event-label">${label}</span>
      <span class="turn-event-content">${content}</span>
    </div>
  `;
  switch (event.type) {
    case 'tokens_taken':
      return row('Tokens', `${renderTokenIcons(event.tokens) || 'Collected tokens'}${event.scrollReasons?.length ? `<span class="turn-event-note">Scroll awarded</span>` : ''}`);
    case 'bonus_token_collected':
      return row('Bonus', `${event.bonusColor ? `${formatColorLabel(event.bonusColor)} ` : ''}${renderTokenIcons(event.tokens)}`);
    case 'board_refilled':
      return row(
        'Refill',
        `<div class="turn-event-visual-detail">
          ${renderTokenIcons(event.tokens)}
          <span>
            Filled ${event.tokensPlaced || 0} spaces${event.scrollAwardedTo ? ' and granted a Privilege' : ''}.
          </span>
        </div>`
      );
    case 'card_reserved': {
      const hiddenReservation = event.source === 'deck';
      return row(
        'Reserved',
        `<div class="turn-event-card-action">
          ${hiddenReservation
            ? renderTurnCardBack(event.level || event.card?.level)
            : renderTurnCardPreview(event.card)}
          <div class="turn-event-card-copy">
            <span>
              ${hiddenReservation
                ? `Hidden card from level ${event.level || event.card?.level || '?'} deck`
                : `Level ${event.card?.level || '?'} ${formatColorLabel(event.card?.color)}`}
            </span>
            ${event.goldAwarded ? '<span class="turn-event-note">+ gold</span>' : ''}
          </div>
        </div>`
      );
    }
    case 'card_purchased': {
      const spentIcons = event.tokensSpent && event.tokensSpent.length ? `<div>${renderTokenIcons(event.tokensSpent)}</div>` : '';
      return row(
        'Purchased',
        `<div class="turn-event-card-action">
          ${renderTurnCardPreview(event.card)}
          <div class="turn-event-card-copy">
            ${event.fromReserve ? '<span>From reserve</span>' : '<span>From pyramid</span>'}
            ${spentIcons}
          </div>
        </div>`
      );
    }
    case 'scroll_token':
      return row('Scroll', `Took a ${formatColorLabel(event.token)} token`);
    case 'token_stolen':
      return row('Steal', `Took a ${formatColorLabel(event.color)} token`);
    case 'tokens_discarded':
      return row('Discarded', renderTokenIcons(event.tokens) || 'Returned tokens to the bag');
    case 'royal_acquired':
      return row(
        'Royal',
        `<div class="turn-event-card-action">${renderTurnCardPreview(event.card)}<span>Claimed</span></div>`
      );
    case 'repeat_turn_awarded':
      return row('Repeat', `Extra turn granted by ${formatCardLabel(event.card)}`);
    case 'scroll_gained':
      return row('Privilege', `Gained a Privilege from ${formatCardLabel(event.card)}`);
    case 'scroll_unavailable':
      return row('Privilege', 'Already held all 3 Privileges; no additional Privilege was gained.');
    default:
      return row('Event', event.type.replace(/_/g, ' '));
  }
};

const renderTurnSummaryEntries = (turns) => {
  if (!turns.length) {
    return '<div class="turn-summary-entry"><div class="turn-event-row"><span class="turn-event-content">No recorded actions.</span></div></div>';
  }
  return turns.map(turn => {
    const eventsHtml = (turn.events || []).map(renderTurnEventRow).join('') || '<div class="turn-event-row"><span class="turn-event-content">No logged actions.</span></div>';
    const hasRepeat = (turn.events || []).some(evt => evt.type === 'repeat_turn_awarded');
    return `
      <div class="turn-summary-entry">
        <div class="turn-summary-entry-header">
          <span>Opponent Turn ${turn.turnNumber || ''}</span>
          ${hasRepeat ? '<span class="turn-summary-badge">Repeat chain</span>' : ''}
        </div>
        <div class="turn-summary-events">
          ${eventsHtml}
        </div>
      </div>
    `;
  }).join('');
};

const updateTurnSummarySection = () => {
  loadTurnSeenAcknowledgement();
  const container = document.getElementById('turn-summary-container');
  const listContainer = document.getElementById('turn-summary-list');
  if (!container || !listContainer) return;
  const turns = getRecentOpponentTurns();
  const latestId = getLatestOpponentTurnId();
  if (!turns.length || (latestId && latestId === syncContext.lastSeenTurnId)) {
    container.style.display = 'none';
    return;
  }
  listContainer.innerHTML = renderTurnSummaryEntries(turns);
  container.style.display = 'flex';
};

const clearTurnSummarySection = () => {
  const container = document.getElementById('turn-summary-container');
  const listContainer = document.getElementById('turn-summary-list');
  if (container) container.style.display = 'none';
  if (listContainer) listContainer.innerHTML = '';
};

const maybeShowPendingTurnDialog = () => {
  if (!syncContext.enabled || !syncContext.localPlayerId) return;
  if (!isLocalPlayersTurn()) return;
  if (ensureCurrentTurnState().actionCompleted) {
    turnCheckpointCommitted = true;
    if (ensureCurrentTurnState().extraTurnsPending > 0) {
      setTimeout(() => showRepeatTurnModal(), 50);
    } else {
      setTimeout(() => showTurnCompletionDialog("online_end"), 50);
    }
    return;
  }
  if (!hasUnseenOpponentTurn()) return;
  notifyTurnReady();
  setTimeout(() => showTurnCompletionDialog('online_start'), 50);
};

const POLL_INTERVAL_VISIBLE_WAITING_MS = 1500;
const POLL_INTERVAL_VISIBLE_MY_TURN_MS = 6000;
const POLL_INTERVAL_HIDDEN_MS = 15000;

const getDesiredPollIntervalMs = () => {
  if (!syncContext.enabled || !syncContext.sessionId) {
    return null;
  }
  if (document.hidden) {
    return POLL_INTERVAL_HIDDEN_MS;
  }
  return isLocalPlayersTurn() ? POLL_INTERVAL_VISIBLE_MY_TURN_MS : POLL_INTERVAL_VISIBLE_WAITING_MS;
};

const refreshPowerModeClass = () => {
  const root = document.documentElement;
  if (!root) return;
  root.classList.toggle("tab-inactive", document.hidden);
};

const maybeAdjustPollingCadence = () => {
  const desiredMs = getDesiredPollIntervalMs();
  if (!desiredMs) return;
  if (syncContext.pollIntervalMs === desiredMs) return;
  startPolling(desiredMs);
};

// UI handler functions (exposed to window for onclick handlers)
// Local Computer mode: all UI glue stays separate from online handoff/sync.
const runComputerTurn = () => scheduleComputerTurn({
  getGame: () => ({ gameState, previousCrownCounts }),
  rng: Math.random,
  applyGame: game => {
    applyGameInto(gameState, game.gameState);
    applyGameInto(previousCrownCounts, game.previousCrownCounts);
    resetTransientActionState();
    if (!isGameOver()) resetCurrentTurnState();
  },
  refresh: () => {
    renderGame();
    if (isGameOver()) openVictoryModal();
    if (vsComputer.error) document.querySelector('[data-ai-retry]')?.focus();
  }
});

window.showComputerLevelPicker = () => {
  if (!aiModeAvailable()) return;
  const picker = document.getElementById('ai-level-picker');
  if (picker) {
    picker.innerHTML = levelPickerHtml(rememberedLevel());
    picker.hidden = false;
  }
};
window.startVsComputer = level => {
  if (!aiModeAvailable() || vsComputer.busy) return;
  enableComputer(level);
  rememberLevel(level);
  stopPolling();
  syncContext.enabled = false;
  syncContext.localPlayerId = null;
  syncContext.sessionId = null;
  const url = new URL(window.location);
  url.searchParams.delete('session');
  url.searchParams.delete('role');
  window.history.replaceState({}, '', url);
  initializeGame();
  renderGame();
  if (gameState.currentPlayer === 2) runComputerTurn();
};
window.retryComputerTurn = runComputerTurn;
window.dismissComputerSummary = () => {
  vsComputer.summary = [];
  document.querySelector('.ai-summary')?.remove();
};

// Capture input, including keyboard activation, before the page's action handlers.
// Retry is the sole control available on a failed AI boundary.
if (aiModeAvailable()) {
  // Observation only (needs ?debug): the DOM smoke harness reads state without changing it.
  if (new URLSearchParams(window.location.search).has('debug')) {
    window.__splendorDebugState = () => ({ gameState, previousCrownCounts });
  }
  for (const type of ['click', 'pointerdown', 'touchstart', 'keydown']) {
    document.addEventListener(type, event => {
      if (!vsComputer.enabled) return;
      if ((vsComputer.busy || gameState.currentPlayer === 2) && !isGameOver()) {
        if (!vsComputer.busy && event.target.closest?.('[data-ai-retry]')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      // Existing online handlers remain unchanged; relinquish local AI mode before entering them.
      if (type === 'click' && event.target.closest?.('#mode-selection-modal button')?.getAttribute('onclick')?.match(/hostOnlineGame|showJoinDialog/)) {
        disableComputer();
      }
    }, { capture: true, passive: false });
  }
}

window.showModeSelection = () => {
  if (!syncContext.serviceAvailable && !aiModeAvailable()) return;
  const modal = document.getElementById('mode-selection-modal');
  if (modal) {
    modal.style.display = 'flex';
    modal.style.pointerEvents = 'auto';
    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
      gameContainer.classList.add('dialog-blocking');
    }
  }
};

window.closeModeSelection = () => {
  const modal = document.getElementById('mode-selection-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.style.pointerEvents = 'none';
    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
      gameContainer.classList.remove('dialog-blocking');
    }
  }
};

window.selectLocalMode = () => {
  if (vsComputer.enabled) {
    disableComputer();
    initializeGame();
    renderGame();
  }
  syncContext.enabled = false;
  syncContext.localPlayerId = null;
  updateSyncUI();
  window.closeModeSelection();
};

window.hostOnlineGame = async () => {
  try {
    requestTurnNotificationPermission();

    // Use the current game state (don't re-initialize - user may have already started playing)
    // If game hasn't been initialized yet, initialize it now
    if (allCards.length === 0) {
      initializeGame();
      renderGame();
    }
    
    ensureSyncAssignmentsStructure();
    gameState.syncAssignments.player1Id = clientId;
    gameState.syncAssignments.player2Id = null;
    
    const stateBlob = encodeSyncState();
    // Track player assignments in meta
    const meta = buildLobbyMeta();
    const session = await gameSyncClient.createSession(stateBlob, meta);
    
    syncContext.enabled = true;
    syncContext.sessionId = session.session_id;
    syncContext.version = session.version;
    syncContext.localPlayerId = 'player1';
    syncContext.isHost = true;
    syncContext.syncStatus = 'online';
    
    // Set turn display to always show player1 as active
    turnDisplayState.activePlayerId = 'player1';
    turnDisplayState.opponentPlayerId = 'player2';
    
    // Update URL to include session ID so refresh will reconnect
    const url = new URL(window.location);
    url.searchParams.set('session', trimSessionId(session.session_id));
    url.searchParams.set('role', 'p1'); // Host is always p1
    window.history.replaceState({}, '', url);
    
    startPolling();
    updateSyncUI();
    
    // Show session info modal
    const modal = document.getElementById('session-info-modal');
    const sessionIdDisplay = document.getElementById('session-id-display');
    const sessionLinkDisplay = document.getElementById('session-link-display');
    
    if (modal && sessionIdDisplay && sessionLinkDisplay) {
      const trimmed = trimSessionId(session.session_id);
      const joinUrl = buildShareUrl(session.session_id);
      sessionIdDisplay.textContent = trimmed;
      sessionLinkDisplay.textContent = joinUrl;
      const qrImg = document.getElementById('session-qr-image');
      if (qrImg && joinUrl) {
        qrImg.src = buildShareQrUrl(joinUrl);
        qrImg.style.display = '';
      }
      modal.style.display = 'flex';
      modal.style.pointerEvents = 'auto';
      const gameContainer = document.querySelector('.game-container');
      if (gameContainer) {
        gameContainer.classList.add('dialog-blocking');
      }
    }
    
    window.closeModeSelection();
  } catch (error) {
    console.error('Failed to host game:', error);
    alert('Failed to create online session. Please try again.');
  }
};

window.showJoinDialog = () => {
  window.closeModeSelection();
  const modal = document.getElementById('join-game-modal');
  if (modal) {
    modal.style.display = 'flex';
    modal.style.pointerEvents = 'auto';
    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
      gameContainer.classList.add('dialog-blocking');
    }
    const input = document.getElementById('join-session-input');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 100);
    }
  }
};

window.closeJoinDialog = () => {
  const modal = document.getElementById('join-game-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.style.pointerEvents = 'none';
    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
      gameContainer.classList.remove('dialog-blocking');
    }
  }
};

window.confirmJoinGame = async () => {
  const input = document.getElementById('join-session-input');
  if (!input || !input.value.trim()) {
    alert('Please enter a session ID');
    return;
  }
  
  const rawId = input.value.trim();
  const normalizedId = normalizeSessionId(rawId);
  if (!normalizedId) {
    alert('Please enter a valid session ID');
    return;
  }

  requestTurnNotificationPermission();
  
  const joined = await joinSession(normalizedId, 'p2');
  
  if (joined) {
    window.closeJoinDialog();
    // Update URL to include session param (no role - we auto-assign)
    const url = new URL(window.location);
    url.searchParams.set('session', normalizedId);
    url.searchParams.delete('role'); // Remove role param if present
    window.history.replaceState({}, '', url);
  } else {
    alert('Failed to join session. Please check the session ID and try again.');
  }
};

const nativePushErrorLabel = (error) => {
  if (error === 'denied') return 'iOS notifications are blocked for this app';
  if (error === 'timeout' || error === 'server') return 'Could not reach the server, try again';
  if (error === 'disabled') return 'Push is not available yet';
  return 'Push is unavailable';
};

const setupNativePushSettings = () => {
  const modal = document.getElementById('settings-modal');
  const statusLine = document.getElementById('native-push-status');
  const button = document.getElementById('native-push-button');
  const errorLine = document.getElementById('native-push-error');
  const mute = document.getElementById('native-push-mute');
  const sessionId = syncContext.sessionId;
  let action = 'enable';
  let muted = false;
  const isOpen = () => modal?.isConnected && modal.style.display !== 'none'
    && document.getElementById('native-push-status') === statusLine;

  const refreshStatus = async () => {
    const status = await nativePush('status', { actor_id: clientId });
    if (!isOpen()) return;
    if (status.ok === false) {
      statusLine.textContent = nativePushErrorLabel(status.error);
      button.hidden = true;
      return;
    }
    const on = status.registered && ['authorized', 'provisional', 'ephemeral'].includes(status.permission);
    const denied = status.permission === 'denied';
    statusLine.textContent = on ? 'Push is on'
      : denied ? 'Blocked in iOS Settings > Notifications' : 'Push is off';
    action = on ? 'disable' : 'enable';
    button.textContent = on ? 'Turn off' : 'Turn on push';
    button.hidden = denied;
  };

  const runAction = async (type, fields) => {
    button.disabled = true;
    if (mute) mute.disabled = true;
    errorLine.textContent = '';
    const result = await nativePush(type, { actor_id: clientId, ...fields });
    if (!isOpen()) return;
    if (result.ok !== true) errorLine.textContent = nativePushErrorLabel(result.error);
    if (type === 'mute') {
      if (result.ok === true) muted = fields.muted;
      mute.checked = muted;
    }
    await refreshStatus();
    if (!isOpen()) return;
    button.disabled = false;
    if (mute) mute.disabled = false;
  };

  button.addEventListener('click', () => runAction(action, {}));
  if (mute) {
    mute.addEventListener('change', () => runAction('mute', {
      game_type: 'splendor_duel', session_id: sessionId, muted: mute.checked
    }));
  }
  void refreshStatus();
};

window.showSettings = () => {
  const modal = document.getElementById('settings-modal');
  const content = document.getElementById('settings-content');
  
  if (!modal || !content) return;
  if (vsComputer.enabled) {
    content.innerHTML = `<p>You are playing vs Computer (level ${vsComputer.level})</p><button class="action-button" onclick="window.closeSettings(); window.startVsComputer(${vsComputer.level})">New game vs Computer</button><button class="action-button" onclick="window.closeSettings(); window.showModeSelection()">Choose game mode</button>`;
    modal.style.display = 'flex';
    modal.style.pointerEvents = 'auto';
    document.querySelector('.game-container')?.classList.add('dialog-blocking');
    return;
  }

  const trimmedSessionId = trimSessionId(syncContext.sessionId);
  const shareUrl = buildShareUrl(syncContext.sessionId);
  const shareQrSrc = buildShareQrUrl(shareUrl);
  
  let html = '';
  
  if (syncContext.enabled && syncContext.sessionId) {
    html += `
      <div class="settings-copy-group">
        <p><strong>Session ID:</strong></p>
        <div class="settings-copy-row">
          <div class="session-id-display">${trimmedSessionId}</div>
          <button class="inline-copy-btn" onclick="window.copySessionId()" title="Copy Session ID" aria-label="Copy Session ID">📋</button>
        </div>
      </div>
      <div class="settings-copy-group">
        <p><strong>Share Link:</strong></p>
        <div class="settings-copy-row">
          <div class="session-link-display" id="share-link-display">${shareUrl}</div>
          <button class="inline-copy-btn" onclick="window.copyShareLink()" title="Copy Share Link" aria-label="Copy Share Link">📋</button>
        </div>
        <div class="qr-wrapper">
          <img id="settings-qr-image" src="${shareQrSrc || ''}" alt="Share QR code" style="${shareQrSrc ? '' : 'display:none;'}" />
        </div>
      </div>
    `;
  } else {
    html += '<p>You are playing in local mode.</p>';
    if (syncContext.serviceAvailable || aiModeAvailable()) {
      html += `<button class="action-button" onclick="window.closeSettings(); window.showModeSelection();" style="margin-top: 10px;">${aiModeAvailable() ? 'Choose game mode' : 'Switch to Online Mode'}</button>`;
    } else {
      html += '<p style="font-size: 12px; color: #666;">Online sync is not available.</p>';
    }
  }

  const useNativePush = nativePushAvailable();
  if (useNativePush) {
    const canMute = syncContext.enabled && typeof syncContext.sessionId === 'string'
      && /^[A-Za-z0-9_-]{1,64}$/.test(syncContext.sessionId);
    html += `
      <div style="margin-top: 14px; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 12px;">
        <p><strong>Turn notifications:</strong></p>
        <p>Get a push when it's your turn, even with the app closed.</p>
        <p id="native-push-status" role="status">Checking...</p>
        <button id="native-push-button" class="action-button" hidden style="margin-top: 5px; font-size: 12px;">Turn on push</button>
        ${canMute ? '<p><label><input id="native-push-mute" type="checkbox"> Mute this game</label></p>' : ''}
        <p id="native-push-error" role="status"></p>
      </div>
    `;
  } else {
  html += `
    <div style="margin-top: 14px; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 12px;">
      <p><strong>Turn notifications:</strong> ${getTurnNotificationStatusLabel()}</p>
      <button class="action-button" onclick="window.enableTurnNotifications()" style="margin-top: 5px; font-size: 12px;">
        Enable Turn Notifications
      </button>
    </div>
  `;
  }

  if (isGameOver()) {
    const restartLabel = syncContext.enabled ? "Start New Game (Same Session)" : "Start New Local Game";
    html += `
      <div style="margin-top: 14px; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 12px;">
        <p><strong>Post-game:</strong></p>
        <button class="action-button" onclick="window.closeSettings(); window.confirmNewGameFromGameOver();"
          style="margin-top: 5px; font-size: 12px;">
          ${restartLabel}
        </button>
      </div>
    `;
  }
  
  content.innerHTML = html;
  modal.style.display = 'flex';
  modal.style.pointerEvents = 'auto';
  if (useNativePush) setupNativePushSettings();
  const gameContainer = document.querySelector('.game-container');
  if (gameContainer) {
    gameContainer.classList.add('dialog-blocking');
  }
  
  if (syncContext.enabled && syncContext.sessionId) {
    const shareLinkDisplay = document.getElementById('share-link-display');
    if (shareLinkDisplay) {
      shareLinkDisplay.textContent = shareUrl;
    }
    const qrImg = document.getElementById('settings-qr-image');
    if (qrImg && shareQrSrc) {
      qrImg.src = shareQrSrc;
      qrImg.style.display = '';
    } else if (qrImg && !shareQrSrc) {
      qrImg.style.display = 'none';
    }
  }
};

window.closeSettings = () => {
  const modal = document.getElementById('settings-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.style.pointerEvents = 'none';
    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
      gameContainer.classList.remove('dialog-blocking');
    }
  }
};

window.copySessionId = () => {
  if (syncContext.sessionId) {
    const trimmed = trimSessionId(syncContext.sessionId);
    navigator.clipboard.writeText(trimmed || syncContext.sessionId).then(() => {
      alert('Session ID copied to clipboard!');
    }).catch(() => {
      alert('Failed to copy. Session ID: ' + (trimmed || syncContext.sessionId));
    });
  }
};

window.copyShareLink = () => {
  const shareLinkDisplay = document.getElementById('share-link-display');
  if (shareLinkDisplay && shareLinkDisplay.textContent) {
    navigator.clipboard.writeText(shareLinkDisplay.textContent).then(() => {
      alert('Link copied to clipboard!');
    }).catch(() => {
      alert('Failed to copy link.');
    });
  }
};

window.enableTurnNotifications = async () => {
  const result = await requestTurnNotificationPermission();
  if (result === "granted") {
    alert("Turn notifications enabled.");
  } else if (result === "denied") {
    alert("Notifications are blocked. Enable them in browser site settings.");
  } else if (result === "unsupported") {
    alert("This browser does not support notifications.");
  } else {
    alert("Notification permission is still not enabled.");
  }
  window.closeSettings();
};

window.copySessionInfo = () => {
  const sessionLinkDisplay = document.getElementById('session-link-display');
  if (sessionLinkDisplay && sessionLinkDisplay.textContent) {
    navigator.clipboard.writeText(sessionLinkDisplay.textContent).then(() => {
      alert('Link copied to clipboard!');
    }).catch(() => {
      alert('Failed to copy link.');
    });
  }
};

window.closeSessionInfo = () => {
  const modal = document.getElementById('session-info-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.style.pointerEvents = 'none';
    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
      gameContainer.classList.remove('dialog-blocking');
    }
  }
};

// Update sync indicator on render
window.updateSyncIndicator = updateSyncUI;

// Helper function to join an existing session
const joinSession = async (sessionId, role = null) => {
  try {
    const session = await gameSyncClient.loadSession(sessionId);
    
    // Check if player2 is already assigned
    const meta = session.meta || {};
    if (meta.player2_assigned && role !== 'p1') {
      throw {
        type: 'player_conflict',
        message: 'Player 2 is already assigned. Someone else is already playing as player 2.'
      };
    }
    
    // Determine which player to assign
    // If role is 'p1', we're the host reconnecting (or explicitly switching devices)
    // Otherwise, we're a new joiner and should be player2
    let assignedPlayerId = role === 'p1' ? 'player1' : 'player2';
    const isReconnectingHost = role === 'p1';
    
    console.log('Joining session as:', assignedPlayerId, 'Session meta:', meta, 'Reconnecting host:', isReconnectingHost);
    
    // Apply the synced state FIRST (this will set up the game board)
    if (!applySyncedState(session.state_blob)) {
      throw new Error('Failed to apply synced state');
    }
    
    const authoritativeCurrentPlayer = gameState.currentPlayer;
    
    ensureSyncAssignmentsStructure();
    const assignments = gameState.syncAssignments;
    let assignmentUpdated = false;
    
    if (assignedPlayerId === 'player1') {
      if (assignments.player1Id && assignments.player1Id !== clientId) {
        throw {
          type: 'player_conflict',
          message: 'Player 1 is already assigned on another device.'
        };
      }
      if (assignments.player1Id !== clientId) {
        assignments.player1Id = clientId;
        assignmentUpdated = true;
      }
    } else {
      if (assignments.player2Id && assignments.player2Id !== clientId) {
        throw {
          type: 'player_conflict',
          message: 'Player 2 is already assigned on another device.'
        };
      }
      if (assignments.player2Id !== clientId) {
        assignments.player2Id = clientId;
        assignmentUpdated = true;
      }
    }
    
    // NOW set our player assignment and view
    syncContext.enabled = true;
    syncContext.sessionId = session.session_id;
    syncContext.version = session.version;
    syncContext.localPlayerId = assignedPlayerId;
    syncContext.isHost = isReconnectingHost; // Host reconnecting, or new joiner
    syncContext.syncStatus = 'online';
    
    // Update URL to ensure refresh works (if not already set)
    const url = new URL(window.location);
    if (!url.searchParams.has('session') || url.searchParams.get('session') !== session.session_id) {
      url.searchParams.set('session', session.session_id);
      if (isReconnectingHost) {
        url.searchParams.set('role', 'p1');
      } else {
        url.searchParams.delete('role'); // Joiners don't need role param
      }
      window.history.replaceState({}, '', url);
    }
    
    // CRITICAL: Set turn display to always show our player as active (bottom)
    // This ensures we see our own hand, not the opponent's
    turnDisplayState.activePlayerId = assignedPlayerId;
    turnDisplayState.opponentPlayerId = assignedPlayerId === 'player1' ? 'player2' : 'player1';
    
    // Persist assignment if needed
    if (assignmentUpdated) {
      try {
        gameState.currentPlayer = authoritativeCurrentPlayer;
        await pushStateUpdate('player assignment');
      } catch (error) {
        console.warn('Failed to push assignment update:', error);
      }
    }
    
    // Start polling for updates
    startPolling();
    
    updateSyncUI();
    renderGame(); // Re-render to show correct player view
    
    console.log('Joined session as:', assignedPlayerId, 'View shows:', turnDisplayState.activePlayerId, 'Current player in game:', gameState.currentPlayer);
    
    maybeShowPendingTurnDialog();
    requestTurnNotificationPermission();
    return true;
  } catch (error) {
    console.error('Failed to join session:', error);
    
    // Handle specific error types
    if (error.type === 'not_found') {
      console.warn('Session not found:', sessionId);
      alert('Session not found. Please check the session ID.');
    } else if (error.type === 'load_failed') {
      console.warn('Failed to load session:', error.message);
      alert('Failed to load session. Please try again.');
    } else if (error.type === 'player_conflict') {
      alert(error.message);
    }
    
    syncContext.enabled = false;
    syncContext.syncStatus = 'offline';
    updateSyncUI();
    return false;
  }
};

// Initialize the game
const init = async () => {
  refreshPowerModeClass();

  // Parse URL parameters first
  const urlParams = new URLSearchParams(window.location.search);
  const sessionParamRaw = urlParams.get('session');
  const normalizedSessionParam = normalizeSessionId(sessionParamRaw);
  const roleParam = urlParams.get('role');
  
  // Check GameSync service availability
  const serviceAvailable = await gameSyncClient.checkStatus();
  syncContext.serviceAvailable = serviceAvailable;
  syncContext.syncStatus = serviceAvailable ? 'online' : 'offline';
  
  // If session param exists and service is available, try to join/reconnect
  if (normalizedSessionParam && serviceAvailable) {
    // Determine role: if role param is p1, we're the host reconnecting
    // Otherwise, we're a joiner (p2)
    const role = roleParam === 'p1' ? 'p1' : null; // null = auto-assign p2
    const joined = await joinSession(normalizedSessionParam, role);
    if (joined) {
      console.log('Joined/reconnected to session:', normalizedSessionParam, 'as', syncContext.localPlayerId);
      const trimmed = trimSessionId(normalizedSessionParam);
      const url = new URL(window.location);
      if (trimmed) {
        url.searchParams.set('session', trimmed);
      } else {
        url.searchParams.set('session', normalizedSessionParam);
      }
      if (role === 'p1') {
        url.searchParams.set('role', 'p1');
      } else {
        url.searchParams.delete('role');
      }
      window.history.replaceState({}, '', url);
      updateSyncUI();
      // Don't initialize local game - we're using the synced state
      console.log('Game state initialized from session:', {
        totalCards: allCards.length,
        pyramid: gameState.pyramid,
        bag: gameState.bag,
        boardTokens: gameState.board.flat().filter(t => t !== null).length,
        royalCards: gameState.royalCards.length,
        currentPlayer: gameState.currentPlayer,
        localPlayer: syncContext.localPlayerId,
        isHost: syncContext.isHost
      });
      renderGame();
      return;
    } else {
      // Fall through to initialize local game
      console.warn('Failed to join session, initializing local game');
      // Remove session param from URL since it's invalid
      const url = new URL(window.location);
      url.searchParams.delete('session');
      url.searchParams.delete('role');
      window.history.replaceState({}, '', url);
    }
  }
  
  // Initialize local game (default behavior)
  initializeGame();
  
  // Update UI after initialization
  updateSyncUI();
  
  // If service is available and no session param, show mode selection after a delay
  if ((serviceAvailable || aiModeAvailable()) && !normalizedSessionParam) {
    setTimeout(() => {
      if (typeof window.showModeSelection === 'function') {
        window.showModeSelection();
      }
    }, 500);
  }
  
  console.log('Game state initialized:', {
    totalCards: allCards.length,
    pyramid: gameState.pyramid,
    bag: gameState.bag,
    boardTokens: gameState.board.flat().filter(t => t !== null).length,
    royalCards: gameState.royalCards.length,
    currentPlayer: gameState.currentPlayer
  });
  
  // Debug: check for cards with pearl costs
  const cardsWithPearls = allCards.filter(card => card.costs.pearl > 0);
  console.log('Cards with pearl costs:', cardsWithPearls.length);
  
  const pyramidCardsWithPearls = 
    gameState.pyramid.level1.filter(c => c.costs.pearl > 0).length +
    gameState.pyramid.level2.filter(c => c.costs.pearl > 0).length +
    gameState.pyramid.level3.filter(c => c.costs.pearl > 0).length;
  console.log('Pyramid cards with pearls:', pyramidCardsWithPearls);
  
  renderGame();
};

document.addEventListener("visibilitychange", () => {
  refreshPowerModeClass();
  maybeAdjustPollingCadence();
});

init();


// Remove global popover close on ESC, it's already handled above
