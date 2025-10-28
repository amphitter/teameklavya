import { Suspense } from 'react';
import UserDashboard from './userProfile';

export const dynamic = 'force-dynamic'; // optional

export default function Page() {
  return (
    <Suspense fallback={<div>Loading profile...</div>}>
      <UserDashboard />
    </Suspense>
  );
}
