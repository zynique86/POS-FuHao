# Managing admin access

Admin access is controlled in two places, and both must be kept in sync for an admin
to actually work end to end.

## 1. Create the staff login (if they don't already have one)

Supabase dashboard → **Authentication → Users → Add user**. This is what lets the
person sign into the POS at all. Skip this if they already have a staff account and
you're just promoting them to admin.

## 2. Grant the app-side admin UI

Edit `lib/admin-emails.ts` and add the email to `ADMIN_EMAILS`. This controls which
UI the app shows them (admin menu/settings screens).

## 3. Grant the database-side admin permission

This is the part that actually matters for security: the database itself checks this
before allowing a write to `shop_settings` or `menu_items`, independent of the app's
UI. Without this step, the person will see the admin screens but their save attempts
will fail with a permission error.

Run this in Supabase dashboard → **SQL Editor → New query**:

```sql
create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'ezjiet@gmail.com',
    'poyee4963@gmail.com',
    'rickytan5791@gmail.com',
    'tan523567@gmail.com'
    -- add new admin emails here, one per line, comma-separated
  );
$$;
```

Keep the email list here identical to `ADMIN_EMAILS` in `lib/admin-emails.ts` — they
must match exactly or the UI and the actual permission check will disagree.

This only redefines the one function; it doesn't touch any data.
