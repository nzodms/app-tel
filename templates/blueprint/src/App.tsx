import { useDevice, useFlag } from '@phonelab/app';
import css from './styles.css';
import { config } from './lib/config';
import RequesterApp from './roles/RequesterApp';
import FulfillerApp from './roles/FulfillerApp';
import AdminApp from './roles/AdminApp';
import GuestApp from './roles/GuestApp';

/**
 * Entry point.
 *
 * PhoneLab tells each phone which role it is running as; this routes to the right
 * side of the product. Add a phone with a different role on the canvas and it
 * renders a different experience from the same codebase.
 *
 * The vocabulary — what things are called, what the events are, what the demo data
 * is — lives in `src/lib/config.ts`, generated from the brief you gave during
 * onboarding. Edit it, or replace it entirely: this is your project now.
 */
export default function App() {
  const device = useDevice();
  const signedOut = useFlag('signed-out');
  const role = signedOut ? 'guest' : device.role;

  const screen = () => {
    if (role === 'guest') return <GuestApp />;
    if (role === config.fulfillerRole) return <FulfillerApp />;
    if (config.adminRoles.includes(role)) return <AdminApp />;
    return <RequesterApp />;
  };

  return (
    <>
      <style>{css}</style>
      {screen()}
    </>
  );
}
