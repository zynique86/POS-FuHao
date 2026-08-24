import { supabase } from '@/lib/supabase';

export default async function Home() {
  const { data: items, error } = await supabase
    .from('menu_items')
    .select('*')
    .order('id');

  // If Supabase returns an error, show it on the page so we can debug
  if (error) {
    return (
      <main className="min-h-screen p-6 bg-amber-50">
        <h1 className="text-2xl font-bold text-red-800">Supabase error</h1>
        <pre className="mt-4 p-4 bg-white rounded border border-red-200 text-sm text-red-700 whitespace-pre-wrap">
          {error.message}
        </pre>
        <p className="mt-4 text-stone-600 text-sm">
          Most likely: .env.local has wrong keys, or the menu_items table
          doesn&apos;t exist, or Row Level Security is blocking reads.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-amber-50 p-6">
      <h1 className="text-4xl font-bold text-red-800 mb-6">
        🥟 Dim Sum Menu
      </h1>

      {(!items || items.length === 0) && (
        <p className="text-stone-600">
          No menu items found. Did you run the INSERT statements from Chapter 02
          Step 6?
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {items?.map((item) => (
          <div
            key={item.id}
            className="bg-white rounded-lg p-4 shadow-sm border border-amber-100"
          >
            <h3 className="font-bold text-stone-800">{item.name_en}</h3>
            <p className="text-sm text-stone-500">{item.name_zh}</p>
            <p className="mt-2 text-red-700 font-mono text-lg">
              RM {item.price}
            </p>
          </div>
        ))}
      </div>
    </main>
  );
}
