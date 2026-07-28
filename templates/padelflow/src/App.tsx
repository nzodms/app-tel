import { useDevice, useFlag } from '@phonelab/app';
import css from './styles.css';
import ClubApp from './club/ClubApp';
import GuestApp from './guest/GuestApp';
import PlayerApp from './player/PlayerApp';

/**
 * PadelFlow entry point.
 *
 * One codebase, several roles. PhoneLab tells each phone which role it is running
 * as, and this component routes to the matching app. Add a phone with a different
 * role on the canvas and it renders a different side of the same product.
 */
export default function App() {
  const device = useDevice();
  const signedOut = useFlag('signed-out');

  const role = signedOut ? 'guest' : device.role;

  return (
    <>
      {/* Styles ship as a real .css file in the project and are injected once. */}
      <style>{css}</style>
      {role === 'provider' ? <ClubApp /> : role === 'guest' ? <GuestApp /> : <PlayerApp />}
    </>
  );
}
