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
                <div class="victory-icon-backdrop crown">👑</div>
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
                  <span class="stat-count pearl-count">0</span>
                </div>
                <div class="stat-icon gold">
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
              <div class="opponent-reserved-icon">📋</div>
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
                  <div class="meter-fill level-3" style="height: 85%"></div>
                </div>
              </div>
              <div class="card level-3-card" data-clickable="card" data-popover="card-detail-popover">
                <div class="card-header">
                  <div class="card-level level-3">3</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-3-card" data-clickable="card" data-popover="card-detail-popover">
                <div class="card-header">
                  <div class="card-level level-3">3</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-3-card" data-clickable="card" data-popover="card-detail-popover">
                <div class="card-header">
                  <div class="card-level level-3">3</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card-spacer"></div>
              <div class="royal-cards-summary card-shaped" id="royal-cards-trigger" data-clickable="popover" data-popover="royal-modal">
                <div class="royal-card-icon-centered">👑</div>
                <div class="royal-card-label">4</div>
              </div>
            </div>

            <div class="pyramid-row">
              <div class="deck-meter-container">
                <div class="deck-meter">
                  <div class="meter-fill level-2" style="height: 72%"></div>
                </div>
              </div>
              <div class="card level-2-card" data-clickable="card" data-popover="card-detail-popover">
                <div class="card-header">
                  <div class="card-level level-2">2</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-2-card" data-clickable="card" data-popover="card-detail-popover">
                <div class="card-header">
                  <div class="card-level level-2">2</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-2-card" data-clickable="card" data-popover="card-detail-popover">
                <div class="card-header">
                  <div class="card-level level-2">2</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-2-card" data-clickable="card" data-popover="card-detail-popover">
                <div class="card-header">
                  <div class="card-level level-2">2</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
            </div>

            <div class="pyramid-row">
              <div class="deck-meter-container">
                <div class="deck-meter">
                  <div class="meter-fill level-1" style="height: 58%"></div>
                </div>
              </div>
              <div class="card level-1-card" data-clickable="card" data-popover="card-detail-popover">
                <div class="card-header">
                  <div class="card-level level-1">1</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-1-card" data-clickable="card" data-popover="card-detail-popover">
                <div class="card-header">
                  <div class="card-level level-1">1</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-1-card" data-clickable="card" data-popover="card-detail-popover">
                <div class="card-header">
                  <div class="card-level level-1">1</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-1-card" data-clickable="card" data-popover="card-detail-popover">
                <div class="card-header">
                  <div class="card-level level-1">1</div>
                </div>
                <div style="text-align: center; margin-top: 40px;">
                  <div class="prestige-points">+0</div>
                </div>
              </div>
              <div class="card level-1-card" data-clickable="card" data-popover="card-detail-popover">
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

      <!-- Player Stats Section -->
      <div class="player-stats-bar">
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
              <span class="stat-count pearl-count">0</span>
            </div>
            <div class="stat-icon gold">
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
            <div class="reserved-icon">📋</div>
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

// Initialize the game
document.querySelector("#app").innerHTML = generateGameLayout();

// Wire up all popover triggers
document.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-clickable]");
  if (!trigger) return;

  const popoverId = trigger.dataset.popover;
  if (popoverId) {
    openPopover(popoverId);
  }
});

// Close popovers when clicking outside them
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closePopover(overlay.id);
    }
  });
});

// Remove global popover close on ESC, it's already handled above
window.closePopover = closePopover;
