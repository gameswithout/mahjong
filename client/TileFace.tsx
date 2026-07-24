type TileFaceSize = "sm" | "md" | "lg" | "focus";

type Point = readonly [number, number];

const NUMBER_WORDS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const DOT_POINTS: Record<number, Point[]> = {
  1: [[30, 45]],
  2: [[19, 29], [41, 61]],
  3: [[17, 25], [30, 45], [43, 65]],
  4: [[18, 28], [42, 28], [18, 62], [42, 62]],
  5: [[18, 28], [42, 28], [30, 45], [18, 62], [42, 62]],
  6: [[18, 22], [42, 22], [18, 45], [42, 45], [18, 68], [42, 68]],
  // Traditional seven-dot layout: three pips descend diagonally, with the
  // remaining four arranged as a square below.
  7: [[15, 15], [28, 27], [41, 39], [18, 58], [42, 58], [18, 76], [42, 76]],
  8: [[18, 18], [42, 18], [18, 35], [42, 35], [18, 55], [42, 55], [18, 72], [42, 72]],
  9: [[18, 18], [30, 18], [42, 18], [18, 45], [30, 45], [42, 45], [18, 72], [30, 72], [42, 72]],
};

const FLOWERS: Record<string, { label: string; color: string; accent: string }> = {
  spring: { label: "春", color: "#bd3030", accent: "#2f7a45" },
  summer: { label: "夏", color: "#c6362e", accent: "#2f7a45" },
  autumn: { label: "秋", color: "#b43c27", accent: "#557b32" },
  winter: { label: "冬", color: "#315b99", accent: "#547e48" },
  plum: { label: "梅", color: "#b72f40", accent: "#2f7a45" },
  orchid: { label: "蘭", color: "#315b99", accent: "#407846" },
  chrysanthemum: { label: "菊", color: "#b44b22", accent: "#587a2e" },
  bamboo: { label: "竹", color: "#2d7141", accent: "#4a8a49" },
};

function parsedTile(id: string): { suit: string; rank?: number; name?: string } {
  const [suit, second] = id.split("-");
  if (suit === "wind" || suit === "dragon" || suit === "flower") {
    return { suit, name: second };
  }
  return { suit, rank: Number(second) };
}

function Dot({ x, y, color, scale = 1 }: { x: number; y: number; color: string; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <circle r="8" fill={color} />
      <circle r="5.3" fill="#f6eed9" />
      <circle r="3.3" fill={color} />
      <circle r="1.5" fill="#f6eed9" />
    </g>
  );
}

function Dots({ rank }: { rank: number }) {
  const colors = ["#be3434", "#224d92", "#287244"];
  if (rank === 1) {
    return (
      <g className="tile-face-one-dot" transform="translate(30 45)">
        <circle r="21" fill="#287244" />
        <circle r="17" fill="#f6eed9" />
        <circle r="14" fill="none" stroke="#287244" strokeWidth="3" strokeDasharray="2 2.5" />
        <circle r="9" fill="#be3434" />
        <circle r="5.6" fill="#f6eed9" />
        <circle r="3.2" fill="#be3434" />
      </g>
    );
  }
  return (
    <>
      {(DOT_POINTS[rank] ?? []).map(([x, y], index) => (
        <Dot
          key={`${x}-${y}`}
          x={x}
          y={y}
          color={rank === 7 ? (index < 3 ? "#287244" : "#be3434") : colors[index % colors.length]}
          scale={rank === 7 ? 0.82 : 1}
        />
      ))}
    </>
  );
}

function Bamboo({ rank }: { rank: number }) {
  return (
    <>
      {(DOT_POINTS[rank] ?? []).map(([x, y], index) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
          <rect x="-3.6" y="-8" width="7.2" height="16" rx="3.6" fill={index % 5 === 2 ? "#bd3434" : "#2d7443"} />
          <path d="M-2.1 -3.2h4.2M-2.1 3.2h4.2" stroke="#f4edd9" strokeWidth="1.25" strokeLinecap="round" />
        </g>
      ))}
    </>
  );
}

function Characters({ rank }: { rank: number }) {
  return (
    <g className="tile-face-script">
      <text x="30" y="38" textAnchor="middle" fill="#234b91">{NUMBER_WORDS[rank]}</text>
      <text x="30" y="70" textAnchor="middle" fill="#bb302e">萬</text>
    </g>
  );
}

function Honor({ suit, name }: { suit: string; name: string }) {
  if (suit === "dragon" && name === "white") {
    return (
      <g className="tile-face-white-dragon" fill="none" stroke="#234d98">
        <rect x="13" y="20" width="34" height="50" rx="2" strokeWidth="3.4" />
        <rect x="18" y="25" width="24" height="40" rx="1" strokeWidth="1.8" />
      </g>
    );
  }
  const glyphs: Record<string, { text: string; color: string }> = {
    east: { text: "東", color: "#234b91" }, south: { text: "南", color: "#234b91" },
    west: { text: "西", color: "#234b91" }, north: { text: "北", color: "#234b91" },
    red: { text: "中", color: "#bd302e" }, green: { text: "發", color: "#287244" },
  };
  const glyph = glyphs[name] ?? { text: "?", color: "#1c130a" };
  return <text className="tile-face-honor" x="30" y="59" textAnchor="middle" fill={glyph.color}>{glyph.text}</text>;
}

function Flower({ name }: { name: string }) {
  const flower = FLOWERS[name] ?? { label: "?", color: "#1c130a", accent: "#2d7443" };
  return (
    <g>
      <path d="M30 67C31 51 28 38 30 20" fill="none" stroke={flower.accent} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M29 46c-10-1-12-7-9-11 7 1 10 5 9 11M31 55c9-2 12-8 9-12-7 2-10 6-9 12" fill="none" stroke={flower.accent} strokeWidth="2" strokeLinecap="round" />
      <circle cx="30" cy="31" r="9" fill="none" stroke={flower.color} strokeWidth="2.5" />
      {[0, 72, 144, 216, 288].map((angle) => <ellipse key={angle} cx="30" cy="22" rx="3.8" ry="7" fill={flower.color} transform={`rotate(${angle} 30 31)`} />)}
      <text className="tile-face-flower-label" x="30" y="82" textAnchor="middle" fill={flower.color}>{flower.label}</text>
    </g>
  );
}

/** Original vector face art for the project's canonical tile IDs. */
export function TileFace({ id, size }: { id: string; size: TileFaceSize }) {
  const { suit, rank, name } = parsedTile(id);
  let face: React.ReactNode;
  if (suit === "dots" && rank) face = <Dots rank={rank} />;
  else if (suit === "bamboo" && rank) face = <Bamboo rank={rank} />;
  else if (suit === "characters" && rank) face = <Characters rank={rank} />;
  else if ((suit === "wind" || suit === "dragon") && name) face = <Honor suit={suit} name={name} />;
  else if (suit === "flower" && name) face = <Flower name={name} />;
  else face = <text className="tile-face-honor" x="30" y="59" textAnchor="middle">?</text>;

  return <svg className={`tile-face tile-face-${size}`} viewBox="0 0 60 90" aria-hidden="true" focusable="false">{face}</svg>;
}
