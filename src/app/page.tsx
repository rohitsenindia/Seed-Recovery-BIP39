import SeedRecoveryBIP39 from '@/components/seed-recovery-bip39';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-6 md:p-8 bg-background font-body">
      <SeedRecoveryBIP39 />
    </main>
  );
}
