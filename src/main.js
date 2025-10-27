import "./style.css";

let allCards = [];
let pyramidCards = { level1: [], level2: [], level3: [] };

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
    
    // Separate cards by level
    const byLevel = { 1: [], 2: [], 3: [] };
    allCards.forEach(card => {
      byLevel[card.level].push(card);
    });
    
    // Randomly select cards for pyramid
    const shuffle = (array) => [...array].sort(() => Math.random() - 0.5);
    
    pyramidCards.level1 = shuffle(byLevel[1]).slice(0, 3);
    pyramidCards.level2 = shuffle(byLevel[2]).slice(0, 4);
    pyramidCards.level3 = shuffle(byLevel[3]).slice(0, 5);
  } catch (error) {
    console.error('Failed to load cards:', error);
    // Fallback to empty arrays if CSV can't be loaded
  }
};

const createCard = (data) => ({
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

const generatePearlIcon = (size = 24) => {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" role="img" aria-label="pearl">
    <defs>
      <radialGradient id="pearlGradient" cx="35%" cy="30%" r="65%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="45%" stop-color="#ffe6f0"/>
        <stop offset="75%" stop-color="#f6d1e8"/>
        <stop offset="100%" stop-color="#d7a8d6"/>
      </radialGradient>
    </defs>
    <circle cx="12" cy="12" r="9" fill="url(#pearlGradient)" stroke="#c9a5c9" stroke-width="1"/>
    <circle cx="9" cy="9" r="4" fill="rgba(255, 255, 255, 0.7)"/>
  </svg>`;
};

const generateGoldIcon = (size = 24) => {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" role="img" aria-label="gold coin">
    <defs>
      <radialGradient id="goldGradient" cx="40%" cy="30%" r="70%">
        <stop offset="0%" stop-color="#fff6a3"/>
        <stop offset="40%" stop-color="#ffd85c"/>
        <stop offset="70%" stop-color="#f4b41a"/>
        <stop offset="100%" stop-color="#c78100"/>
      </radialGradient>
    </defs>
    <circle cx="12" cy="12" r="9" fill="url(#goldGradient)" stroke="#a86b00" stroke-width="1.2"/>
    <circle cx="12" cy="12" r="6" fill="none" stroke="#b97800" stroke-width="1"/>
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
        return `<div class="cost-item pearl ${className}"><div class="cost-token pearl"></div></div>`;
      }
      return `<div class="cost-item ${color} ${className}"><div class="cost-token"><span class="cost-number">${amount}</span></div></div>`;
    }).join('');
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
  
  // Build card HTML
  let cardHTML = `<div class="card ${levelClass}" data-clickable="card" data-popover="card-detail-popover">`;
  
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

const generateResourceSummary = () => {
  return `
    <div class="resource-summary">
      <div class="resource-summary-item">
        <span class="token-mini blue"></span><span>2</span>
      </div>
      <div class="resource-summary-item">
        <span class="token-mini white"></span><span>1</span>
      </div>
      <div class="resource-summary-item">
        <span class="token-mini green"></span><span>0</span>
      </div>
      <div class="resource-summary-item">
        <span class="token-mini black"></span><span>1</span>
      </div>
      <div class="resource-summary-item">
        <span class="token-mini red"></span><span>0</span>
      </div>
      <div class="resource-summary-item">
        <span class="token-mini gold"></span><span>0</span>
      </div>
      <div class="resource-summary-item">
        <span class="token-mini pearl"></span><span>0</span>
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
            <div class="token-spaces">
              <div class="token-space"><div class="token token-blue"></div></div>
              <div class="token-space"><div class="token token-white"></div></div>
              <div class="token-space"><div class="token token-green"></div></div>
              <div class="token-space"><div class="token token-black"></div></div>
              <div class="token-space"><div class="token token-red"></div></div>
              <div class="token-space"><div class="token token-pearl"></div></div>
              <div class="token-space"><div class="token token-blue"></div></div>
              <div class="token-space"><div class="token token-white"></div></div>
              <div class="token-space"><div class="token token-green"></div></div>
              <div class="token-space"><div class="token token-black"></div></div>
              <div class="token-space"><div class="token token-red"></div></div>
              <div class="token-space"><div class="token token-gold"></div></div>
              <div class="token-space"><div class="token token-blue"></div></div>
              <div class="token-space"><div class="token token-white"></div></div>
              <div class="token-space"><div class="token token-green"></div></div>
              <div class="token-space"><div class="token token-black"></div></div>
              <div class="token-space"><div class="token token-red"></div></div>
              <div class="token-space"><div class="token token-pearl"></div></div>
              <div class="token-space"><div class="token token-blue"></div></div>
              <div class="token-space"><div class="token token-white"></div></div>
              <div class="token-space"><div class="token token-green"></div></div>
              <div class="token-space"><div class="token token-black"></div></div>
              <div class="token-space"><div class="token token-red"></div></div>
              <div class="token-space"><div class="token token-gold"></div></div>
              <div class="token-space"><div class="token token-blue"></div></div>
            </div>
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
                  <span class="stat-count pearl-count">0</span>
                </div>
                <div class="stat-icon gold">
                  ${generateGoldIcon(22)}
                  <span class="stat-count gold-count">0</span>
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

      <!-- Card Detail Popover -->
      <div class="modal-overlay" id="card-detail-popover" style="display: none;">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Card Details</h3>
            <button class="close-modal" onclick="closePopover('card-detail-popover')">×</button>
          </div>
          <div class="modal-body">
            <!-- Content will go here -->
          </div>
        </div>
      </div>

      <!-- Token Selection Modal -->
      <div class="modal-overlay" id="token-selection-modal" style="display: none;">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Select Tokens</h3>
            <button class="close-modal" onclick="closePopover('token-selection-modal')">×</button>
          </div>
          <div class="modal-body">
            <!-- Content will go here -->
          </div>
        </div>
      </div>

      <!-- Main Pyramid Area -->
      <div class="pyramid-container">
          <div class="card-pyramid">
            <div class="pyramid-row">
              <div class="deck-meter-container">
                <div class="deck-meter">
                  <div class="meter-fill level-1" style="height: 85%"></div>
                </div>
              </div>
              ${pyramidCards.level1.map(card => renderCard(card, 'level-1-card')).join('')}
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
                  <div class="meter-fill level-2" style="height: 72%"></div>
                </div>
              </div>
              ${pyramidCards.level2.map(card => renderCard(card, 'level-2-card')).join('')}
            </div>

            <div class="pyramid-row">
              <div class="deck-meter-container">
                <div class="deck-meter">
                  <div class="meter-fill level-3" style="height: 58%"></div>
                </div>
              </div>
              ${pyramidCards.level3.map(card => renderCard(card, 'level-3-card')).join('')}
              <div class="card-spacer"></div>
              <div class="card-spacer"></div>
            </div>
          </div>
        </div>

      <!-- Player Stats Section -->
      <div class="player-stats-bar">
        <div class="victory-tracker-left">
          <div class="victory-stat large">
            <div class="victory-value score-value-large">0</div>
          </div>
          <div class="victory-stat large">
            <div class="victory-icon-backdrop crown">${generateCrownIcon(18)}</div>
            <div class="victory-value overlaid">0</div>
          </div>
          <div class="victory-stat large">
            <div class="victory-icon-backdrop color blue"></div>
            <div class="victory-value overlaid">0</div>
          </div>
        </div>
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
              <span class="stat-count pearl-count">0</span>
            </div>
            <div class="stat-icon gold">
              ${generateGoldIcon(24)}
              <span class="stat-count gold-count">0</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Global Hand Display (always at bottom) -->
      <div class="global-hand-display" id="player-hand">
        <div class="color-cards-row">
          <div class="color-card blue">
            <div class="token-dots">
              <span class="token-dot blue"></span>
              <span class="token-dot blue"></span>
            </div>
            <div class="power-circle blue">3</div>
            <div class="points-value">3 pts</div>
          </div>
          
          <div class="color-card white">
            <div class="token-dots">
              <span class="token-dot white"></span>
            </div>
            <div class="power-circle white">1</div>
            <div class="points-value">0 pts</div>
          </div>
          
          <div class="color-card green">
            <div class="token-dots">
            </div>
            <div class="power-circle green">2</div>
            <div class="points-value">5 pts</div>
          </div>
          
          <div class="color-card red">
            <div class="token-dots">
              <span class="token-dot red"></span>
              <span class="token-dot red"></span>
              <span class="token-dot red"></span>
              <span class="token-dot red"></span>
            </div>
            <div class="power-circle red">0</div>
            <div class="points-value">0 pts</div>
          </div>
          
          <div class="color-card black">
            <div class="wild-token-icon">
              <svg viewBox="0 0 32 32" width="32" height="32">
                <!-- Black section (top) -->
                <polygon points="16,16 16,2 29.3,11.7" fill="#2c3e50"/>
                
                <!-- White section (top-right) -->
                <polygon points="16,16 29.3,11.7 24.2,27.3" fill="#f0f0f0" stroke="#ccc"/>
                
                <!-- Red section (bottom-right) -->
                <polygon points="16,16 24.2,27.3 7.8,27.3" fill="#e74c3c"/>
                
                <!-- Green section (bottom-left) -->
                <polygon points="16,16 7.8,27.3 2.7,11.7" fill="#7ed321"/>
                
                <!-- Blue section (top-left) -->
                <polygon points="16,16 2.7,11.7 16,2" fill="#4a90e2"/>
                
                <polygon points="16,2 29.3,11.7 24.2,27.3 7.8,27.3 2.7,11.7" fill="none" stroke="#333" stroke-width="0.8"/>
              </svg>
            </div>
            <div class="power-circle black">1</div>
            <div class="points-value">2 pts</div>
          </div>
          
          <div class="reserved-section" id="show-reserved" data-clickable="popover" data-popover="reserved-modal">
            <div class="reserved-count">1</div>
            <div class="reserved-label">Reserved</div>
          </div>
        </div>
      </div>
  </div>
  `;
};

// Popover management functions
const openPopover = (id) => {
  const popover = document.getElementById(id);
  if (popover) {
    popover.style.display = "flex";
  }
};

const closePopover = (id) => {
  const popover = document.getElementById(id);
  if (popover) {
    popover.style.display = "none";
  }
};

// Close any open popover on escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const openPopovers = document.querySelectorAll(".modal-overlay[style*='flex']");
    openPopovers.forEach(popover => popover.style.display = "none");
  }
});

// Wire up all popover triggers (use event delegation)
document.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-clickable]");
  if (!trigger) return;

  const popoverId = trigger.dataset.popover;
  if (popoverId) {
    openPopover(popoverId);
  }
});

// Initialize the game
const init = async () => {
  await loadCards();
  console.log('Loaded cards:', { total: allCards.length, pyramid: pyramidCards });
  
  // Debug: check for cards with pearl costs
  const cardsWithPearls = allCards.filter(card => card.costs.pearl > 0);
  console.log('Cards with pearl costs:', cardsWithPearls.length, cardsWithPearls);
  
  const pyramidCardsWithPearls = 
    pyramidCards.level1.filter(c => c.costs.pearl > 0).length +
    pyramidCards.level2.filter(c => c.costs.pearl > 0).length +
    pyramidCards.level3.filter(c => c.costs.pearl > 0).length;
  console.log('Pyramid cards with pearls:', pyramidCardsWithPearls);
  
  document.querySelector("#app").innerHTML = generateGameLayout();
};

init();

// Close popovers when clicking outside them (add after DOM is ready)
setTimeout(() => {
  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        closePopover(overlay.id);
      }
    });
  });
}, 100);

// Remove global popover close on ESC, it's already handled above
window.closePopover = closePopover;
