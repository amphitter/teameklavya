import { Suspense } from 'react';
import VerifyEmailPage from './verifyEmail';

export const dynamic = 'force-dynamic'; // optional

export default function Page() {
  return (
    <Suspense fallback={<div>Loading profile...</div>}>
      <VerifyEmailPage />
    </Suspense>
  );
}