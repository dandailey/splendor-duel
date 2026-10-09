export const buildPushMeta = (stateBlobString) => {
  try {
    if (typeof stateBlobString !== "string") return null;
    const { gameState } = JSON.parse(stateBlobString);
    const { currentPlayer, syncAssignments } = gameState;
    const { player1Id, player2Id } = syncAssignments;
    const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);

    if (!validId(player1Id) || !validId(player2Id) || player1Id === player2Id) return null;
    if (currentPlayer !== 1 && currentPlayer !== 2) return null;

    return {
      player1_assigned: true,
      player2_assigned: false,
      actor_ids: [player1Id, player2Id],
      summary: {
        status: gameState.gameOver?.winnerId ? "finished" : "active",
        active_seat: currentPlayer,
        players: [
          { seat: 1, actor_id: player1Id },
          { seat: 2, actor_id: player2Id }
        ]
      }
    };
  } catch {
    return null;
  }
};

// Meta written when a game is created: no seats are active yet. The push worker only detects a turn
// change against a previous summary with a status and an active_seat key, so without this the first
// "your turn" after the opponent joins would be silently dropped.
export const buildLobbyMeta = () => ({
  player1_assigned: true,
  player2_assigned: false,
  summary: { status: "lobby", active_seat: null, players: [] }
});
