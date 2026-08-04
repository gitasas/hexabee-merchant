import { LangProvider } from '../i18n';
import '../portal.css';

// Shared bits for every /merchant/* route: styles + language context.
// Auth guarding lives in middleware.ts (full loads) and in the (portal)
// group layout (session + onboarding completeness); login, register and
// onboarding intentionally render without portal chrome.
export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return <LangProvider>{children}</LangProvider>;
}
