import { NextResponse } from 'next/server';

const YAPILY_APP_ID = process.env.YAPILY_APPLICATION_ID ?? '';
const YAPILY_SECRET = process.env.YAPILY_SECRET ?? '';
const YAPILY_BASE = 'https://api.yapily.com';

function yapilyAuth() {
  return 'Basic ' + Buffer.from(`${YAPILY_APP_ID}:${YAPILY_SECRET}`).toString('base64');
}

export async function GET() {
  try {
    const res = await fetch(
      `${YAPILY_BASE}/institutions?capability=INITIATE_PAYMENT`,
      { headers: { Authorization: yapilyAuth() } }
    );

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch institutions' }, { status: res.status });
    }

    const json = await res.json();

    const SANDBOX_FALLBACK = [
      { id: 'deutsche-bank', name: 'Deutsche Bank (EUR/IBAN Test)', countries: ['DE', 'EU'], logo: null },
      { id: 'revolut-sandbox', name: 'Revolut Sandbox (EUR/IBAN)', countries: ['LT', 'EU'], logo: null },
      { id: 'modelo-sandbox', name: 'Modelo Sandbox (GBP/Test)', countries: ['GB'], logo: 'https://images.yapily.com/image/ce2bfdbf-1ae2-4919-ab7b-e8b3d5e93b36' },
    ];

    const raw: { id: string; fullName: string; countries?: { countryCode2: string }[]; media?: { source: string; type: string }[] }[] = json.data ?? [];

    if (raw.length === 0) {
      return NextResponse.json(SANDBOX_FALLBACK);
    }

    const institutions = raw
      .map(i => ({
        id: i.id,
        name: i.fullName,
        countries: i.countries?.map(c => c.countryCode2) ?? [],
        logo: i.media?.find(m => m.type === 'icon')?.source ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json(institutions);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
