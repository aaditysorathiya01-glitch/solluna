import { AuthForm } from '@/components/AuthForm';

export default async function Register({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan } = await searchParams;
  const valid = plan && ['RESELLER', 'GROWTH', 'PREMIUM'].includes(plan) ? plan : undefined;
  return <AuthForm mode="register" plan={valid} />;
}
