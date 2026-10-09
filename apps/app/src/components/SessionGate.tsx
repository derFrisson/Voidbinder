import { Redirect, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSession } from '../api/queries/me';
import { ErrorState, Loading } from './ui';

/** Renders its children for a signed-in user; sends everyone else to /sign-in and back after. */
export function SessionGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  if (session.isPending) {
    return (
      <View className="flex-1 px-8">
        <Loading />
      </View>
    );
  }
  if (session.isError) {
    return (
      <View className="flex-1 px-8">
        <ErrorState onRetry={() => void session.refetch()} />
      </View>
    );
  }
  if (!session.data)
    return <Redirect href={{ pathname: '/sign-in', params: { next: pathname } }} />;
  return <>{children}</>;
}
