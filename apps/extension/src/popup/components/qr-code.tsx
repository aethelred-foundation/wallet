/**
 * Simple QR-like pattern renderer using SVG.
 * Generates a deterministic grid from the address data with finder patterns.
 */

interface QRCodeProps {
  data: string;
  size?: number;
  fgColor?: string;
  bgColor?: string;
}

export function QRCode({ data, size = 160, fgColor = "#10161d", bgColor = "#ffffff" }: QRCodeProps) {
  const gridSize = 21;
  const cellSize = size / gridSize;
  const padding = cellSize * 0.5;
  const innerSize = size - padding * 2;
  const innerCell = innerSize / gridSize;

  // Simple hash function
  let hash = 5381;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) + hash + data.charCodeAt(i)) >>> 0;
  }

  const cells: Array<{ x: number; y: number }> = [];

  // Generate data pattern
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      // Skip finder pattern areas
      if (x < 8 && y < 8) continue;
      if (x >= gridSize - 8 && y < 8) continue;
      if (x < 8 && y >= gridSize - 8) continue;

      const seed = ((hash * (y * gridSize + x + 1)) >>> 0) % 100;
      if (seed > 45) {
        cells.push({ x, y });
      }
    }
  }

  // Finder pattern cells (three corners)
  const finderPositions = [
    [0, 0],
    [gridSize - 7, 0],
    [0, gridSize - 7],
  ];

  for (const [fx, fy] of finderPositions) {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const isOuter = y === 0 || y === 6 || x === 0 || x === 6;
        const isInner = y >= 2 && y <= 4 && x >= 2 && x <= 4;
        if (isOuter || isInner) {
          cells.push({ x: fx + x, y: fy + y });
        }
      }
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg">
      <rect width={size} height={size} rx={12} fill={bgColor} />
      {cells.map(({ x, y }) => (
        <rect
          key={`${x}-${y}`}
          x={padding + x * innerCell}
          y={padding + y * innerCell}
          width={innerCell * 0.85}
          height={innerCell * 0.85}
          rx={innerCell * 0.15}
          fill={fgColor}
        />
      ))}
    </svg>
  );
}
