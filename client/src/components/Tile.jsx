// 타일 하나 렌더링
export default function Tile({ tile, draggable, onDragStart, onDragEnd, onPointerDown, ghost, ready }) {
  const cls = ['tile'];
  if (tile.joker) cls.push('joker');
  else cls.push(`c-${tile.color}`);
  if (ghost) cls.push('ghost');
  if (ready) cls.push('ready');

  return (
    <div
      className={cls.join(' ')}
      data-tileid={tile.id}
      draggable={draggable}
      onDragStart={draggable ? (e) => onDragStart(e, tile) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      // 터치/펜: HTML5 DnD가 안 먹으므로 포인터로 드래그를 흉내낸다 (Game.jsx)
      onPointerDown={draggable && onPointerDown ? (e) => onPointerDown(e, tile) : undefined}
    >
      <span className="num">{tile.joker ? '★' : tile.num}</span>
    </div>
  );
}
