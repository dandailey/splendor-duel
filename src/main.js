import "./style.css";

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
      <!-- Header -->
      <div class="game-header">
        <div class="victory-tracker">
          <div class="victory-tracker-left">
            <div class="victory-stat large">
              <div class="victory-value score-value-large">0</div>
            </div>
            <div class="victory-stat large">
              <div class="victory-icon-backdrop crown">👑</div>
              <div class="victory-value overlaid">0</div>
            </div>
            <div class="victory-stat large">
              <div class="victory-icon-backdrop color blue"></div>
              <div class="victory-value overlaid">0</div>
            </div>
          </div>
          <div class="victory-tracker-right">
            <div class="opponent-display-wrapper">
              <div class="opponent-header-row">
                <div class="opponent-scrolls">
                  <span class="privilege-scroll-emoji">🗞️</span>
                  <span class="privilege-scroll-emoji">🗞️</span>
                  <span class="privilege-scroll-emoji">🗞️</span>
                </div>
                <div class="opponent-tokens">
                  <span class="token-indicator gold">🟡</span>
                  <span class="token-indicator pearl">⚪</span>
                </div>
              </div>
              <div class="opponent-stats-row">
                <div class="victory-stat small">
                  <div class="victory-value score-value">0</div>
                </div>
                <div class="victory-stat small">
                  <div class="victory-icon-backdrop crown">👑</div>
                  <div class="victory-value overlaid">0</div>
                </div>
                <div class="victory-stat small">
                  <div class="victory-icon-backdrop color red"></div>
                  <div class="victory-value overlaid">0</div>
                </div>
              </div>
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
                  <div class="crown-icon">👑</div>
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
                  <div class="crown-icon">👑</div>
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
                  <div class="crown-icon">👑</div>
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
                  <div class="crown-icon">👑</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+4</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="main-display-container">
        <div class="board-panel board-panel-primary" id="pyramid-panel" data-panel="pyramid">
          <div class="pyramid-info-corner fades-when-mini">
            <div class="royal-cards-summary card-shaped">
              <div class="royal-card-icon-centered">👑</div>
              <div class="royal-card-label">4</div>
            </div>
          </div>
          <div class="card-pyramid">
            <div class="pyramid-row">
              <div class="draw-deck level-3-deck fades-when-mini">
                <div class="deck-count">21</div>
              </div>
              <div class="card level-3-card">
                <div class="card-header">
                  <div class="card-level level-3">3</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-3-card">
                <div class="card-header">
                  <div class="card-level level-3">3</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-3-card">
                <div class="card-header">
                  <div class="card-level level-3">3</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
            </div>

            <div class="pyramid-row">
              <div class="draw-deck level-2-deck fades-when-mini">
                <div class="deck-count">18</div>
              </div>
              <div class="card level-2-card">
                <div class="card-header">
                  <div class="card-level level-2">2</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-2-card">
                <div class="card-header">
                  <div class="card-level level-2">2</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-2-card">
                <div class="card-header">
                  <div class="card-level level-2">2</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-2-card">
                <div class="card-header">
                  <div class="card-level level-2">2</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
            </div>

            <div class="pyramid-row">
              <div class="draw-deck level-1-deck fades-when-mini">
                <div class="deck-count">7</div>
              </div>
              <div class="card level-1-card">
                <div class="card-header">
                  <div class="card-level level-1">1</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-1-card">
                <div class="card-header">
                  <div class="card-level level-1">1</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-1-card">
                <div class="card-header">
                  <div class="card-level level-1">1</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-1-card">
                <div class="card-header">
                  <div class="card-level level-1">1</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-1-card">
                <div class="card-header">
                  <div class="card-level level-1">1</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="board-panel board-panel-secondary" id="token-panel" data-panel="token">
          <div class="token-board">
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
      </div>

      <!-- Global Hand Display (always at bottom) -->
      <div class="global-hand-display" id="player-hand">
        <div class="hand-header">
          <div class="hand-header-left">
            <div class="player-scrolls">
              <span class="privilege-scroll-emoji">🗞️</span>
              <span class="privilege-scroll-emoji">🗞️</span>
              <span class="privilege-scroll-emoji">🗞️</span>
            </div>
          </div>
          <div class="hand-header-right">
            <div class="stat-icon pearl">
              <span class="stat-count pearl-count">0</span>
            </div>
            <div class="stat-icon gold">
              <span class="stat-count gold-count">0</span>
            </div>
          </div>
        </div>
        
        <div class="color-cards-row">
          <div class="color-card blue">
            <div class="token-overlay blue">
              <span class="token-count">2</span>
            </div>
            <div class="card-count">1 card</div>
            <div class="points-value">+3</div>
          </div>
          
          <div class="color-card white">
            <div class="token-overlay white">
              <span class="token-count">1</span>
            </div>
            <div class="card-count">0 cards</div>
            <div class="points-value">+0</div>
          </div>
          
          <div class="color-card green">
            <div class="token-overlay green">
              <span class="token-count">0</span>
            </div>
            <div class="card-count">2 cards</div>
            <div class="points-value">+5</div>
          </div>
          
          <div class="color-card red">
            <div class="token-overlay red">
              <span class="token-count">0</span>
            </div>
            <div class="card-count">0 cards</div>
            <div class="points-value">+0</div>
          </div>
          
          <div class="color-card black">
            <div class="token-overlay black">
              <span class="token-count">1</span>
            </div>
            <div class="card-count">1 card</div>
            <div class="points-value">+2</div>
          </div>
          
          <div class="reserved-section" id="show-reserved">
            <div class="reserved-icon">📋</div>
            <div class="reserved-count">1</div>
            <div class="reserved-label">Reserved</div>
          </div>
        </div>
      </div>
  </div>
  `;
};

// Initialize the game
document.querySelector("#app").innerHTML = generateGameLayout();

const mainDisplayContainer = document.querySelector(".main-display-container");
const panels = {
  pyramid: document.getElementById("pyramid-panel"),
  token: document.getElementById("token-panel"),
};

const swapBoards = () => {
  Object.values(panels).forEach((panel) => {
    panel.classList.toggle("board-panel-primary");
    panel.classList.toggle("board-panel-secondary");
  });
  mainDisplayContainer.classList.toggle("board-swapped");
};

panels.pyramid?.addEventListener("click", () => {
  if (!mainDisplayContainer.classList.contains("board-swapped")) {
    return;
  }
  swapBoards();
});

panels.token?.addEventListener("click", () => {
  if (mainDisplayContainer.classList.contains("board-swapped")) {
    return;
  }
  swapBoards();
});

// Reserved cards modal functionality
document.querySelector("#show-reserved")?.addEventListener("click", () => {
  document.getElementById("reserved-modal").style.display = "flex";
});

// Close modal when clicking outside
document.getElementById("reserved-modal")?.addEventListener("click", (e) => {
  if (e.target.id === "reserved-modal") {
    e.target.style.display = "none";
  }
});

document.getElementById("royal-modal")?.addEventListener("click", (e) => {
  if (e.target.id === "royal-modal") {
    e.target.style.display = "none";
  }
});

// Close modal on escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.getElementById("reserved-modal").style.display = "none";
    document.getElementById("royal-modal").style.display = "none";
  }
});

// Royal cards summary click handler
document.addEventListener("click", (e) => {
  if (e.target.closest(".royal-cards-summary")) {
    document.getElementById("royal-modal").style.display = "flex";
  }
});

// Player toggle removed - using scrolls to show player ownership
