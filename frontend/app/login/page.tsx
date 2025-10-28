import { Suspense } from 'react';
import Login from './Login';

export const dynamic = 'force-dynamic'; // optional

export default function Page() {
  return (
    <Suspense fallback={<div>Loading profile...</div>}>
      <Login />
    </Suspense>
  );
}