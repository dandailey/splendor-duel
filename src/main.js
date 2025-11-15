import "./style.css";
import cardsCsv from "./splendor_cards.csv?raw";

let allCards = [];
let pyramidCards = { level1: [], level2: [], level3: [] };

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
  currentPlayer: 1
};

// Turn switching system (isolated for future changes)
// Tracks which player is displayed as "you" (bottom) vs "opponent" (top)
// This is separate from gameState.currentPlayer which tracks actual game state
const turnDisplayState = {
  activePlayerId: 'player1', // Player shown at bottom as "your hand"
  opponentPlayerId: 'player2' // Player shown at top as "opponent"
};

// Track previous crown counts to detect threshold crossings
const previousCrownCounts = {
  player1: 0,
  player2: 0
};

// Royal card selection state
let selectedRoyalCard = null;
let royalCardSelectionMode = false;

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

const shuffle = (array) => [...array].sort(() => Math.random() - 0.5);

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
  // If scrolls are available in the pool, give one to the player
  if (gameState.scrollPool > 0) {
    gameState.scrollPool--;
    gameState.players[playerId].privileges = (gameState.players[playerId].privileges || 0) + 1;
  } else {
    // No scrolls left - steal from the other player
    const otherPlayerId = playerId === 'player1' ? 'player2' : 'player1';
    const otherPlayer = gameState.players[otherPlayerId];
    
    if (otherPlayer.privileges > 0) {
      otherPlayer.privileges--;
      gameState.players[playerId].privileges = (gameState.players[playerId].privileges || 0) + 1;
    } else {
      // Other player has no scrolls either - still award (edge case)
      gameState.players[playerId].privileges = (gameState.players[playerId].privileges || 0) + 1;
    }
  }
};

const initializeGame = () => {
  // Load cards from inlined CSV
  loadCards();
  
  // Initialize game components
  initializeDecks();
  initializeRoyalCards();
  initializePyramid();
  placeTokensOnBoard();
  
  // Randomly choose first player (non-first player gets a scroll)
  gameState.currentPlayer = Math.random() < 0.5 ? 1 : 2;
  const nonFirstPlayerId = gameState.currentPlayer === 1 ? 'player2' : 'player1';
  awardScroll(nonFirstPlayerId);
  
  // Initialize turn display state to match game state
  turnDisplayState.activePlayerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  turnDisplayState.opponentPlayerId = gameState.currentPlayer === 1 ? 'player2' : 'player1';
  
  // Initialize previous crown counts
  previousCrownCounts.player1 = 0;
  previousCrownCounts.player2 = 0;
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

const generateAbilityIcon = (card) => {
  if (!card.ability) return '';
  
  const icons = {
    'wild': '🌐', // wild icon
    'again': '🔄', // repeat icon
    'token': '💎', // token picker - we can discuss this
    'steal': '✋', // hand/steal
    'scroll': '🗞️', // scroll
  };
  
  if (icons[card.ability]) {
    return `<span class="ability-icon">${icons[card.ability]}</span>`;
  }
  
  if (card.isDouble) {
    return `<div class="double-bonus"><span class="color-circle ${getColorClass(card.color)}"></span><span class="color-circle ${getColorClass(card.color)}"></span><span class="double-plus">+1</span></div>`;
  }
  
  return '';
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

const renderCardV2 = (card, levelClass) => {
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
  
  // Build card HTML with data attributes for tracking - using card-v2 class
  let cardHTML = `<div class="card card-v2 ${levelClass}" data-clickable="card" data-popover="card-detail-popover" data-card-level="${card.level}" data-card-index="${card._pyramidIndex ?? ''}" data-card-id="${card.id ?? ''}">`;
  
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
    if (card.ability || card.isDouble) {
      cardHTML += '<span class="card-ability">';
      cardHTML += generateAbilityIcon(card);
      cardHTML += '</span>';
    }
    cardHTML += '</div>';
  }
  
  // Costs at bottom
  cardHTML += '<div class="card-costs">';
  cardHTML += generateCostDisplay(card.costs);
  cardHTML += '</div>';
  
  // Wild icon for wild cards - centered above costs
  if (isWild) {
    cardHTML += '<div class="wild-icon-positioned">';
    cardHTML += '<svg viewBox="0 0 24 24" width="28" height="28" style="fill: #666;">';
    cardHTML += '<polygon points="12,12 12,2 21.6,8.6" fill="#2c3e50"/>';
    cardHTML += '<polygon points="12,12 21.6,8.6 18.1,20.3" fill="#f0f0f0" stroke="#ccc"/>';
    cardHTML += '<polygon points="12,12 18.1,20.3 5.9,20.3" fill="#e74c3c"/>';
    cardHTML += '<polygon points="12,12 5.9,20.3 2.4,8.6" fill="#7ed321"/>';
    cardHTML += '<polygon points="12,12 2.4,8.6 12,2" fill="#4a90e2"/>';
    cardHTML += '<polygon points="12,2 21.6,8.6 18.1,20.3 5.9,20.3 2.4,8.6" fill="none" stroke="#333" stroke-width="0.6"/>';
    cardHTML += '</svg>';
    cardHTML += '</div>';
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
    if (card.ability || card.isDouble) {
      cardHTML += '<span class="card-ability">';
      cardHTML += generateAbilityIcon(card);
      cardHTML += '</span>';
    }
    cardHTML += '</div>';
  }
  
  // Costs at bottom
  cardHTML += '<div class="card-costs">';
  cardHTML += generateCostDisplay(card.costs);
  cardHTML += '</div>';
  
  // Wild icon for wild cards - centered above costs
  if (isWild) {
    cardHTML += '<div class="wild-icon-positioned">';
    cardHTML += '<svg viewBox="0 0 24 24" width="28" height="28" style="fill: #666;">';
    cardHTML += '<polygon points="12,12 12,2 21.6,8.6" fill="#2c3e50"/>';
    cardHTML += '<polygon points="12,12 21.6,8.6 18.1,20.3" fill="#f0f0f0" stroke="#ccc"/>';
    cardHTML += '<polygon points="12,12 18.1,20.3 5.9,20.3" fill="#e74c3c"/>';
    cardHTML += '<polygon points="12,12 5.9,20.3 2.4,8.6" fill="#7ed321"/>';
    cardHTML += '<polygon points="12,12 2.4,8.6 12,2" fill="#4a90e2"/>';
    cardHTML += '<polygon points="12,2 21.6,8.6 18.1,20.3 5.9,20.3 2.4,8.6" fill="none" stroke="#333" stroke-width="0.6"/>';
    cardHTML += '</svg>';
    cardHTML += '</div>';
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
  
  player.cards.forEach(card => {
    cards[card.color] = (cards[card.color] || 0) + 1;
    points[card.color] = (points[card.color] || 0) + card.points;
  });
  
  return { cards, points };
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
    if (card.color && card.color !== 'none' && card.color !== 'wild') {
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
  // Allow gold to be used for any color with a cost, but only use what's needed
  // This lets users choose gold over tokens even when they have enough tokens
  Object.keys(assigned).forEach(kind => {
    if (assigned[kind] > 0 && totalCosts[kind] > 0) {
      // Use gold for this kind, but only up to what's actually needed
      const goldToUse = Math.min(assigned[kind], needs[kind] || 0);
      needs[kind] = Math.max(0, (needs[kind] || 0) - goldToUse);
      spend.gold += goldToUse;
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
  
  // Show ALL colors with costs as options for gold tokens (not just those with deficits)
  // This allows using gold even when you have enough cards/tokens
  const kindsWithCosts = [
    ...purchaseColors.filter(c => (costs[c] || 0) > 0),
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

  if (haveIcons.length > 0) {
    sections.push(`
      <div style="background:#ffffff; color:#222; padding:8px 10px; border-radius:8px; display:block; box-shadow:0 1px 2px rgba(0,0,0,.1);">
        <div style="font-weight:800; margin-bottom:6px;">You have:</div>
        <div style="display:flex; flex-wrap:wrap; align-items:center; gap:4px;">${haveIcons.join('')}</div>
      </div>
    `);
  } else {
    sections.push(`<div style="color:#ddd; font-style:italic;">You have no resources to buy this card</div>`);
  }

  if (!affordable) {
    sections.push(`<div style="margin-top:8px; color:#ff8a80;">You cannot buy this card with your current resources.</div>`);
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
    buyBtn.disabled = !plan.valid;
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
      reserveBtn.disabled = gameState.players[rpId].reserves.length >= 3;
    }
  }
};

const finalizePurchaseWithSelection = () => {
  if (!paymentState || !selectedCard) return;
  const { playerId } = paymentState;
  const plan = computePaymentPlanWithGold(selectedCard, playerId, paymentState.goldAssignments);
  if (!plan.valid) return;
  const player = gameState.players[playerId];
  // Deduct tokens according to computed plan and return them to bag
  ['gold', 'pearl', ...purchaseColors].forEach(color => {
    const spend = plan.spend[color] || 0;
    if (spend > 0) {
      player.tokens[color] = Math.max(0, (player.tokens[color] || 0) - spend);
      // Return spent tokens to the bag
      gameState.bag[color] = (gameState.bag[color] || 0) + spend;
    }
  });
  // Grant card: handle reserve vs pyramid source
  if (paymentState && paymentState.context && paymentState.context.fromReserve) {
    const rIndex = paymentState.context.reserveIndex;
    if (typeof rIndex === 'number' && rIndex >= 0) {
      const card = gameState.players[playerId].reserves.splice(rIndex, 1)[0];
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
  checkAndShowRoyalCardSelection();
};

const renderPlayerColorCard = (color, cardCount, tokenCount, points) => {
  const colorClasses = {
    blue: 'blue',
    white: 'white',
    green: 'green',
    black: 'black',
    red: 'red'
  };
  
  // Only show token dots if we have tokens
  let dotsHTML = '';
  if (tokenCount > 0) {
    const dots = [];
    for (let i = 0; i < tokenCount; i++) {
      dots.push(`<span class="token-dot ${colorClasses[color]}"></span>`);
    }
    dotsHTML = `<div class="token-dots">${dots.join('')}</div>`;
  }
  
  // Show dotted border when no cards
  const emptyStyle = cardCount === 0 ? 'style="border: 2px dashed #ccc; background: transparent;"' : '';
  
  let iconHTML = '';
  if (color === 'black' && cardCount > 0) {
    iconHTML = `
      <div class="wild-token-icon">
        <svg viewBox="0 0 32 32" width="32" height="32">
          <polygon points="16,16 16,2 29.3,11.7" fill="#2c3e50"/>
          <polygon points="16,16 29.3,11.7 24.2,27.3" fill="#f0f0f0" stroke="#ccc"/>
          <polygon points="16,16 24.2,27.3 7.8,27.3" fill="#e74c3c"/>
          <polygon points="16,16 7.8,27.3 2.7,11.7" fill="#7ed321"/>
          <polygon points="16,16 2.7,11.7 16,2" fill="#4a90e2"/>
          <polygon points="16,2 29.3,11.7 24.2,27.3 7.8,27.3 2.7,11.7" fill="none" stroke="#333" stroke-width="0.8"/>
        </svg>
      </div>
    `;
  }
  
  const emptyClass = cardCount === 0 ? 'color-card-empty' : '';
  
  return `
    <div class="color-card ${color} ${emptyClass}" ${emptyStyle}>
      ${dotsHTML}
      ${iconHTML}
      <div class="power-circle ${color}">${cardCount}</div>
      <div class="points-value">${points} pts</div>
    </div>
  `;
};

const renderPlayerHand = (playerId) => {
  const { cards, points } = getPlayerCards(playerId);
  const player = gameState.players[playerId];
  const colors = ['blue', 'white', 'green', 'red', 'black'];
  
  let html = '<div class="color-cards-row">';
  
  colors.forEach(color => {
    const cardCount = cards[color] || 0;
    const tokenCount = player.tokens[color] || 0;
    html += renderPlayerColorCard(color, cardCount, tokenCount, points[color] || 0);
  });
  
  // Add reserved cards section
  const reserveCount = gameState.players[playerId].reserves.length;
  html += `
    <div class="reserved-section" id="show-reserved" data-clickable="popover" data-popover="reserved-modal">
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
  }
};

// Render opponent stats for the top bar
const renderOpponentStats = () => {
  const opponentId = turnDisplayState.opponentPlayerId;
  const { cards, points } = getPlayerCards(opponentId);
  const player = gameState.players[opponentId];
  const stats = getPlayerVictoryStats(opponentId);
  const colors = ['blue', 'white', 'green', 'red', 'black'];
  
  let colorCardsHtml = '';
  colors.forEach(color => {
    const cardCount = cards[color] || 0;
    const tokenCount = player.tokens[color] || 0;
    const pointValue = points[color] || 0;
    
    let tokenDotsHtml = '';
    if (tokenCount > 0) {
      const dots = [];
      for (let i = 0; i < Math.min(tokenCount, 4); i++) {
        dots.push(`<span class="opponent-token-dot ${color}"></span>`);
      }
      tokenDotsHtml = `<div class="opponent-token-dots">${dots.join('')}</div>`;
    }
    
    let wildIconHtml = '';
    if (color === 'black' && cardCount > 0) {
      wildIconHtml = `
        <div class="opponent-wild-token-icon">
          <svg viewBox="0 0 24 24" width="24" height="24">
            <polygon points="12,12 12,2 21.6,8.6" fill="#2c3e50"/>
            <polygon points="12,12 21.6,8.6 18.1,20.3" fill="#f0f0f0" stroke="#ccc"/>
            <polygon points="12,12 18.1,20.3 5.9,20.3" fill="#e74c3c"/>
            <polygon points="12,12 5.9,20.3 2.4,8.6" fill="#7ed321"/>
            <polygon points="12,12 2.4,8.6 12,2" fill="#4a90e2"/>
            <polygon points="12,2 21.6,8.6 18.1,20.3 5.9,20.3 2.4,8.6" fill="none" stroke="#333" stroke-width="0.6"/>
          </svg>
        </div>
      `;
    }
    
    colorCardsHtml += `
      <div class="opponent-color-card ${color}">
        ${tokenDotsHtml}
        ${wildIconHtml}
        <div class="opponent-power-circle ${color}">${cardCount}</div>
        <div class="opponent-points-value">${pointValue} pts</div>
      </div>
    `;
  });
  
  const reserveCount = player.reserves.length;
  
  return `
    <div class="opponent-resources-bar">
      <div class="opponent-victory-tracker-left">
        <div class="victory-stat small">
          <div class="victory-value score-value">${stats.totalPoints}</div>
        </div>
        <div class="victory-stat small">
          <div class="victory-icon-backdrop crown">${generateCrownIcon(18)}</div>
          <div class="victory-value overlaid">${stats.totalCrowns}</div>
        </div>
        <div class="victory-stat small">
          <div class="victory-icon-backdrop color ${stats.maxColor} ${stats.maxPoints === 0 ? 'empty' : ''}"></div>
          <div class="victory-value overlaid">${stats.maxPoints}</div>
        </div>
      </div>
      <div class="opponent-resources">
        ${generateResourceIcons(opponentId, 22)}
      </div>
    </div>
    <div class="opponent-color-cards-row">
      ${colorCardsHtml}
      <div class="opponent-reserved-section">
        <div class="opponent-reserved-count">${reserveCount}</div>
        <div class="opponent-reserved-label">Res</div>
      </div>
    </div>
  `;
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

const generateGameLayout = () => {
  return `
    <div class="game-container">
      <!-- Top Bar: Token Board (left) and Opponent Stats (right) -->
      <div class="top-bar">
        <div class="token-board-container" id="token-board-top">
          <div class="token-board" data-clickable="popover" data-popover="token-selection-modal">
            ${generateTokenBoard()}
          </div>
        </div>
        <div class="opponent-stats-container" id="opponent-stats" data-clickable="popover" data-popover="opponent-hand-modal">
          ${renderOpponentStats()}
        </div>
      </div>

      <!-- Opponent Hand Modal -->
      <div class="modal-overlay" id="opponent-hand-modal" style="display: none;">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Opponent's Hand</h3>
            <button class="close-modal" onclick="closePopover('opponent-hand-modal')">×</button>
          </div>
          <div class="modal-body">
            <!-- Content will go here -->
          </div>
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

          <!-- Turn Completion Dialog -->
          <div class="modal-overlay card-modal-overlay" id="turn-completion-dialog" style="display: none;">
            <div class="modal-content turn-completion-content">
              <div class="turn-completion-message">
                <h3>Your turn has been completed</h3>
                <p>Click below to switch players</p>
              </div>
              <button class="action-button switch-players-button" id="switch-players-btn">Switch Players</button>
            </div>
          </div>
          
          <div class="card-pyramid">
            <div class="pyramid-row">
              <div class="deck-meter-container">
                <div class="deck-meter">
                  <div class="meter-fill level-1" style="height: ${getDeckMeterHeight(1)}%"></div>
                </div>
              </div>
              ${gameState.pyramid.level1.map((card, idx) => {
                card._pyramidIndex = idx;
                return renderCardV2(card, 'level-1-card');
              }).join('')}
              <div class="card-spacer"></div>
              <div class="card-spacer"></div>
              ${(() => {
                const availableCount = gameState.royalCards.filter(card => !card.taken).length;
                const isEmpty = availableCount === 0;
                const clickableAttr = isEmpty ? '' : 'data-clickable="popover" data-popover="royal-modal"';
                const emptyClass = isEmpty ? 'royal-cards-empty' : '';
                return `
                  <div class="royal-cards-summary card-shaped ${emptyClass}" id="royal-cards-trigger" ${clickableAttr}>
                    <div class="royal-card-icon-centered ${isEmpty ? 'royal-icon-greyed' : ''}">${generateCrownIcon(32)}</div>
                    <div class="royal-card-label">${availableCount}</div>
                  </div>
                `;
              })()}
            </div>

            <div class="pyramid-row">
              <div class="deck-meter-container">
                <div class="deck-meter">
                  <div class="meter-fill level-2" style="height: ${getDeckMeterHeight(2)}%"></div>
                </div>
              </div>
              ${gameState.pyramid.level2.map((card, idx) => {
                card._pyramidIndex = idx;
                return renderCardV2(card, 'level-2-card');
              }).join('')}
            </div>

            <div class="pyramid-row">
              <div class="deck-meter-container">
                <div class="deck-meter">
                  <div class="meter-fill level-3" style="height: ${getDeckMeterHeight(3)}%"></div>
                </div>
              </div>
              ${gameState.pyramid.level3.map((card, idx) => {
                card._pyramidIndex = idx;
                return renderCardV2(card, 'level-3-card');
              }).join('')}
              <div class="card-spacer"></div>
              <div class="card-spacer"></div>
            </div>
          </div>
        </div>

      <!-- Player Stats Section -->
      <div class="player-stats-bar">
        ${(() => {
          const stats = getPlayerVictoryStats(turnDisplayState.activePlayerId);
          return `
            <div class="victory-tracker-left">
              <div class="victory-stat large">
                <div class="victory-value score-value-large">${stats.totalPoints}</div>
              </div>
              <div class="victory-stat large">
                <div class="victory-icon-backdrop crown">${generateCrownIcon(18)}</div>
                <div class="victory-value overlaid">${stats.totalCrowns}</div>
              </div>
              <div class="victory-stat large">
                <div class="victory-icon-backdrop color ${stats.maxColor} ${stats.maxPoints === 0 ? 'empty' : ''}"></div>
                <div class="victory-value overlaid">${stats.maxPoints}</div>
              </div>
            </div>`;
        })()}
        <div class="player-resources">
          ${generateResourceIcons(turnDisplayState.activePlayerId, 24)}
        </div>
      </div>

      <!-- Global Hand Display (always at bottom) -->
      <div class="global-hand-display" id="player-hand">
        ${renderPlayerHand(turnDisplayState.activePlayerId)}
      </div>
  </div>
  `;
};

// Track selected card
let selectedCard = null;
let selectedCardElement = null;
let purchaseContext = null; // { source: 'pyramid'|'reserve', reserveIndex?: number, playerId?: string }

// Popover management functions
const openPopover = (id, cardData = null, cardElement = null) => {
  const popover = document.getElementById(id);
  if (popover) {
    // Don't allow opening other modals if royal card selection is active
    if (royalCardSelectionMode && id !== 'royal-modal') {
      return;
    }
    
    if (id === 'card-detail-popover' && cardData) {
      selectedCard = cardData;
      selectedCardElement = cardElement;
      populateCardDetailPopover(cardData);
    } else if (id === 'reserved-modal') {
      populateReservedModal();
    } else if (id === 'royal-modal') {
      populateRoyalCardsModal(royalCardSelectionMode);
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
    boardWasRefilled = false;
  }
  if (id === 'royal-modal' && !royalCardSelectionMode) {
    // If closing royal modal in non-selection mode, make sure blocking is removed
    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
      gameContainer.classList.remove('dialog-blocking');
    }
  }
};

// Reserved cards modal rendering
const populateReservedModal = () => {
  const modalBody = document.querySelector('#reserved-modal .modal-body');
  if (!modalBody) return;
  const currentPlayerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const reserves = gameState.players[currentPlayerId].reserves || [];

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
    const afford = getAffordability(card, currentPlayerId);
    const cardHtml = renderCardV2(card, `level-${card.level}-card`);
    return `
      <div class="reserved-card-wrapper" style="flex:0 0 30%; max-width:30%; display:flex; flex-direction:column; align-items:center; gap:10px; padding-bottom:14px;">
        <div style="display:flex; justify-content:center; align-items:center; transform: scale(1.4); transform-origin: top center; margin-bottom:30px;">
          ${cardHtml}
        </div>
        <button class="action-button buy-button" ${afford.affordable ? '' : 'disabled'} data-reserve-index="${idx}">Buy</button>
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
      purchaseContext = { source: 'reserve', reserveIndex: idx, playerId: currentPlayerId };
      // Close the reserved modal first to prevent overlapping overlays
      closePopover('reserved-modal');
      openPopover('card-detail-popover', card, null);
    });
  });
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

  const fromReserve = purchaseContext && purchaseContext.source === 'reserve';
  modalBody.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:10px; padding:12px; height:100%; box-sizing:border-box;">
      <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:flex-start; flex:1 1 auto; overflow:hidden;">
        <div style="display:flex; justify-content:center; align-items:center; transform: scale(2); transform-origin: top left; position: relative; z-index: 1;">
          ${cardHTML}
        </div>
        <div id="payment-pane-wrapper" style="flex:1 1 260px; min-width:260px; margin-left:24px; height:100%; overflow:auto; position:relative; z-index:2;">
          <div id="payment-pane"></div>
        </div>
      </div>
      <div style="display:flex; gap:10px; justify-content:center; padding-top:6px; margin-top:auto;">
        <button id="buy-button" class="action-button buy-button" ${afford.affordable ? '' : 'disabled'}>Buy</button>
        ${fromReserve ? '' : `<button onclick="reserveSelectedCard()" class="action-button reserve-button" ${gameState.players[currentPlayerId].reserves.length >= 3 ? 'disabled' : ''}>Reserve</button>`}
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

const buySelectedCard = () => {
  if (!selectedCard) return;
  
  const level = selectedCard.level;
  const levelKey = `level${level}`;
  const index = selectedCard._pyramidIndex;
  const currentPlayerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  
  // Add card to current player's collection
  gameState.players[currentPlayerId].cards.push(selectedCard);
  
  // Remove from pyramid
  gameState.pyramid[levelKey].splice(index, 1);
  
  // Draw new card from deck if available
  if (gameState.decks[levelKey].length > 0) {
    gameState.pyramid[levelKey].splice(index, 0, gameState.decks[levelKey].shift());
  }
  
  // Close popover before re-rendering
  closePopover('card-detail-popover');
  
  // Re-render the game
  renderGame();
};

const reserveSelectedCard = () => {
  if (!selectedCard) return;
  const currentPlayerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const player = gameState.players[currentPlayerId];
  // Guard: max 3 reserves
  if (player.reserves.length >= 3) return;

  const level = selectedCard.level;
  const levelKey = `level${level}`;
  const index = selectedCard._pyramidIndex;

  // Add to player reserves
  player.reserves.push(selectedCard);

  // Attempt to award a random gold token from the board if any exist
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
  }

  // Remove from pyramid
  gameState.pyramid[levelKey].splice(index, 1);

  // Draw new card from deck if available
  if (gameState.decks[levelKey].length > 0) {
    gameState.pyramid[levelKey].splice(index, 0, gameState.decks[levelKey].shift());
  }

  // Close popover before re-render
  closePopover('card-detail-popover');
  // Re-render the game
  renderGame();
  checkAndShowRoyalCardSelection();
};

// Token selection state
let selectedTokens = [];
let selectionError = null;
let scrollSelectionMode = false;
let scrollSelectedToken = null;
let boardWasRefilled = false;

// Toggle token selection
const toggleTokenSelection = (row, col) => {
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
};

// Validate token selection
const validateTokenSelection = () => {
  if (selectedTokens.length === 0 || selectedTokens.length > 3) {
    return { valid: false, message: 'You must select between 1 and 3 tokens' };
  }
  
  if (selectedTokens.length === 1) {
    return { valid: true };
  }
  
  // Check if tokens form a valid line
  const positions = selectedTokens.map(t => [t.row, t.col]);
  
  // Check for horizontal line
  const rows = new Set(positions.map(p => p[0]));
  if (rows.size === 1 && selectedTokens.length === 2) {
    // Two tokens in same row - check if adjacent
    const sortedCols = positions.map(p => p[1]).sort((a, b) => a - b);
    if (sortedCols[1] - sortedCols[0] === 1) {
      return checkLineForGoldOrEmpty(positions);
    }
  }
  
  // Check for vertical line
  const cols = new Set(positions.map(p => p[1]));
  if (cols.size === 1 && selectedTokens.length === 2) {
    // Two tokens in same col - check if adjacent
    const sortedRows = positions.map(p => p[0]).sort((a, b) => a - b);
    if (sortedRows[1] - sortedRows[0] === 1) {
      return checkLineForGoldOrEmpty(positions);
    }
  }
  
  // Check for diagonal line (for 2 tokens)
  if (selectedTokens.length === 2) {
    const rowDiff = Math.abs(positions[0][0] - positions[1][0]);
    const colDiff = Math.abs(positions[0][1] - positions[1][1]);
    if (rowDiff === 1 && colDiff === 1) {
      return checkLineForGoldOrEmpty(positions);
    }
  }
  
  // For 3 tokens, must all be adjacent and in line
  if (selectedTokens.length === 3) {
    // Sort positions to find direction
    positions.sort((a, b) => {
      if (a[0] !== b[0]) return a[0] - b[0];
      return a[1] - b[1];
    });
    
    // Check horizontal line of 3
    const allSameRow = positions.every(p => p[0] === positions[0][0]);
    if (allSameRow && positions[2][1] - positions[0][1] === 2) {
      return checkLineForGoldOrEmpty(positions);
    }
    
    // Check vertical line of 3
    const allSameCol = positions.every(p => p[1] === positions[0][1]);
    if (allSameCol && positions[2][0] - positions[0][0] === 2) {
      return checkLineForGoldOrEmpty(positions);
    }
    
    // Check diagonal line of 3
    const rowDiff = positions[2][0] - positions[0][0];
    const colDiff = positions[2][1] - positions[0][1];
    if (Math.abs(rowDiff) === 2 && Math.abs(colDiff) === 2 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      return checkLineForGoldOrEmpty(positions);
    }
  }
  
  return { valid: false, message: 'Tokens must be adjacent and in a straight line' };
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
  // Don't allow normal token selection if in scroll mode
  if (scrollSelectionMode) {
    return;
  }
  
  const validation = validateTokenSelection();
  
  if (!validation.valid) {
    showSelectionError(validation.message);
    return;
  }
  
  // Add tokens to player's hand
  const currentPlayer = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const otherPlayer = currentPlayer === 'player1' ? 'player2' : 'player1';
  
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
    }
  }
  
  // 2. Two pearls
  if (pearlCount === 2) {
    awardScroll(otherPlayer);
  }
  
  // Remove tokens from board
  selectedTokens.forEach(({ row, col }) => {
    gameState.board[row][col] = null;
  });
  
  // Clear selection
  selectedTokens = [];
  selectionError = null;
  
  // Close modal before re-rendering
  closePopover('token-selection-modal');
  
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
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// Refill board from bag in spiral order
const refillBoard = () => {
  if (isBagEmpty()) {
    return;
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
  awardScroll(otherPlayer);
  
  // Mark that board was refilled (disables scroll usage)
  boardWasRefilled = true;
  
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
      const disabled = boardWasRefilled ? 'disabled' : '';
      html += `<div class="scroll-icon ${disabled}" data-scroll-index="${i}" onclick="${disabled ? '' : 'enterScrollSelectionMode()'}">`;
      html += `<span class="privilege-scroll-emoji" style="font-size: ${iconSize}px;">🗞️</span>`;
      html += '</div>';
    }
    
    html += '</div>';
    
    if (boardWasRefilled) {
      html += '<div class="scroll-disabled-message">You may not use scrolls after refilling the board</div>';
    }
    
    html += '</div>';
    section.innerHTML = html;
  }
};

// Enter scroll selection mode
const enterScrollSelectionMode = () => {
  scrollSelectionMode = true;
  scrollSelectedToken = null;
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
  if (!scrollSelectedToken) return;
  
  const currentPlayerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const player = gameState.players[currentPlayerId];
  
  // Add token to player's hand
  player.tokens[scrollSelectedToken.token]++;
  
  // Remove token from board
  gameState.board[scrollSelectedToken.row][scrollSelectedToken.col] = null;
  
  // Reduce scroll count
  player.privileges = Math.max(0, (player.privileges || 0) - 1);
  
  // Reset scroll selection state
  scrollSelectedToken = null;
  scrollSelectionMode = false;
  
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
    refillBtn.disabled = isBagEmpty();
  }
};

// Royal card selection functions
const selectRoyalCard = (cardId) => {
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
  if (!royalCardSelectionMode || !selectedRoyalCard) return;
  
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
  
  // Award scroll if card has scroll ability
  if (selectedRoyalCard.ability === 'scroll') {
    awardScroll(currentPlayerId);
  }
  
  // Mark card as taken
  selectedRoyalCard.taken = true;
  
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
  
  // Show normal turn completion dialog
  showTurnCompletionDialog();
};

// Expose to global scope for onclick handlers
window.buySelectedCard = buySelectedCard;
window.reserveSelectedCard = reserveSelectedCard;
window.confirmTokenSelection = confirmTokenSelection;
window.refillBoard = refillBoard;
window.enterScrollSelectionMode = enterScrollSelectionMode;
window.cancelScrollSelection = cancelScrollSelection;
window.confirmScrollSelection = confirmScrollSelection;
window.selectRoyalCard = selectRoyalCard;
window.confirmRoyalCardSelection = confirmRoyalCardSelection;
// Deprecated: payment now renders inline in the same modal

// Close any open popover on escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const openPopovers = document.querySelectorAll(".modal-overlay[style*='flex']");
    openPopovers.forEach(popover => {
      // Don't close turn completion dialog or royal modal in selection mode with ESC
      if (popover.id !== 'turn-completion-dialog' && !(popover.id === 'royal-modal' && royalCardSelectionMode)) {
        popover.style.display = "none";
      }
    });
  }
});


// Turn switching system functions
// Check if player has earned a royal card and show selection if needed
const checkAndShowRoyalCardSelection = () => {
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
    // Update previous count and show normal turn completion
    previousCrownCounts[currentPlayerId] = currentCrowns;
    showTurnCompletionDialog();
  }
};

const showTurnCompletionDialog = () => {
  const dialog = document.getElementById('turn-completion-dialog');
  if (!dialog) return;
  
  // Add class to game container to block interactions
  const gameContainer = document.querySelector('.game-container');
  if (gameContainer) {
    gameContainer.classList.add('dialog-blocking');
  }
  
  dialog.style.display = 'flex';
};

const closeTurnCompletionDialog = () => {
  const dialog = document.getElementById('turn-completion-dialog');
  if (dialog) {
    dialog.style.display = 'none';
  }
  
  // Remove blocking class from game container
  const gameContainer = document.querySelector('.game-container');
  if (gameContainer) {
    gameContainer.classList.remove('dialog-blocking');
  }
};

const switchPlayers = () => {
  // Swap the display state
  const temp = turnDisplayState.activePlayerId;
  turnDisplayState.activePlayerId = turnDisplayState.opponentPlayerId;
  turnDisplayState.opponentPlayerId = temp;
  
  // Update gameState.currentPlayer to match (for action consistency)
  // This keeps actions in sync, but display state is separate for future changes
  gameState.currentPlayer = turnDisplayState.activePlayerId === 'player1' ? 1 : 2;
  
  // Add transition class to elements
  const handDisplay = document.getElementById('player-hand');
  const opponentStats = document.getElementById('opponent-stats');
  const playerStats = document.querySelector('.player-stats-bar');
  
  if (handDisplay) handDisplay.classList.add('switching');
  if (opponentStats) opponentStats.classList.add('switching');
  if (playerStats) playerStats.classList.add('switching');
  
  // Wait for transition, then update content
  setTimeout(() => {
    // Update opponent stats
    if (opponentStats) {
      opponentStats.innerHTML = renderOpponentStats();
    }
    
    // Update player stats
    if (playerStats) {
      const stats = getPlayerVictoryStats(turnDisplayState.activePlayerId);
      const victoryTracker = playerStats.querySelector('.victory-tracker-left');
      const resources = playerStats.querySelector('.player-resources');
      
      if (victoryTracker) {
        victoryTracker.innerHTML = `
          <div class="victory-stat large">
            <div class="victory-value score-value-large">${stats.totalPoints}</div>
          </div>
          <div class="victory-stat large">
            <div class="victory-icon-backdrop crown">${generateCrownIcon(18)}</div>
            <div class="victory-value overlaid">${stats.totalCrowns}</div>
          </div>
          <div class="victory-stat large">
            <div class="victory-icon-backdrop color ${stats.maxColor} ${stats.maxPoints === 0 ? 'empty' : ''}"></div>
            <div class="victory-value overlaid">${stats.maxPoints}</div>
          </div>
        `;
      }
      
      if (resources) {
        resources.innerHTML = generateResourceIcons(turnDisplayState.activePlayerId, 24);
      }
    }
    
    // Update hand display
    if (handDisplay) {
      handDisplay.innerHTML = renderPlayerHand(turnDisplayState.activePlayerId);
    }
    
    // Remove transition class after a brief delay
    setTimeout(() => {
      if (handDisplay) handDisplay.classList.remove('switching');
      if (opponentStats) opponentStats.classList.remove('switching');
      if (playerStats) playerStats.classList.remove('switching');
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
        boardWasRefilled = false;
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
};

const renderGame = () => {
  document.querySelector("#app").innerHTML = generateGameLayout();
  
  // Re-attach event listeners
  setTimeout(() => {
    attachPopoverListeners();
    // Attach turn completion dialog handler
    const switchBtn = document.getElementById('switch-players-btn');
    if (switchBtn) {
      // Remove old handler if exists
      if (switchBtn._handlerAttached) {
        switchBtn.removeEventListener('click', switchBtn._clickHandler);
      }
      switchBtn._clickHandler = () => {
        switchPlayers();
        closeTurnCompletionDialog();
      };
      switchBtn.addEventListener('click', switchBtn._clickHandler);
      switchBtn._handlerAttached = true;
    }
  }, 10);
};

// Initialize the game
const init = () => {
  initializeGame();
  
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

init();


// Remove global popover close on ESC, it's already handled above
window.closePopover = closePopover;
