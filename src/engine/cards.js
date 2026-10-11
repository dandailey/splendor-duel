/** Parse the game's simple, unquoted CSV; IDs restart at zero on every call. */
export function parseCards(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(value => value.trim());
  return lines.slice(1).map((line, index) => {
    const values = line.split(',').map(value => value.trim());
    const data = Object.fromEntries(headers.map((header, i) => [header, values[i]]));
    const number = field => parseInt(data[field], 10) || 0;
    return {
      id: `card-${index}`,
      level: parseInt(data.level, 10),
      color: data.color,
      points: number('points'),
      crowns: number('crowns'),
      ability: data.ability || '',
      isDouble: data.is_double === 'yes',
      costs: {
        white: number('cost_w'), blue: number('cost_bl'), green: number('cost_g'),
        red: number('cost_r'), black: number('cost_bk'), pearl: number('cost_p')
      }
    };
  });
}
