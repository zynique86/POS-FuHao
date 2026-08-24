import { supabase } from '@/lib/supabase';
import { fetchSettings } from '@/lib/settings';
import POSTerminal from './pos-terminal';
import type { MenuItem } from '@/lib/types';

export default async function Home() {
  const [{ data: items, error }, settings] = await Promise.all([
    supabase
      .from('menu_items')
      .select('*')
      .order('category')
      .order('sort_order')
      .order('id'),
    fetchSettings(),
  ]);

  if (error) {
    return (
      <main className="min-h-screen p-6 bg-amber-50">
        <h1 className="text-2xl font-bold text-red-800">Supabase error</h1>
        <pre className="mt-4 p-4 bg-white rounded border border-red-200 text-sm text-red-700 whitespace-pre-wrap">
          {error.message}
        </pre>
        <p className="mt-4 text-sm text-stone-600">
          If you just created the project, run{' '}
          <code className="bg-white px-1 rounded">migrations/001_polish.sql</code>{' '}
          in the Supabase SQL editor.
        </p>
      </main>
    );
  }

  return (
    <POSTerminal
      items={(items ?? []) as MenuItem[]}
      settings={settings}
    />
  );
}
