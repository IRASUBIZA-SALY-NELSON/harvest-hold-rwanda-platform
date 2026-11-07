import { Redirect } from 'expo-router';

import { useAuth } from '@/state/auth';

export default function Index() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/welcome" />;
  return <Redirect href={user.role === 'farmer' ? '/farmer' : '/buyer'} />;
}
