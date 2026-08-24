import { supabase } from '@/lib/supabase';
import POSTerminal from './pos-terminal';

export default async function Home() {
  const { data: items, error } = await supabase
    .from('menu_items')
    .select('*')
    .order('id');

  if (error) {
    return (
      <main className="min-h-screen p-6 bg-amber-50">
        <h1 className="text-2xl font-bold text-red-800">Supabase error</h1>
        <pre className="mt-4 p-4 bg-white rounded border border-red-200 text-sm text-red-700 whitespace-pre-wrap">
          {error.message}
        </pre>
      </main>
    );
  }

  return <POSTerminal items={items ?? []} />;
}
