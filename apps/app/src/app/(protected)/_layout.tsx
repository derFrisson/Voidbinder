import { Slot } from 'expo-router';
import { SessionGate } from '../../components/SessionGate';

export default function ProtectedLayout() {
  return (
    <SessionGate>
      <Slot />
    </SessionGate>
  );
}
