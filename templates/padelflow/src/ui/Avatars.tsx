import type { Player } from '../lib/types';

export function AvatarStack({ players, max = 4 }: { players: Player[]; max?: number }) {
  const shown = players.slice(0, max);
  const overflow = players.length - shown.length;
  return (
    <div className="pf-avatars">
      {shown.map((player, index) => (
        <span
          className={index === 0 ? 'pf-avatar pf-avatar--accent' : 'pf-avatar'}
          key={player.id}
          title={player.name}
        >
          {player.initials}
        </span>
      ))}
      {overflow > 0 ? <span className="pf-avatar">+{overflow}</span> : null}
    </div>
  );
}
