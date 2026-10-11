## Splendor Duel Rules vs Implementation Audit (2025-11-28)

This document compares the official rules in `files/how-to-play.md` against the current implementation in `src/main.js`. It records where the app is faithful to the board game, where it intentionally diverges, and what is missing.

### 1. Setup & Components

- **Jewel decks & pyramid**
  - Rules: 67 cards in 3 decks; initial pyramid of 3 level-3, 4 level-2, 5 level-1 cards.
  - Implementation: `initializeDecks` and `initializePyramid` load from CSV, build level 1–3 decks, and deal a 3/4/5 pyramid.
  - **Status**: Implemented and aligned (assuming CSV matches official card set).

- **Token bag and board**
  - Rules: 4 tokens of each gem color, 2 pearls, 3 gold; 5×5 board filled following printed spiral from the center.
  - Implementation: `placeTokensOnBoard` builds exactly that multiset, shuffles, and places 25 tokens on a 5×5 grid using `getSpiralOrder(5)` from the center outward. Bag is then set to 0 for all colors and later receives returned tokens from purchases/discards.
  - **Status**: Implemented and aligned.

- **Privilege scrolls**
  - Rules: 3 scrolls total; some actions award/take them; if you must receive one and none are available above the board, you take one from your opponent; if you already have all 3, nothing happens.
  - Implementation: `scrollPool` is initialized to 3; `awardScroll(playerId)` decrements `scrollPool` until 0, then steals from opponent if they have any; if neither pool nor opponent has scrolls, it still increments the recipient’s `privileges`.
  - **Status**: Core behavior (pool + stealing from opponent) is implemented, but there is a **rule drift**: when pool and opponent are empty, the code still awards a scroll, allowing more than 3 total in circulation. The physical rules cap the total at 3 and do nothing in this case.

- **Royal cards**
  - Rules: 4 royal cards; gaining 3rd and 6th crown awards a royal card immediately with its own ability and prestige.
  - Implementation: `initializeRoyalCards` installs 4 fixed royal cards with points and abilities (`scroll`, `steal`, `again`, `null`). `checkAndShowRoyalCardSelection` tracks crown thresholds using `previousCrownCounts` and shows a royal-selection modal when 3 and then 6 crowns are crossed. `confirmRoyalCardSelection` attaches the selected royal to the player and triggers ability handling.
  - **Status**: Implemented and aligned in spirit. Exact royal card set/abilities differ from the printed rulebook but are consistent and fully wired into gameplay.

### 2. Turn Structure & Actions

- **Turn sequence**
  - Rules: Optional actions (use Privilege, then refill board if desired) in order, followed by exactly one mandatory action. End of turn: discard down to 10 tokens and then check victory.
  - Implementation:
    - Optional actions:
      - Using a scroll is modeled as “scroll mode” inside the token-selection modal (`enterScrollSelectionMode`, `confirmScrollSelection`). Each scroll lets you take one gem/pearl from the board; gold cannot be taken.
      - Refill is wired to the same modal via `refillBoard`, which empties the bag onto empty spaces in spiral order and awards a scroll to the opponent.
      - After refilling, `boardWasRefilled` is set and scroll usage is disabled for the remainder of that token-selection session.
    - Mandatory actions:
      - **Take tokens**: `confirmTokenSelection` validates 1–3 adjacent non-gold tokens in a straight line (horizontal, vertical, or diagonal) and applies scroll penalties for 3-of-a-kind and double pearls.
      - **Reserve + gold**: `reserveSelectedCard` reserves a visible pyramid card and, if any gold token exists on the board, randomly converts one board gold into a gold token for the reserving player.
      - **Purchase**: `finalizePurchaseWithSelection` and `placeWildCard` drive the full payment flow with card-discount logic, gold assignment, wild-card placement, and card acquisition from pyramid or reserve.
    - End-of-turn behavior:
      - After token-take, reserve, purchase, discards, and many ability resolutions, `checkAndShowRoyalCardSelection` is called. Before royal selection or the “turn complete” dialog, it enforces the 10-token limit via `showTokenDiscardModal` and token discard handlers, then either shows the royal-selection modal or a turn-completion dialog and calls `switchPlayers` (or online sync handlers).
  - **Status**: The **turn engine is implemented** with optional scroll usage, refill, and a clear “end-turn” handshake, including hotseat switching and online sync. There is **no explicit “you must perform a mandatory action” validation**; the UX assumes players follow the intended flow.

- **Take up to 3 tokens (mandatory action)**
  - Rules:
    - Take 1–3 adjacent gem/pearl tokens in a straight line (orthogonal or diagonal).
    - Cannot take gold this way.
    - If you take 3 tokens of the same color or 2 pearls, your opponent gains 1 Privilege.
  - Implementation:
    - `toggleTokenSelection` forbids selecting empty or gold spaces.
    - `validateTokenSelection` enforces 1–3 count, adjacency, and straight lines; disallows lines containing empty or gold spaces (`checkLineForGoldOrEmpty`).
    - `confirmTokenSelection` applies the gain, checks for 3-of-a-kind and double-pearls, awards scrolls to opponent via `awardScroll`, and clears the selected board spaces.
  - **Status**: Implemented and aligned.

- **Take 1 Gold and reserve 1 card (mandatory action)**
  - Rules:
    - Only way to gain gold.
    - You may reserve from pyramid OR draw the top card from a deck.
    - You cannot take this action if there is no gold token on the board or you already have 3 reserved cards.
  - Implementation:
    - Reserve from pyramid: "Reserve" button in the card detail modal (`reserveSelectedCard`).
    - Reserve from deck: `reserveFromDeck(level)` allows drawing the top card from L1/L2/L3 decks.
    - Reserve UX: A "Reserve" button in the player stats bar toggles a dedicated Reserve Mode, allowing selection from either pyramid cards or deck-top `?` stacks with a reveal step.
    - No-gold gating: `hasGoldOnBoard()` check blocks the reserve action entirely when no gold is on the board.
    - A 3-card reserve limit is enforced.
  - **Status**: ✅ **Fully implemented and aligned.**

- **Purchase 1 Jewel card (mandatory action)**
  - Rules:
    - Pay costs with tokens (gems, pearls, gold as wild).
    - Card bonuses permanently reduce future costs; some cards have special abilities.
    - For **wild overlay cards specifically**, you must already have at least one non-wild card in the chosen color stack, and you may not place a wild on an empty stack or on top of another wild.
  - Implementation:
    - Card discounts and token payment flow:
      - `getPlayerCards` counts discounts by color stack, including double-bonus cards and wilds bound to a color stack, and tracks points and “wildStack” presence.
      - `getAffordability` and `buildDefaultPayment` calculate discounts from cards, then apply color tokens, pearls, and finally gold as wild.
      - The payment UI (`renderPaymentContent`) lets the user explicitly assign gold tokens to colors or pearls, including over-allocating gold even when discounts would cover the cost.
      - `computePaymentPlanWithGold` validates a chosen gold assignment and returns a concrete spend vector.
      - Non-wild card purchase: `finalizePurchaseWithSelection` deducts tokens, moves the card from pyramid or reserve to the player, refills pyramid from the appropriate deck, logs the event, and calls `processCardAbilities`.
      - Wild card purchase:
        - `canPlaceWildCard` checks available stacks and enforces:
          - The target color stack must already contain at least one card.
          - No stack may have two wilds on top of each other.
        - The card-detail UI disables the Buy button for wilds when there is no valid placement.
        - When confirmed, `placeWildCard` records `wildColorStack` and moves the card into the chosen color stack.
  - **Status**: Core payment system and discounts are robust and **wild-card placement rules are correctly enforced**. There is no global “must have any bonus card to purchase anything” restriction in the rules; that earlier interpretation was incorrect and the implementation is effectively aligned.

### 3. Card Abilities

Official abilities include: repeat turn, treat one card as a different color (overlay), take a token from the board, gain a Privilege, and steal a token from opponent.

- **Repeat turn (`again`)**
  - Implementation: `processCardAbilities` sees `card.ability === 'again'`, sets `repeatTurnActive = true`, and shows a dedicated modal. Turn-completion logic (`showTurnCompletionDialog` and `checkAndShowRoyalCardSelection`) respects this flag to prevent switching players until the repeat turn is resolved and the hand is trimmed to 10 tokens.
  - **Status**: Implemented and aligned.

- **Token from board (`token`)**
  - Implementation: `processCardAbilities` checks `card.ability === 'token'`, then searches the board for a token matching the card’s color. If any exist, it enters `bonusTokenMode` and opens the token-selection modal in one-token-only mode, allowing the player to pick a single token of that color from the board.
  - **Status**: Implemented and aligned (bonus behavior is exactly one matching token from the board).

- **Steal token from opponent (`take` / steal)**
  - Implementation: `processCardAbilities` interprets `card.ability === 'steal'`, checks if the opponent has any non-gold tokens, and if so opens a dedicated steal-token modal (`showStealTokenModal`). The player chooses a color, and `confirmStealToken` transfers one such token from opponent to current player.
  - **Status**: Implemented and aligned (naming is `steal` in code, but semantics match the rule’s “take” icon).

- **Privilege / scroll-gain ability**
  - Rules: some cards grant a Privilege when purchased.
  - Implementation:
    - `generateAbilityIcon` maps `ability: 'scroll'` to a scroll icon for display.
    - **There is no corresponding branch in `processCardAbilities` that actually awards a scroll** when such a Jewel card is acquired.
    - Royal cards with ability `scroll` do grant a scroll via `confirmRoyalCardSelection`.
  - **Status**: **Missing for normal Jewel cards**; fully implemented only on royal cards.

- **Overlay / double-bonus cards**
  - Rules: special cards are placed overlapping an existing stack and count as the same color; some provide double bonuses.
  - Implementation:
    - CSV fields `color`, `is_double`, and `ability === 'wild'` are used to represent flexible color stacking.
    - Wild cards:
      - Must be placed on a color stack that already has at least one card and does not already have a wild at the top (`canPlaceWildCard`, `wildStacks`).
      - After payment and placement selection, they are stored with `wildColorStack` pointing to the chosen color and then treated as part of that color stack by `getPlayerCards`.
    - Double-bonus cards:
      - `isDouble` is honored by `getPlayerCards`, which counts them as 2 units of that color for discounts.
      - Visual indicator: `generateDoubleIndicator` renders the two overlapping colored circles.
  - **Status**: Implemented and aligned mechanically; code treats this via wild + double-flag rather than a literal “b” overlay icon but reproduces the same purchasing impact and stacking constraints.

### 4. Privilege (Scroll) System

- **Awarding scrolls**
  - On setup: non-starting player receives a scroll via `awardScroll`.
  - When taking 3 tokens of same color: `confirmTokenSelection` calls `awardScroll` for the opponent.
  - When taking 2 pearls: same as above.
  - When refilling board: `refillBoard` awards a scroll to the opponent.
  - When claiming a royal card with `scroll` ability: `confirmRoyalCardSelection` awards a scroll to the claiming player.

- **Using scrolls**
  - Implemented through a dedicated section in the token-selection modal (`renderScrollUsageSection`, `enterScrollSelectionMode`, `confirmScrollSelection`).
  - Each scroll lets you select one gem/pearl token (no gold) from the board; the selected token moves to your pool, the board slot is cleared, and your `privileges` count is reduced by one.
  - After refilling the board in a turn, `boardWasRefilled = true` disables scroll usage for the remainder of that **token-selection modal session**, with a UI note: “You may not use scrolls after refilling the board”.

- **Differences from rules**
  - Official rules: you cannot use a Privilege to take a gold token (respected), and you can “return 1 or more Privileges” in one go (the code supports multiple scroll uses sequentially).
  - The printed rules require that optional actions be taken **in order**: Use Privileges (1) may happen before Refill (2), but not after. Our implementation:
    - Correctly prevents scroll use *after* a refill **within a single modal session**.
    - Resets the `boardWasRefilled` flag when the modal is closed and reopened, which allows a player to use scrolls after a refill if they reopen the token modal later in the same turn.
    - This is a **bug** relative to the official sequence, not an intentional house rule.
  - The total-scrolls cap of 3 is not strictly enforced due to the `awardScroll` edge case that creates extra scrolls when pool and opponent are empty.

### 5. Crowns, Royals, and Victory Conditions

- **Crowns and royal thresholds**
  - Rules: gain a royal card at your 3rd and 6th crown; crowning does not consume crowns, it’s a threshold trigger.
  - Implementation: `getPlayerVictoryStats` sums crowns and `previousCrownCounts` tracks thresholds. `checkAndShowRoyalCardSelection` fires royal selection when crossing 3 and then 6, then updates the previous count, matching the threshold behavior.
  - **Status**: Implemented and aligned.

- **Victory conditions**
  - Rules: at the end of your turn, if you have:
    1. 20 or more prestige points, or
    2. 10 or more crowns, or
    3. 10 or more prestige points on cards of the same color,
    the game ends immediately and you win.
  - Implementation:
    - `getPlayerVictoryStats` computes total prestige, total crowns, and per-color prestige, and displays these for both players in the UI (`renderOpponentStats`, player stats bar).
    - **There is no function that checks these stats against the victory thresholds and ends the game.** No victory dialog, status flag, or end-of-game flow exists; the game continues indefinitely.
  - **Status**: **Victory detection and end-of-game flow are completely missing.**

### 6. Summary of Major Gaps / Divergences (Updated 2025-11-28)

These are the key areas that need work to be "rules-complete" or at least explicitly documented as house rules:

1. **Victory conditions** ❌
   - Missing: automated victory detection and end-of-game handling based on prestige/crowns/color-prestige thresholds.

2. ~~**Reserve from top of deck**~~ ✅ FIXED
   - Now implemented via `reserveFromDeck(level)`.

3. ~~**Reserve action gating**~~ ✅ FIXED
   - Now blocked when no gold on board via `hasGoldOnBoard()` check.

4. **Privilege-granting Jewel cards** ❌
   - Missing: normal Jewel cards with a Privilege/scroll ability do not currently award scrolls on purchase; only royal cards with `scroll` ability do.

5. **Total scroll cap and edge-case behavior** ❌
   - Divergence: `awardScroll` can exceed the total of 3 scrolls if pool and opponent are empty, whereas the physical game has a strict three-Privilege limit.

6. **Scroll usage after refill** ❌
   - Rules: optional actions must be taken in order; using Privileges must happen (if at all) before refilling the board, never after.
   - Implementation: scroll usage is blocked after a refill **only until the modal is closed**; closing and reopening the token-selection modal resets the guard and allows scroll use after a refill in the same turn.
   - This should be treated as a **rules bug to fix** (per-turn guard) rather than a design choice.

7. **Game lifecycle and ergonomics (non-rule but important)**
   - Missing: an in-UI way to **reset** the current game back to a fresh setup.
   - Missing: any notion of player names or labels for games, which makes it hard to distinguish between multiple concurrent sessions.
   - ~~UX opportunity: reserving currently flows through the card-detail overlay only~~ ✅ FIXED - Reserve Mode button in player stats bar supports both pyramid and deck reserves.

These items should inform the updated `action_plan.md`, `todo.md`, and future work on rules fidelity.


