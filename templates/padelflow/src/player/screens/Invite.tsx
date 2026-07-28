import { useDevice } from '@phonelab/app';
import { SUGGESTED_FRIENDS } from '../../data/courts';
import type { BookingDraft } from '../PlayerApp';
import { Screen, SectionTitle } from '../../ui/Chrome';
import { Button, Field, SelectableRow } from '../../ui/Controls';
import { Pill } from '../../ui/Feedback';

/** A padel court needs four players — invite three, or play with fewer. */
export function InviteScreen({
  draft,
  onBack,
  onChange,
  onContinue,
}: {
  draft: BookingDraft;
  onBack: () => void;
  onChange: (patch: Partial<BookingDraft>) => void;
  onContinue: () => void;
}) {
  const device = useDevice();
  const selected = draft.friendIds;
  const total = selected.length + 1;

  const toggle = (id: string) => {
    onChange({
      friendIds: selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id],
    });
  };

  return (
    <Screen
      title="Invite players"
      subtitle={`${total} of 4 spots filled`}
      onBack={onBack}
      actions={<Pill tone={total === 4 ? 'positive' : 'neutral'}>{total}/4</Pill>}
      footer={
        <Button onClick={onContinue} testId="continue-review">
          Continue
        </Button>
      }
    >
      <SectionTitle>Your regulars</SectionTitle>
      <div className="pf-card">
        <SelectableRow title={`${device.userLabel ?? 'You'} (you)`} subtitle="Organiser" selected onToggle={() => {}} />
        {SUGGESTED_FRIENDS.map((friend) => (
          <SelectableRow
            key={friend.id}
            title={friend.name}
            subtitle={selected.includes(friend.id) ? 'Invited' : 'Tap to invite'}
            selected={selected.includes(friend.id)}
            onToggle={() => toggle(friend.id)}
            testId={`friend-${friend.id}`}
          />
        ))}
      </div>

      <SectionTitle>Message to the club</SectionTitle>
      <Field
        label="Optional note"
        value={draft.note}
        placeholder="We’ll need to rent two rackets"
        onChange={(note) => onChange({ note })}
        testId="note"
      />
    </Screen>
  );
}
