import "./style.css";

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

const loadCards = async () => {
  try {
    const response = await fetch('/splendor_cards.csv');
    const csvText = await response.text();
    allCards = parseCSV(csvText);
  } catch (error) {
    console.error('Failed to load cards:', error);
    // Fallback to empty arrays if CSV can't be loaded
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
};

const initializeGame = async () => {
  // Load cards from CSV first
  await loadCards();
  
  // Initialize game components
  initializeDecks();
  initializeRoyalCards();
  initializePyramid();
  placeTokensOnBoard();
  
  // Randomly choose first player (player 2 gets 1 privilege)
  gameState.currentPlayer = Math.random() < 0.5 ? 1 : 2;
  if (gameState.currentPlayer === 1) {
    gameState.players.player2.privileges = 1;
  } else {
    gameState.players.player1.privileges = 1;
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
  
  // Upper left section: color circle/triangle, points
  if (hasColor && !isWild) {
    const pointsDisplay = card.points > 0 ? `<div class="prestige-points">${card.points}</div>` : '';
    cardHTML += `<div class="color-circle ${getColorClass(card.color)}">${pointsDisplay}</div>`;
  } else if (isGrey && card.points > 0) {
    cardHTML += '<div class="points-corner"></div>';
    cardHTML += `<div class="prestige-points">${card.points}</div>`;
  } else if (isWild && card.points > 0) {
    // Wild cards need points display without color circle
    cardHTML += `<div class="prestige-points wild-points">${card.points}</div>`;
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
  
  // Upper left section: color circle/triangle, points
  if (hasColor && !isWild) {
    const pointsDisplay = card.points > 0 ? `<div class="prestige-points">${card.points}</div>` : '';
    cardHTML += `<div class="color-circle ${getColorClass(card.color)}">${pointsDisplay}</div>`;
  } else if (isGrey && card.points > 0) {
    cardHTML += '<div class="points-corner"></div>';
    cardHTML += `<div class="prestige-points">${card.points}</div>`;
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
  const playerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  const handDisplay = document.getElementById('player-hand');
  if (handDisplay) {
    handDisplay.innerHTML = renderPlayerHand(playerId);
  }
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
          <div class="opponent-resources-bar">
            <div class="opponent-victory-tracker-left">
              <div class="victory-stat small">
                <div class="victory-value score-value">0</div>
              </div>
              <div class="victory-stat small">
                <div class="victory-icon-backdrop crown">${generateCrownIcon(18)}</div>
                <div class="victory-value overlaid">0</div>
              </div>
              <div class="victory-stat small">
                <div class="victory-icon-backdrop color red"></div>
                <div class="victory-value overlaid">0</div>
              </div>
            </div>
            <div class="opponent-resources">
              <div class="opponent-hand-header-left">
                <div class="opponent-player-scrolls">
                  <span class="privilege-scroll-emoji">🗞️</span>
                  <span class="privilege-scroll-emoji">🗞️</span>
                  <span class="privilege-scroll-emoji">🗞️</span>
                </div>
              </div>
            <div class="opponent-hand-header-right">
              <div class="stat-icon pearl">
                ${generatePearlIcon(22)}
                <span class="stat-count pearl-count">${gameState.players.player2.tokens.pearl}</span>
              </div>
              <div class="stat-icon gold">
                ${generateGoldIcon(22)}
                <span class="stat-count gold-count">${gameState.players.player2.tokens.gold}</span>
              </div>
            </div>
            </div>
          </div>
          <div class="opponent-color-cards-row">
            <div class="opponent-color-card blue">
              <div class="opponent-token-dots">
                <span class="opponent-token-dot blue"></span>
                <span class="opponent-token-dot blue"></span>
              </div>
              <div class="opponent-power-circle blue">0</div>
              <div class="opponent-points-value">0 pts</div>
            </div>
            
            <div class="opponent-color-card white">
              <div class="opponent-token-dots">
                <span class="opponent-token-dot white"></span>
              </div>
              <div class="opponent-power-circle white">0</div>
              <div class="opponent-points-value">0 pts</div>
            </div>
            
            <div class="opponent-color-card green">
              <div class="opponent-token-dots">
              </div>
              <div class="opponent-power-circle green">0</div>
              <div class="opponent-points-value">0 pts</div>
            </div>
            
            <div class="opponent-color-card red">
              <div class="opponent-token-dots">
                <span class="opponent-token-dot red"></span>
                <span class="opponent-token-dot red"></span>
                <span class="opponent-token-dot red"></span>
                <span class="opponent-token-dot red"></span>
              </div>
              <div class="opponent-power-circle red">0</div>
              <div class="opponent-points-value">0 pts</div>
            </div>
            
            <div class="opponent-color-card black">
              <div class="opponent-wild-token-icon">
                <svg viewBox="0 0 24 24" width="24" height="24">
                  <!-- Black section (top) -->
                  <polygon points="12,12 12,2 21.6,8.6" fill="#2c3e50"/>
                  
                  <!-- White section (top-right) -->
                  <polygon points="12,12 21.6,8.6 18.1,20.3" fill="#f0f0f0" stroke="#ccc"/>
                  
                  <!-- Red section (bottom-right) -->
                  <polygon points="12,12 18.1,20.3 5.9,20.3" fill="#e74c3c"/>
                  
                  <!-- Green section (bottom-left) -->
                  <polygon points="12,12 5.9,20.3 2.4,8.6" fill="#7ed321"/>
                  
                  <!-- Blue section (top-left) -->
                  <polygon points="12,12 2.4,8.6 12,2" fill="#4a90e2"/>
                  
                  <polygon points="12,2 21.6,8.6 18.1,20.3 5.9,20.3 2.4,8.6" fill="none" stroke="#333" stroke-width="0.6"/>
                </svg>
              </div>
              <div class="opponent-power-circle black">0</div>
              <div class="opponent-points-value">0 pts</div>
            </div>
            
            <div class="opponent-reserved-section">
              <div class="opponent-reserved-count">0</div>
              <div class="opponent-reserved-label">Res</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Reserved Card View Modal -->
      <div class="modal-overlay" id="reserved-modal" style="display: none;">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Reserved Cards</h3>
            <button class="close-modal" onclick="document.getElementById('reserved-modal').style.display='none'">×</button>
          </div>
          <div class="reserved-cards-view">
            <div class="reserved-card-view">
              <div class="card level-2-card" style="width: 100px; height: 135px;">
                <div class="card-header">
                  <div class="card-level level-2">2</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+2</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Royal Cards Modal -->
      <div class="modal-overlay" id="royal-modal" style="display: none;">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Available Royal Cards</h3>
            <button class="close-modal" onclick="document.getElementById('royal-modal').style.display='none'">×</button>
          </div>
          <div class="royal-cards-view">
            <div class="royal-card-view">
              <div class="card royal-card-large">
                <div class="card-header">
                  <div class="card-level level-3">3</div>
                  <div class="crown-icon">${generateCrownIcon(20)}</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+5</div>
                </div>
              </div>
            </div>
            <div class="royal-card-view">
              <div class="card royal-card-large">
                <div class="card-header">
                  <div class="card-level level-3">3</div>
                  <div class="crown-icon">${generateCrownIcon(20)}</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+3</div>
                </div>
              </div>
            </div>
            <div class="royal-card-view">
              <div class="card royal-card-large">
                <div class="card-header">
                  <div class="card-level level-3">3</div>
                  <div class="crown-icon">${generateCrownIcon(20)}</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+7</div>
                </div>
              </div>
            </div>
            <div class="royal-card-view">
              <div class="card royal-card-large">
                <div class="card-header">
                  <div class="card-level level-3">3</div>
                  <div class="crown-icon">${generateCrownIcon(20)}</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+4</div>
                </div>
              </div>
            </div>
          </div>
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
                <div class="token-selection-content" id="token-board-container">
                  ${generateTokenBoard(220)}
                  <div id="token-click-overlays">${generateTokenOverlays()}</div>
                </div>
                <div class="token-modal-actions">
                  <button class="btn-cancel" onclick="closePopover('token-selection-modal')">Cancel</button>
                  <button class="btn-confirm" onclick="confirmTokenSelection()">Confirm</button>
                </div>
              </div>
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
              <div class="royal-cards-summary card-shaped" id="royal-cards-trigger" data-clickable="popover" data-popover="royal-modal">
                <div class="royal-card-icon-centered">${generateCrownIcon(32)}</div>
                <div class="royal-card-label">4</div>
              </div>
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
          const playerId = gameState.currentPlayer === 1 ? 'player1' : 'player2';
          const stats = getPlayerVictoryStats(playerId);
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
          <div class="hand-header-left">
            <div class="player-scrolls">
              <span class="privilege-scroll-emoji">🗞️</span>
              <span class="privilege-scroll-emoji">🗞️</span>
              <span class="privilege-scroll-emoji">🗞️</span>
            </div>
          </div>
          <div class="hand-header-right">
            <div class="stat-icon pearl">
              ${generatePearlIcon(24)}
              <span class="stat-count pearl-count">${gameState.players.player1.tokens.pearl}</span>
            </div>
            <div class="stat-icon gold">
              ${generateGoldIcon(24)}
              <span class="stat-count gold-count">${gameState.players.player1.tokens.gold}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Global Hand Display (always at bottom) -->
      <div class="global-hand-display" id="player-hand">
        ${renderPlayerHand('player1')}
      </div>
  </div>
  `;
};

// Track selected card
let selectedCard = null;
let selectedCardElement = null;

// Popover management functions
const openPopover = (id, cardData = null, cardElement = null) => {
  const popover = document.getElementById(id);
  if (popover) {
    if (id === 'card-detail-popover' && cardData) {
      selectedCard = cardData;
      selectedCardElement = cardElement;
      populateCardDetailPopover(cardData);
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
  }
};

const populateCardDetailPopover = (card) => {
  const modalBody = document.querySelector('#card-detail-popover .modal-body');
  if (!modalBody) return;
  
  // Render using card-v2 with large class for 3x scale
  const levelClass = `level-${card.level}-card`;
  const cardHTML = renderCardV2(card, levelClass).replace('card-v2', 'card-v2 large');
  
  modalBody.innerHTML = `
    <div style="display: flex; flex-direction: row; align-items: flex-start; gap: 30px; padding: 20px; justify-content: center; height: 100%;">
      <div style="display: flex; justify-content: center; align-items: center;">
        ${cardHTML}
      </div>
      <div style="display: flex; flex-direction: column; justify-content: space-between; height: 100%; padding-top: 20px; padding-bottom: 20px;">
        <div style="display: flex; flex-direction: column; gap: 15px;">
          <button onclick="buySelectedCard()" class="action-button buy-button">Buy</button>
          <button onclick="reserveSelectedCard()" class="action-button reserve-button">Reserve</button>
        </div>
        <div style="display: flex; justify-content: center;">
          <button onclick="closePopover('card-detail-popover')" class="action-button cancel-button">Cancel</button>
        </div>
      </div>
    </div>
  `;
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
  
  const level = selectedCard.level;
  const levelKey = `level${level}`;
  const index = selectedCard._pyramidIndex;
  
  // Add to player reserves
  gameState.players.player1.reserves.push(selectedCard);
  
  // Remove from pyramid
  gameState.pyramid[levelKey].splice(index, 1);
  
  // Draw new card from deck if available
  if (gameState.decks[levelKey].length > 0) {
    gameState.pyramid[levelKey].splice(index, 0, gameState.decks[levelKey].shift());
  }
  
  // Re-render the game
  renderGame();
  
  // Close popover
  closePopover('card-detail-popover');
};

// Token selection state
let selectedTokens = [];
let selectionError = null;

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
      const isGold = token === 'gold';
      const isEmpty = !token;
      
      // Use the same positioning calculation as the SVG
      const left = marginWidth + col * gridCellSize;
      const top = marginWidth + row * gridCellSize;
      
      let classes = 'token-overlay';
      if (isSelected) classes += ' selected';
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
    
    attachTokenBoardListeners();
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
  const validation = validateTokenSelection();
  
  if (!validation.valid) {
    showSelectionError(validation.message);
    return;
  }
  
  // Add tokens to player's hand
  const currentPlayer = gameState.currentPlayer === 1 ? 'player1' : 'player2';
  selectedTokens.forEach(({ token }) => {
    gameState.players[currentPlayer].tokens[token]++;
  });
  
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
};

// Expose to global scope for onclick handlers
window.buySelectedCard = buySelectedCard;
window.reserveSelectedCard = reserveSelectedCard;
window.confirmTokenSelection = confirmTokenSelection;

// Close any open popover on escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const openPopovers = document.querySelectorAll(".modal-overlay[style*='flex']");
    openPopovers.forEach(popover => popover.style.display = "none");
  }
});


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
        openPopover(modalId);
        // Attach token board listeners after modal is shown
        setTimeout(() => {
          attachTokenBoardListeners();
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
  }, 10);
};

// Initialize the game
const init = async () => {
  await initializeGame();
  
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
