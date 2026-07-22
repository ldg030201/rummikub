// 타일 하나 렌더링
export default function Tile({ tile, draggable, onDragStart, onDragEnd, ghost, small, ready }) {
  const cls = ['tile'];
  if (tile.joker) cls.push('joker');
  else cls.push(`c-${tile.color}`);
  if (ghost) cls.push('ghost');
  if (small) cls.push('small');
  if (ready) cls.push('ready');

  return (
    <div
      className={cls.join(' ')}
      data-tileid={tile.id}
      draggable={draggable}
      onDragStart={draggable ? (e) => onDragStart(e, tile) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
    >
      <span className="num">{tile.joker ? '★' : tile.num}</span>
    </div>
  );
}
