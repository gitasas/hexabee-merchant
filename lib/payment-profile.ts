export type PaymentProfile = {
  businessName: string;
  iban: string;
  email: string;
  publicSlug: string;
};

type StoredPaymentProfile = {
  business_name?: string;
  iban?: string;
  email?: string;
  public_slug?: string;
  businessName?: string;
  publicSlug?: string;
};

export const PAYMENT_PROFILE_STORAGE_KEY = 'hexabee_payment_profile';

export function toSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function normalizePaymentProfile(value: unknown): PaymentProfile | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const profile = value as StoredPaymentProfile;

  return {
    businessName: profile.business_name ?? profile.businessName ?? '',
    iban: profile.iban ?? '',
    email: profile.email ?? '',
    publicSlug: profile.public_slug ?? profile.publicSlug ?? '',
  };
}

export function toStoredPaymentProfile(profile: PaymentProfile) {
  return {
    business_name: profile.businessName,
    iban: profile.iban,
    email: profile.email,
    public_slug: profile.publicSlug,
  };
}
